import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { requirePermission } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record-audit";
import type { AuthenticatedSession } from "@/lib/auth/session";
import { getDefaultPaymentProvider, InvalidWebhookSignatureError, MockPaymentProvider, type PaymentProvider, type PaymentProviderPaymentStatus } from "@/lib/billing/payment-provider";
import type { InvoiceStatus } from "@/generated/prisma/client";
import { restoreTenantSubscription } from "@/lib/repositories/subscription-repository";
import { sendInvoiceEmailForPayment } from "@/lib/repositories/billing-email-repository";

/**
 * Phase 10 (P10G) — payment processing and idempotency. A payment is only
 * ever recorded through this file: a genuinely-verified provider webhook
 * (processPaymentProviderEvent) or an explicitly manual, permission-gated,
 * audited record (recordManualPayment). Nothing in this codebase ever
 * trusts a browser-supplied "payment succeeded" flag to mark an invoice
 * paid — see TESTING.md / SECURITY_AND_POPIA.md for the corresponding
 * adversarial tests.
 */

export class InvoiceNotPayableError extends Error {
  constructor(status: string) {
    super(`Invoice status "${status}" cannot accept a new payment (already PAID, VOID, or DRAFT).`);
    this.name = "InvoiceNotPayableError";
  }
}

export class InvoiceForPaymentNotFoundError extends Error {
  constructor() {
    super("No invoice with that id was found in your company.");
    this.name = "InvoiceForPaymentNotFoundError";
  }
}

async function getPayableInvoiceOrThrow(tenantId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({ where: tenantWhere(tenantId, { id: invoiceId }) });
  if (!invoice) throw new InvoiceForPaymentNotFoundError();
  if (invoice.status !== "ISSUED" && invoice.status !== "OVERDUE") throw new InvoiceNotPayableError(invoice.status);
  return invoice;
}

/**
 * Starts a provider checkout (self-service payment — customer Accountant
 * or, in future, a real gateway redirect). A fresh idempotency key per
 * call, so retrying a genuinely failed/expired attempt is always possible;
 * the *provider's own* idempotency guarantee (never double-charging for
 * the same key) is exercised by MockPaymentProvider's own dedupe, unit
 * tested directly.
 */
export async function initiateProviderPayment(session: AuthenticatedSession, invoiceId: string, returnUrl: string, provider: PaymentProvider = getDefaultPaymentProvider()) {
  await requirePermission(session, "payment", "CREATE");
  const invoice = await getPayableInvoiceOrThrow(session.tenantId, invoiceId);

  const idempotencyKey = `invoice:${invoiceId}:attempt:${crypto.randomUUID()}`;
  const checkout = await provider.createCheckoutSession({
    idempotencyKey,
    invoiceId,
    amountMinorUnits: invoice.totalMinorUnits,
    currency: invoice.currency,
    description: `Invoice ${invoice.invoiceNumber}`,
    returnUrl,
  });

  const attempt = await prisma.paymentAttempt.create({
    data: {
      tenantId: session.tenantId,
      invoiceId,
      provider: provider.name,
      status: "PENDING",
      checkoutReference: checkout.providerReference,
      idempotencyKey,
    },
  });

  await recordAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "payment.attemptInitiated",
    entityType: "PaymentAttempt",
    entityId: attempt.id,
    afterValue: { invoiceId, provider: provider.name, providerReference: checkout.providerReference },
  });

  return { attempt, checkoutUrl: checkout.checkoutUrl, providerReference: checkout.providerReference };
}

export class MockSimulationNotAvailableError extends Error {
  constructor() {
    super("Payment simulation is only available when the mock payment provider is active (PAYMENT_PROVIDER=mock) — never in production.");
    this.name = "MockSimulationNotAvailableError";
  }
}

export class NoPendingPaymentAttemptError extends Error {
  constructor() {
    super("No pending payment attempt was found for this invoice — initiate a payment first.");
    this.name = "NoPendingPaymentAttemptError";
  }
}

/**
 * Dev/test-only: drives the *same* webhook-processing path a real provider
 * would asynchronously call, using the deterministic mock provider — this
 * is what the customer Accountant portal's "simulate mock payment" action
 * (and Playwright's P10O minimum-coverage spec) uses to exercise the real
 * success/failure logic without a real payment gateway. Refuses to run
 * unless the mock provider is genuinely the configured default — never
 * available against a production payment-provider configuration.
 */
export async function simulateMockPaymentCompletion(session: AuthenticatedSession, invoiceId: string, outcome: Extract<PaymentProviderPaymentStatus, "SUCCESSFUL" | "FAILED"> = "SUCCESSFUL") {
  await requirePermission(session, "payment", "CREATE");
  const provider = getDefaultPaymentProvider();
  if (!(provider instanceof MockPaymentProvider)) throw new MockSimulationNotAvailableError();

  const invoice = await prisma.invoice.findFirst({ where: tenantWhere(session.tenantId, { id: invoiceId }) });
  if (!invoice) throw new InvoiceForPaymentNotFoundError();

  const attempt = await prisma.paymentAttempt.findFirst({ where: { invoiceId, provider: provider.name, status: "PENDING" }, orderBy: { createdAt: "desc" } });
  if (!attempt || !attempt.checkoutReference) throw new NoPendingPaymentAttemptError();

  const { rawBody, headers } = provider.buildWebhookRequest({
    externalEventId: `sim_${attempt.id}_${outcome}`,
    eventType: "payment.simulated",
    providerReference: attempt.checkoutReference,
    status: outcome,
    amountMinorUnits: invoice.totalMinorUnits,
    currency: invoice.currency,
  });

  return processPaymentProviderEvent(rawBody, headers, provider);
}

async function getPlatformTenantId(): Promise<string> {
  const platformTenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: "platform" } });
  return platformTenant.id;
}

export interface ProcessWebhookResult {
  outcome: "ACCEPTED" | "REJECTED_INVALID_SIGNATURE" | "REJECTED_AMOUNT_MISMATCH" | "REJECTED_CURRENCY_MISMATCH" | "DUPLICATE" | "ERROR";
  paymentId?: string;
}

/**
 * The single entry point for a provider webhook. Order of checks matters:
 * signature authenticity first (never even parse an untrusted payload's
 * business meaning before this passes) -> duplicate-event check (hard DB
 * unique constraint on (provider, externalEventId), not a best-effort
 * lookup) -> resolve the invoice -> amount/currency must match exactly ->
 * only a SUCCESSFUL provider status ever marks the invoice PAID; PENDING/
 * FAILED are recorded but never do. Every branch is audited, including
 * rejection (P10M "provider webhook rejection").
 */
export async function processPaymentProviderEvent(rawBody: string, headers: Record<string, string | undefined>, provider: PaymentProvider = getDefaultPaymentProvider()): Promise<ProcessWebhookResult> {
  const platformTenantId = await getPlatformTenantId();

  if (!provider.validateWebhookAuthenticity(rawBody, headers)) {
    await recordAudit({
      tenantId: platformTenantId,
      userId: null,
      action: "payment.webhookRejectedInvalidSignature",
      entityType: "PaymentProviderEvent",
      entityId: "unknown",
      reason: `provider=${provider.name}`,
    });
    throw new InvalidWebhookSignatureError(provider.name);
  }

  const event = provider.parseWebhookEvent(rawBody, headers);

  const existingEvent = await prisma.paymentProviderEvent.findUnique({ where: { provider_externalEventId: { provider: event.provider, externalEventId: event.externalEventId } } });
  if (existingEvent) {
    // A genuine duplicate delivery of an event already processed — recorded
    // as DUPLICATE, never reprocessed, never a second Payment/email.
    await recordAudit({ tenantId: platformTenantId, userId: null, action: "payment.webhookDuplicateIgnored", entityType: "PaymentProviderEvent", entityId: existingEvent.id });
    return { outcome: "DUPLICATE" };
  }

  const attempt = event.providerReference ? await prisma.paymentAttempt.findFirst({ where: { checkoutReference: event.providerReference } }) : null;
  const invoice = attempt ? await prisma.invoice.findUnique({ where: { id: attempt.invoiceId } }) : null;

  const providerEvent = await prisma.paymentProviderEvent.create({
    data: {
      provider: event.provider,
      externalEventId: event.externalEventId,
      eventType: event.eventType,
      tenantId: invoice?.tenantId ?? null,
      invoiceId: invoice?.id ?? null,
      payload: (event.raw ?? {}) as object,
    },
  });

  if (!invoice || !attempt) {
    await prisma.paymentProviderEvent.update({ where: { id: providerEvent.id }, data: { processingResult: "ERROR", processedAt: new Date() } });
    await recordAudit({ tenantId: platformTenantId, userId: null, action: "payment.webhookUnresolvedReference", entityType: "PaymentProviderEvent", entityId: providerEvent.id });
    return { outcome: "ERROR" };
  }

  if (event.amountMinorUnits != null && event.amountMinorUnits !== invoice.totalMinorUnits) {
    await prisma.paymentProviderEvent.update({ where: { id: providerEvent.id }, data: { processingResult: "REJECTED_AMOUNT_MISMATCH", processedAt: new Date() } });
    await recordAudit({ tenantId: invoice.tenantId, userId: null, action: "payment.webhookRejectedAmountMismatch", entityType: "Invoice", entityId: invoice.id, reason: `expected=${invoice.totalMinorUnits} received=${event.amountMinorUnits}` });
    return { outcome: "REJECTED_AMOUNT_MISMATCH" };
  }
  if (event.currency != null && event.currency !== invoice.currency) {
    await prisma.paymentProviderEvent.update({ where: { id: providerEvent.id }, data: { processingResult: "REJECTED_CURRENCY_MISMATCH", processedAt: new Date() } });
    await recordAudit({ tenantId: invoice.tenantId, userId: null, action: "payment.webhookRejectedCurrencyMismatch", entityType: "Invoice", entityId: invoice.id, reason: `expected=${invoice.currency} received=${event.currency}` });
    return { outcome: "REJECTED_CURRENCY_MISMATCH" };
  }

  await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: event.status ?? "PENDING" } });

  if (event.status !== "SUCCESSFUL") {
    // FAILED/PENDING are recorded and never mark the invoice paid.
    await prisma.paymentProviderEvent.update({ where: { id: providerEvent.id }, data: { processingResult: "ACCEPTED", processedAt: new Date() } });
    await recordAudit({ tenantId: invoice.tenantId, userId: null, action: "payment.attemptResolvedNonSuccess", entityType: "PaymentAttempt", entityId: attempt.id, afterValue: { status: event.status } });
    return { outcome: "ACCEPTED" };
  }

  // A DB transaction: create the Payment, mark the invoice PAID, resolve
  // the attempt — all three succeed or none do.
  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        tenantId: invoice.tenantId,
        invoiceId: invoice.id,
        amountMinorUnits: invoice.totalMinorUnits,
        currency: invoice.currency,
        status: "SUCCESSFUL",
        method: "PROVIDER",
        providerName: event.provider,
        providerReference: event.providerReference,
        idempotencyKey: `webhook:${event.provider}:${event.externalEventId}`,
      },
    });
    await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PAID", paymentReference: event.providerReference } });
    await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "SUCCESSFUL", resolvedPaymentId: created.id } });
    return created;
  });

  await prisma.paymentProviderEvent.update({ where: { id: providerEvent.id }, data: { processingResult: "ACCEPTED", processedAt: new Date() } });

  await recordAudit({
    tenantId: invoice.tenantId,
    userId: null,
    action: "payment.succeeded",
    entityType: "Invoice",
    entityId: invoice.id,
    afterValue: { paymentId: payment.id, amountMinorUnits: payment.amountMinorUnits },
  });

  await restoreSubscriptionIfNoOutstandingInvoices(invoice.tenantId);
  await sendInvoiceEmailForPayment(invoice.tenantId, invoice.id, payment.id, "PAYMENT_SUCCESS").catch((err) => {
    console.error("sendInvoiceEmailForPayment failed after a successful payment", err);
  });

  return { outcome: "ACCEPTED", paymentId: payment.id };
}

async function restoreSubscriptionIfNoOutstandingInvoices(tenantId: string) {
  const outstanding = await prisma.invoice.count({ where: tenantWhere(tenantId, { status: { in: ["ISSUED", "OVERDUE"] as InvoiceStatus[] } }) });
  if (outstanding > 0) return;
  await restoreTenantSubscription(tenantId, null).catch(() => {
    // Not PAST_DUE/SUSPENDED (e.g. already ACTIVE) — nothing to restore, not an error.
  });
}

export interface RecordManualPaymentInput {
  amountMinorUnits: number;
  currency: string;
  proofReference: string;
  note?: string;
  occurredAt?: Date;
}

export class ManualPaymentAmountMismatchError extends Error {
  constructor() {
    super("A manually recorded payment must match the invoice's exact outstanding amount and currency.");
    this.name = "ManualPaymentAmountMismatchError";
  }
}

export class ManualPaymentRequiresProofReferenceError extends Error {
  constructor() {
    super("A manual payment record requires a proof/reference (e.g. an EFT reference) — it can never be recorded from an unverified claim alone.");
    this.name = "ManualPaymentRequiresProofReferenceError";
  }
}

/**
 * An authorised platform finance user's manual payment record (P10G) —
 * always clearly labelled `method: MANUAL`, always requires a
 * proof/reference, always permission-gated (`payment:CREATE`) and
 * mandatorily audited. Never stores a card number, CVV, or online-banking
 * credential — only a safe textual reference the finance user supplies.
 */
export async function recordManualPayment(session: AuthenticatedSession, invoiceId: string, input: RecordManualPaymentInput) {
  await requirePermission(session, "payment", "CREATE");
  if (!input.proofReference || input.proofReference.trim().length === 0) throw new ManualPaymentRequiresProofReferenceError();

  const invoice = await getPayableInvoiceOrThrow(session.tenantId, invoiceId);
  if (input.amountMinorUnits !== invoice.totalMinorUnits || input.currency !== invoice.currency) throw new ManualPaymentAmountMismatchError();

  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        tenantId: invoice.tenantId,
        invoiceId: invoice.id,
        amountMinorUnits: input.amountMinorUnits,
        currency: input.currency,
        status: "SUCCESSFUL",
        method: "MANUAL",
        idempotencyKey: `manual:${invoice.id}:${crypto.randomUUID()}`,
        recordedByUserId: session.userId,
        manualProofReference: input.proofReference,
        manualNote: input.note,
        occurredAt: input.occurredAt ?? new Date(),
      },
    });
    await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PAID", paymentReference: input.proofReference } });
    return created;
  });

  await recordAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "payment.manualApproval",
    entityType: "Invoice",
    entityId: invoice.id,
    afterValue: { paymentId: payment.id, amountMinorUnits: payment.amountMinorUnits, proofReference: input.proofReference },
    reason: input.note,
  });

  await restoreSubscriptionIfNoOutstandingInvoices(invoice.tenantId);
  await sendInvoiceEmailForPayment(invoice.tenantId, invoice.id, payment.id, "MANUAL_APPROVAL").catch((err) => {
    console.error("sendInvoiceEmailForPayment failed after a manual payment approval", err);
  });

  return payment;
}

export async function listPaymentsForTenant(session: AuthenticatedSession, tenantId: string) {
  await requirePermission(session, "payment", "VIEW");
  return prisma.payment.findMany({ where: tenantWhere(tenantId), orderBy: { occurredAt: "desc" } });
}

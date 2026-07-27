import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { ForbiddenError } from "@/lib/auth/authorize";
import { generateBillableVehicleSnapshot } from "@/lib/repositories/billable-vehicle-repository";
import { generateInvoiceForBillingPeriod } from "@/lib/repositories/invoice-repository";
import { updatePlatformBillingSettings } from "@/lib/repositories/platform-billing-repository";
import {
  initiateProviderPayment,
  processPaymentProviderEvent,
  recordManualPayment,
  listPaymentsForTenant,
  ManualPaymentAmountMismatchError,
  ManualPaymentRequiresProofReferenceError,
  InvoiceNotPayableError,
} from "@/lib/repositories/payment-repository";
import { MockPaymentProvider } from "@/lib/billing/payment-provider";
import { getTenantSubscriptionUnchecked, suspendTenantSubscription, markTenantPastDue } from "@/lib/repositories/subscription-repository";
import { createVehicle, createTenant } from "./helpers/fixtures";
import { makeSession, makeSessionForTenant } from "./helpers/billing-session";

const REFERENCE_MONTH = new Date(Date.UTC(2026, 6, 1));

async function ensurePlatformTenant() {
  return prisma.tenant.upsert({ where: { slug: "platform" }, update: {}, create: { name: "Gate Fleet Governance — Platform", slug: "platform" } });
}

async function buildIssuedInvoice(vehicleCount = 1) {
  const tenant = await createTenant();
  for (let i = 0; i < vehicleCount; i++) await createVehicle(tenant.id);
  const snapshot = await generateBillableVehicleSnapshot(tenant.id, REFERENCE_MONTH, null);
  const invoice = await generateInvoiceForBillingPeriod(snapshot.billingPeriodId, null);
  return { tenant, invoice };
}

describe("Phase 10 (P10F/G): payment provider abstraction and processing", () => {
  beforeAll(async () => {
    await ensurePlatformTenant();
    const { session } = await makeSession("Platform Administrator", [["platformBilling", "CONFIGURE"]]);
    await updatePlatformBillingSettings(session, { vatEnabled: false, vatRateBasisPoints: null });
  });

  it("initiateProviderPayment requires payment:CREATE and refuses a non-payable invoice", async () => {
    const { tenant, invoice } = await buildIssuedInvoice();
    const { session: unauthorised } = await makeSessionForTenant(tenant, "Test Unauthorised", []);
    await expect(initiateProviderPayment(unauthorised, invoice.id, "https://example.test/return")).rejects.toBeInstanceOf(ForbiddenError);

    const { session } = await makeSessionForTenant(tenant, "Test Accountant", [["payment", "CREATE"]]);
    const { attempt } = await initiateProviderPayment(session, invoice.id, "https://example.test/return", new MockPaymentProvider());
    expect(attempt.status).toBe("PENDING");
    expect(attempt.provider).toBe("mock");

    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "VOID" } });
    await expect(initiateProviderPayment(session, invoice.id, "https://example.test/return", new MockPaymentProvider())).rejects.toBeInstanceOf(InvoiceNotPayableError);
  });

  it("a successful webhook marks the invoice PAID exactly once, even processed twice (duplicate webhook)", async () => {
    const { tenant, invoice } = await buildIssuedInvoice(5);
    const { session } = await makeSessionForTenant(tenant, "Test Accountant", [["payment", "CREATE"]]);
    const provider = new MockPaymentProvider();
    const { providerReference } = await initiateProviderPayment(session, invoice.id, "https://example.test/return", provider);

    const externalEventId = `evt_${invoice.id}`;
    const { rawBody, headers } = provider.buildWebhookRequest({ externalEventId, eventType: "payment.succeeded", providerReference, status: "SUCCESSFUL", amountMinorUnits: invoice.totalMinorUnits, currency: invoice.currency });

    const first = await processPaymentProviderEvent(rawBody, headers, provider);
    expect(first.outcome).toBe("ACCEPTED");

    const reloaded = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(reloaded.status).toBe("PAID");

    // The exact same event delivered again — a hard DB-constraint-backed no-op, not a second Payment.
    const second = await processPaymentProviderEvent(rawBody, headers, provider);
    expect(second.outcome).toBe("DUPLICATE");

    const payments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(payments).toHaveLength(1);
  });

  it("a FAILED provider status never marks the invoice paid", async () => {
    const { tenant, invoice } = await buildIssuedInvoice(1);
    const { session } = await makeSessionForTenant(tenant, "Test Accountant", [["payment", "CREATE"]]);
    const provider = new MockPaymentProvider();
    const { providerReference } = await initiateProviderPayment(session, invoice.id, "https://example.test/return", provider);

    const { rawBody, headers } = provider.buildWebhookRequest({ externalEventId: `evt_failed_${invoice.id}`, eventType: "payment.failed", providerReference, status: "FAILED", amountMinorUnits: invoice.totalMinorUnits, currency: invoice.currency });
    const result = await processPaymentProviderEvent(rawBody, headers, provider);
    expect(result.outcome).toBe("ACCEPTED"); // the *event* was accepted/recorded — the invoice was not paid

    const reloaded = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(reloaded.status).toBe("ISSUED");
    const payments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(payments).toHaveLength(0);
  });

  it("a PENDING provider status never marks the invoice paid", async () => {
    const { tenant, invoice } = await buildIssuedInvoice(1);
    const { session } = await makeSessionForTenant(tenant, "Test Accountant", [["payment", "CREATE"]]);
    const provider = new MockPaymentProvider();
    const { providerReference } = await initiateProviderPayment(session, invoice.id, "https://example.test/return", provider);

    const { rawBody, headers } = provider.buildWebhookRequest({ externalEventId: `evt_pending_${invoice.id}`, eventType: "payment.pending", providerReference, status: "PENDING", amountMinorUnits: invoice.totalMinorUnits, currency: invoice.currency });
    await processPaymentProviderEvent(rawBody, headers, provider);

    const reloaded = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(reloaded.status).toBe("ISSUED");
  });

  it("rejects a webhook whose amount does not match the invoice exactly", async () => {
    const { tenant, invoice } = await buildIssuedInvoice(1);
    const { session } = await makeSessionForTenant(tenant, "Test Accountant", [["payment", "CREATE"]]);
    const provider = new MockPaymentProvider();
    const { providerReference } = await initiateProviderPayment(session, invoice.id, "https://example.test/return", provider);

    const { rawBody, headers } = provider.buildWebhookRequest({ externalEventId: `evt_amt_${invoice.id}`, eventType: "payment.succeeded", providerReference, status: "SUCCESSFUL", amountMinorUnits: invoice.totalMinorUnits + 100, currency: invoice.currency });
    const result = await processPaymentProviderEvent(rawBody, headers, provider);
    expect(result.outcome).toBe("REJECTED_AMOUNT_MISMATCH");

    const reloaded = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(reloaded.status).toBe("ISSUED");
  });

  it("rejects a webhook whose currency does not match the invoice", async () => {
    const { tenant, invoice } = await buildIssuedInvoice(1);
    const { session } = await makeSessionForTenant(tenant, "Test Accountant", [["payment", "CREATE"]]);
    const provider = new MockPaymentProvider();
    const { providerReference } = await initiateProviderPayment(session, invoice.id, "https://example.test/return", provider);

    const { rawBody, headers } = provider.buildWebhookRequest({ externalEventId: `evt_ccy_${invoice.id}`, eventType: "payment.succeeded", providerReference, status: "SUCCESSFUL", amountMinorUnits: invoice.totalMinorUnits, currency: "USD" });
    const result = await processPaymentProviderEvent(rawBody, headers, provider);
    expect(result.outcome).toBe("REJECTED_CURRENCY_MISMATCH");
  });

  it("rejects a webhook with an invalid signature before trusting any of its content — never a browser-supplied success", async () => {
    const provider = new MockPaymentProvider();
    const rawBody = JSON.stringify({ externalEventId: "evt_forged", eventType: "payment.succeeded", providerReference: "mock_forged", status: "SUCCESSFUL", amountMinorUnits: 1, currency: "ZAR" });
    await expect(processPaymentProviderEvent(rawBody, { "x-mock-signature": "wrong-secret" }, provider)).rejects.toThrow(/authenticity/i);
  });

  it("recordManualPayment requires an exact amount/currency match, a proof reference, and payment:CREATE", async () => {
    const { tenant, invoice } = await buildIssuedInvoice(2);
    const { session } = await makeSessionForTenant(tenant, "Test Finance", [["payment", "CREATE"]]);

    await expect(recordManualPayment(session, invoice.id, { amountMinorUnits: invoice.totalMinorUnits, currency: invoice.currency, proofReference: "" })).rejects.toBeInstanceOf(ManualPaymentRequiresProofReferenceError);
    await expect(recordManualPayment(session, invoice.id, { amountMinorUnits: invoice.totalMinorUnits - 1, currency: invoice.currency, proofReference: "EFT-123" })).rejects.toBeInstanceOf(ManualPaymentAmountMismatchError);

    const payment = await recordManualPayment(session, invoice.id, { amountMinorUnits: invoice.totalMinorUnits, currency: invoice.currency, proofReference: "EFT-123", note: "Bank transfer confirmed by finance" });
    expect(payment.method).toBe("MANUAL");
    expect(payment.status).toBe("SUCCESSFUL");
    expect(payment.manualProofReference).toBe("EFT-123");

    const reloaded = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(reloaded.status).toBe("PAID");

    const { session: unauthorised } = await makeSessionForTenant(tenant, "Test No Perms", []);
    await expect(recordManualPayment(unauthorised, invoice.id, { amountMinorUnits: 1, currency: "ZAR", proofReference: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("never stores a card number, CVV, or banking credential — only a safe textual reference", async () => {
    const { tenant, invoice } = await buildIssuedInvoice(1);
    const { session } = await makeSessionForTenant(tenant, "Test Finance", [["payment", "CREATE"]]);
    const payment = await recordManualPayment(session, invoice.id, { amountMinorUnits: invoice.totalMinorUnits, currency: invoice.currency, proofReference: "Bank ref 998877" });
    // The schema itself has no card/CVV/online-banking-credential field —
    // this asserts the actual stored row's field set matches that intent.
    expect(Object.keys(payment)).not.toContain("cardNumber");
    expect(Object.keys(payment)).not.toContain("cvv");
  });

  it("a successful payment restores a SUSPENDED tenant's subscription once no invoices remain outstanding", async () => {
    const { tenant, invoice } = await buildIssuedInvoice(1);
    await markTenantPastDue(tenant.id, null);
    await prisma.tenantSubscription.update({ where: { tenantId: tenant.id }, data: { status: "PAST_DUE" } });
    await suspendTenantSubscription(tenant.id, "grace period elapsed", null);
    let subscription = await getTenantSubscriptionUnchecked(tenant.id);
    expect(subscription.status).toBe("SUSPENDED");

    const { session } = await makeSessionForTenant(tenant, "Test Finance", [["payment", "CREATE"]]);
    await recordManualPayment(session, invoice.id, { amountMinorUnits: invoice.totalMinorUnits, currency: invoice.currency, proofReference: "EFT-restore" });

    subscription = await getTenantSubscriptionUnchecked(tenant.id);
    expect(subscription.status).toBe("ACTIVE");
  });

  it("listPaymentsForTenant requires payment:VIEW and never returns another tenant's payments", async () => {
    const { tenant, invoice } = await buildIssuedInvoice(1);
    const { session: financeSession } = await makeSessionForTenant(tenant, "Test Finance", [["payment", "CREATE"]]);
    await recordManualPayment(financeSession, invoice.id, { amountMinorUnits: invoice.totalMinorUnits, currency: invoice.currency, proofReference: "EFT-view-test" });

    const { session: unauthorised } = await makeSessionForTenant(tenant, "Test No Perms", []);
    await expect(listPaymentsForTenant(unauthorised, tenant.id)).rejects.toBeInstanceOf(ForbiddenError);

    const { session: viewerSession } = await makeSessionForTenant(tenant, "Test Viewer", [["payment", "VIEW"]]);
    const payments = await listPaymentsForTenant(viewerSession, tenant.id);
    expect(payments.length).toBeGreaterThanOrEqual(1);

    const { session: otherTenantViewer, tenant: otherTenant } = await makeSession("Test Viewer Other", [["payment", "VIEW"]]);
    const otherPayments = await listPaymentsForTenant(otherTenantViewer, otherTenant.id);
    expect(otherPayments.map((p) => p.id)).not.toEqual(expect.arrayContaining(payments.map((p) => p.id)));
  });
});

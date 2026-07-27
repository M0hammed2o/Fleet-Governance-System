import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { requirePermission } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record-audit";
import type { AuthenticatedSession } from "@/lib/auth/session";
import type { BillingEmailTriggerEvent } from "@/generated/prisma/client";
import { getDefaultBillingEmailProvider, type BillingEmailProvider } from "@/lib/billing/billing-email-provider";
import { listActiveCustomerBillingContactEmailsUnchecked } from "@/lib/repositories/tenant-billing-repository";
import { getDefaultObjectStorageProvider } from "@/lib/repositories/media-asset-repository";
import { formatMinorUnits } from "@/lib/billing/money";

/**
 * Phase 10 (P10H) — invoice email delivery. `sendInvoiceEmailForPayment` is
 * the idempotent path called after a genuinely-verified successful payment
 * or a manual approval — the hard duplicate-prevention guarantee is the
 * partial unique index `billing_email_deliveries_one_per_invoice_payment_event`
 * (one PAYMENT_SUCCESS-or-MANUAL_APPROVAL delivery per
 * (invoiceId, relatedPaymentId)), not a best-effort check. A failed send
 * never reverses the payment that triggered it — it is recorded as a
 * visible, retryable delivery failure (`status: FAILED`), and an
 * authorised resend is always available afterward.
 */

function isUniqueConstraintViolation(err: unknown, target: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002" && JSON.stringify((err as { meta?: unknown }).meta ?? "").includes(target);
}

// Reads storage bytes directly by key (server-internal use only, e.g.
// attaching a PDF to an outbound email) — bypasses the signed-URL
// verification path deliberately (there is no browser request/signature
// here at all, this runs entirely server-side), unlike every client-facing
// read which always goes through mintSignedUrlForMediaAsset.
async function loadInvoicePdfBytes(invoiceId: string): Promise<{ fileName: string; bytes: Buffer } | null> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { pdfMediaAsset: true } });
  if (!invoice?.pdfMediaAsset) return null;

  const provider = getDefaultObjectStorageProvider();
  const result = await provider.read(invoice.pdfMediaAsset.storageKey).catch(() => null);
  if (!result) return null;
  return { fileName: invoice.pdfMediaAsset.fileName, bytes: result.data };
}

async function buildDeliveryList(tenantId: string): Promise<string[]> {
  return listActiveCustomerBillingContactEmailsUnchecked(tenantId);
}

/**
 * Idempotent per (invoiceId, paymentId): a second call for the same
 * invoice+payment (e.g. a duplicate webhook that still reaches this far,
 * or a duplicate manual-approval call) creates no additional delivery row
 * and sends no second email — the DB constraint, not application logic
 * alone, is what makes this safe under concurrency.
 */
export async function sendInvoiceEmailForPayment(tenantId: string, invoiceId: string, paymentId: string, triggerEvent: Extract<BillingEmailTriggerEvent, "PAYMENT_SUCCESS" | "MANUAL_APPROVAL">, provider: BillingEmailProvider = getDefaultBillingEmailProvider()) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const recipients = await buildDeliveryList(tenantId);
  if (recipients.length === 0) {
    await recordAudit({ tenantId, userId: null, action: "billingEmail.noRecipientsConfigured", entityType: "Invoice", entityId: invoiceId });
    return [];
  }

  const pdf = await loadInvoicePdfBytes(invoiceId);
  const results = [];
  for (const recipientEmail of recipients) {
    let delivery;
    try {
      delivery = await prisma.billingEmailDelivery.create({
        data: { tenantId, invoiceId, relatedPaymentId: paymentId, recipientEmail, triggerEvent, provider: provider.name, status: "PENDING" },
      });
    } catch (err) {
      if (isUniqueConstraintViolation(err, "billing_email_deliveries_one_per_invoice_payment_event")) {
        // Already sent for this exact (invoice, payment) event — the
        // idempotency guarantee this function exists to provide.
        continue;
      }
      throw err;
    }

    const sendResult = await provider.send({
      to: recipientEmail,
      invoiceNumber: invoice.invoiceNumber,
      subject: `Invoice ${invoice.invoiceNumber} — payment received`,
      bodyText: `Your payment for invoice ${invoice.invoiceNumber} (${formatMinorUnits(invoice.totalMinorUnits, invoice.currency)}) has been received. The invoice is attached.`,
      pdfFileName: pdf?.fileName ?? `${invoice.invoiceNumber}.pdf`,
      pdfBytes: pdf?.bytes ?? Buffer.alloc(0),
    });

    const updated = await prisma.billingEmailDelivery.update({
      where: { id: delivery.id },
      data: { status: sendResult.delivered ? "SENT" : "FAILED", sentAt: sendResult.delivered ? new Date() : null, errorMessage: sendResult.errorMessage },
    });
    results.push(updated);
  }

  await recordAudit({
    tenantId,
    userId: null,
    action: "billingEmail.sent",
    entityType: "Invoice",
    entityId: invoiceId,
    afterValue: { recipientCount: results.length, triggerEvent },
  });

  return results;
}

export class InvoiceForResendNotFoundError extends Error {
  constructor() {
    super("No invoice with that id was found in your company.");
    this.name = "InvoiceForResendNotFoundError";
  }
}

/** An authorised resend — always a deliberate new row (never blocked by the PAYMENT_SUCCESS/MANUAL_APPROVAL idempotency guarantee, which only applies to those two automatic triggers). Records who requested it. */
export async function resendInvoiceEmail(session: AuthenticatedSession, invoiceId: string, recipientEmail: string, provider: BillingEmailProvider = getDefaultBillingEmailProvider()) {
  await requirePermission(session, "billingEmail", "CREATE");
  const invoice = await prisma.invoice.findFirst({ where: tenantWhere(session.tenantId, { id: invoiceId }) });
  if (!invoice) throw new InvoiceForResendNotFoundError();

  const pdf = await loadInvoicePdfBytes(invoiceId);
  const delivery = await prisma.billingEmailDelivery.create({
    data: { tenantId: session.tenantId, invoiceId, recipientEmail, triggerEvent: "RESEND", provider: provider.name, status: "PENDING", triggeredByUserId: session.userId },
  });

  const sendResult = await provider.send({
    to: recipientEmail,
    invoiceNumber: invoice.invoiceNumber,
    subject: `Invoice ${invoice.invoiceNumber} (resent)`,
    bodyText: `A copy of invoice ${invoice.invoiceNumber} is attached, resent at your request.`,
    pdfFileName: pdf?.fileName ?? `${invoice.invoiceNumber}.pdf`,
    pdfBytes: pdf?.bytes ?? Buffer.alloc(0),
  });

  const updated = await prisma.billingEmailDelivery.update({
    where: { id: delivery.id },
    data: { status: sendResult.delivered ? "SENT" : "FAILED", sentAt: sendResult.delivered ? new Date() : null, errorMessage: sendResult.errorMessage },
  });

  await recordAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "billingEmail.resendRequested",
    entityType: "Invoice",
    entityId: invoiceId,
    afterValue: { recipientEmail, delivered: sendResult.delivered },
  });

  return updated;
}

export async function listBillingEmailDeliveriesForInvoice(session: AuthenticatedSession, invoiceId: string) {
  await requirePermission(session, "billingEmail", "VIEW");
  return prisma.billingEmailDelivery.findMany({ where: tenantWhere(session.tenantId, { invoiceId }), orderBy: { createdAt: "desc" } });
}

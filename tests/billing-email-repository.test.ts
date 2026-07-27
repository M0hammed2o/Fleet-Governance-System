import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { ForbiddenError } from "@/lib/auth/authorize";
import { generateBillableVehicleSnapshot } from "@/lib/repositories/billable-vehicle-repository";
import { generateInvoiceForBillingPeriod } from "@/lib/repositories/invoice-repository";
import { updatePlatformBillingSettings } from "@/lib/repositories/platform-billing-repository";
import { upsertTenantBillingProfile } from "@/lib/repositories/tenant-billing-repository";
import { sendInvoiceEmailForPayment, resendInvoiceEmail, listBillingEmailDeliveriesForInvoice } from "@/lib/repositories/billing-email-repository";
import { MockBillingEmailProvider, NoOpBillingEmailProvider } from "@/lib/billing/billing-email-provider";
import { createVehicle, createTenant } from "./helpers/fixtures";
import { makeSession, makeSessionForTenant } from "./helpers/billing-session";

const REFERENCE_MONTH = new Date(Date.UTC(2026, 6, 1));

/**
 * Builds an ISSUED invoice and marks it PAID directly (bypassing
 * `recordManualPayment`, which would itself already trigger a
 * MANUAL_APPROVAL email send as a side effect using the *default* — not
 * this test's chosen mock — provider, colliding with the very
 * (invoiceId, relatedPaymentId) idempotency key these tests need full
 * control over). Mirrors exactly what recordManualPayment persists, minus
 * its own auto-send, so each test can call sendInvoiceEmailForPayment
 * itself as the first and only caller.
 */
async function buildPaidInvoice() {
  const { session, tenant } = await makeSession("Platform Administrator", [["tenantBilling", "EDIT"]]);
  await upsertTenantBillingProfile(session, tenant.id, { accountsContactEmail: "accounts@example.test" });
  await createVehicle(tenant.id);
  const snapshot = await generateBillableVehicleSnapshot(tenant.id, REFERENCE_MONTH, null);
  const invoice = await generateInvoiceForBillingPeriod(snapshot.billingPeriodId, null);

  const payment = await prisma.payment.create({
    data: {
      tenantId: tenant.id,
      invoiceId: invoice.id,
      amountMinorUnits: invoice.totalMinorUnits,
      currency: invoice.currency,
      status: "SUCCESSFUL",
      method: "MANUAL",
      idempotencyKey: `test-manual:${invoice.id}`,
      manualProofReference: "EFT-email-test",
    },
  });
  await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "PAID" } });

  return { tenant, invoice, payment };
}

describe("Phase 10 (P10H): invoice email workflow", () => {
  beforeAll(async () => {
    const { session } = await makeSession("Platform Administrator", [["platformBilling", "CONFIGURE"]]);
    await updatePlatformBillingSettings(session, { vatEnabled: false, vatRateBasisPoints: null });
  });

  it("NoOpBillingEmailProvider never claims delivery", async () => {
    const provider = new NoOpBillingEmailProvider();
    const result = await provider.send({ to: "x@example.test", invoiceNumber: "INV-1", subject: "s", bodyText: "b", pdfFileName: "f.pdf", pdfBytes: Buffer.alloc(1) });
    expect(result.delivered).toBe(false);
  });

  it("sends exactly one email per active billing contact for a genuine successful-payment event, via the mock dev provider, never a real external send", async () => {
    const { tenant, invoice, payment } = await buildPaidInvoice();
    const provider = new MockBillingEmailProvider();

    const results = await sendInvoiceEmailForPayment(tenant.id, invoice.id, payment.id, "PAYMENT_SUCCESS", provider);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("SENT");
    expect(results[0].recipientEmail).toBe("accounts@example.test");
    expect(provider.getSentSummaries()).toHaveLength(1);
  });

  it("is idempotent per (invoice, payment): calling it twice for the same successful-payment event sends no second email", async () => {
    const { tenant, invoice, payment } = await buildPaidInvoice();
    const provider = new MockBillingEmailProvider();

    await sendInvoiceEmailForPayment(tenant.id, invoice.id, payment.id, "PAYMENT_SUCCESS", provider);
    await sendInvoiceEmailForPayment(tenant.id, invoice.id, payment.id, "PAYMENT_SUCCESS", provider);

    const deliveries = await prisma.billingEmailDelivery.findMany({ where: { invoiceId: invoice.id, relatedPaymentId: payment.id } });
    expect(deliveries).toHaveLength(1);
    expect(provider.getSentSummaries()).toHaveLength(1);
  });

  it("is idempotent under real concurrency: many simultaneous calls for the same (invoice, payment) send at most one email", async () => {
    const { tenant, invoice, payment } = await buildPaidInvoice();
    const provider = new MockBillingEmailProvider();

    await Promise.all(Array.from({ length: 8 }, () => sendInvoiceEmailForPayment(tenant.id, invoice.id, payment.id, "PAYMENT_SUCCESS", provider)));

    const deliveries = await prisma.billingEmailDelivery.findMany({ where: { invoiceId: invoice.id, relatedPaymentId: payment.id } });
    expect(deliveries).toHaveLength(1);
  });

  it("an authorised resend is always a new, deliberate delivery — never blocked by the payment-event idempotency guarantee", async () => {
    const { tenant, invoice, payment } = await buildPaidInvoice();
    const provider = new MockBillingEmailProvider();
    await sendInvoiceEmailForPayment(tenant.id, invoice.id, payment.id, "PAYMENT_SUCCESS", provider);

    const { session: unauthorised } = await makeSessionForTenant(tenant, "Test No Perms", []);
    await expect(resendInvoiceEmail(unauthorised, invoice.id, "someone@example.test", provider)).rejects.toBeInstanceOf(ForbiddenError);

    const { session: resenderSession } = await makeSessionForTenant(tenant, "Test Resender", [["billingEmail", "CREATE"]]);
    const resend1 = await resendInvoiceEmail(resenderSession, invoice.id, "someone@example.test", provider);
    expect(resend1.status).toBe("SENT");
    expect(resend1.triggeredByUserId).toBe(resenderSession.userId);

    const resend2 = await resendInvoiceEmail(resenderSession, invoice.id, "someone@example.test", provider);
    expect(resend2.status).toBe("SENT");

    const deliveries = await prisma.billingEmailDelivery.findMany({ where: { invoiceId: invoice.id, triggerEvent: "RESEND" } });
    expect(deliveries).toHaveLength(2); // both resends recorded — RESEND is never deduped
  });

  it("a failed send is recorded, visible, and never reverses the payment that triggered it", async () => {
    const { tenant, invoice, payment } = await buildPaidInvoice();
    const failingProvider = new NoOpBillingEmailProvider();

    const results = await sendInvoiceEmailForPayment(tenant.id, invoice.id, payment.id, "PAYMENT_SUCCESS", failingProvider);
    expect(results[0].status).toBe("FAILED");

    const reloadedInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(reloadedInvoice.status).toBe("PAID"); // the payment is untouched by the email failure

    const reloadedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(reloadedPayment.status).toBe("SUCCESSFUL");
  });

  it("listBillingEmailDeliveriesForInvoice requires billingEmail:VIEW", async () => {
    const { tenant, invoice, payment } = await buildPaidInvoice();
    await sendInvoiceEmailForPayment(tenant.id, invoice.id, payment.id, "PAYMENT_SUCCESS", new MockBillingEmailProvider());

    const { session: unauthorised } = await makeSessionForTenant(tenant, "Test No Perms", []);
    await expect(listBillingEmailDeliveriesForInvoice(unauthorised, invoice.id)).rejects.toBeInstanceOf(ForbiddenError);

    const { session: viewerSession } = await makeSessionForTenant(tenant, "Test Viewer", [["billingEmail", "VIEW"]]);
    const deliveries = await listBillingEmailDeliveriesForInvoice(viewerSession, invoice.id);
    expect(deliveries.length).toBeGreaterThanOrEqual(1);
  });

  it("no recipients configured: records nothing, sends nothing, never throws", async () => {
    const tenant = await createTenant();
    await createVehicle(tenant.id);
    const snapshot = await generateBillableVehicleSnapshot(tenant.id, REFERENCE_MONTH, null);
    const invoice = await generateInvoiceForBillingPeriod(snapshot.billingPeriodId, null);
    const payment = await prisma.payment.create({
      data: { tenantId: tenant.id, invoiceId: invoice.id, amountMinorUnits: invoice.totalMinorUnits, currency: invoice.currency, status: "SUCCESSFUL", method: "MANUAL", idempotencyKey: `test-manual:${invoice.id}`, manualProofReference: "no-contacts" },
    });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "PAID" } });

    const results = await sendInvoiceEmailForPayment(tenant.id, invoice.id, payment.id, "PAYMENT_SUCCESS", new MockBillingEmailProvider());
    expect(results).toEqual([]);
  });
});

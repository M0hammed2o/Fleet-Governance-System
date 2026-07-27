import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { ForbiddenError } from "@/lib/auth/authorize";
import { generateBillableVehicleSnapshot } from "@/lib/repositories/billable-vehicle-repository";
import {
  generateInvoiceForBillingPeriod,
  voidInvoice,
  reissueInvoice,
  listInvoicesForTenant,
  getInvoiceForTenant,
  InvoiceNotFoundError,
  InvoiceAlreadyPaidError,
  InvoiceMustBeVoidedBeforeReissueError,
  SnapshotRequiredBeforeInvoiceError,
  BillingPeriodNotFoundError,
} from "@/lib/repositories/invoice-repository";
import { updatePlatformBillingSettings } from "@/lib/repositories/platform-billing-repository";
import { createVehicle, createTenant } from "./helpers/fixtures";
import { makeSession, makeSessionForTenant } from "./helpers/billing-session";

const REFERENCE_MONTH = new Date(Date.UTC(2026, 6, 1));

async function ensureVatDisabled() {
  const { session } = await makeSession("Platform Administrator", [["platformBilling", "CONFIGURE"]]);
  await updatePlatformBillingSettings(session, { vatEnabled: false, vatRateBasisPoints: null });
}

async function buildSnapshottedPeriod(vehicleCount: number, reference: Date = REFERENCE_MONTH) {
  const tenant = await createTenant();
  for (let i = 0; i < vehicleCount; i++) await createVehicle(tenant.id);
  const snapshot = await generateBillableVehicleSnapshot(tenant.id, reference, null);
  return { tenant, snapshot, billingPeriodId: snapshot.billingPeriodId };
}

describe("Phase 10 (P10E): invoice generation", () => {
  beforeAll(async () => {
    // PlatformBillingSettings is a genuine platform-wide singleton — this
    // whole file assumes VAT is off unless a specific test explicitly
    // configures it, so arrange that starting state up front rather than
    // trust whatever an earlier test run/file left behind.
    await ensureVatDisabled();
  });

  it("refuses to generate an invoice before a billable-vehicle snapshot exists for the period", async () => {
    const tenant = await createTenant();
    const billingPeriod = await prisma.billingPeriod.create({ data: { tenantId: tenant.id, periodStart: REFERENCE_MONTH, periodEnd: new Date(Date.UTC(2026, 7, 1)) } });
    await expect(generateInvoiceForBillingPeriod(billingPeriod.id, null)).rejects.toBeInstanceOf(SnapshotRequiredBeforeInvoiceError);
  });

  it("throws for a nonexistent billing period id", async () => {
    await expect(generateInvoiceForBillingPeriod("does-not-exist", null)).rejects.toBeInstanceOf(BillingPeriodNotFoundError);
  });

  it("matches the approved worked example exactly: 15 vehicles -> R6,484 subtotal, no VAT charged", async () => {
    const { billingPeriodId } = await buildSnapshottedPeriod(15);
    const invoice = await generateInvoiceForBillingPeriod(billingPeriodId, null);

    expect(invoice.subtotalMinorUnits).toBe(648_400);
    expect(invoice.vatAmountMinorUnits).toBe(0);
    expect(invoice.totalMinorUnits).toBe(648_400);
    expect(invoice.status).toBe("ISSUED");
    expect(invoice.lineItems).toHaveLength(2);
    expect(invoice.lineItems.find((li) => li.kind === "BASE_FEE")?.lineTotalMinorUnits).toBe(199_900);
    expect(invoice.lineItems.find((li) => li.kind === "VEHICLE_FEE")?.lineTotalMinorUnits).toBe(448_500);
    expect(invoice.lineItems.find((li) => li.kind === "VEHICLE_FEE")?.quantity).toBe(15);
  });

  it("applies VAT and marks the document a tax invoice only when the platform's VAT registration + rate are configured", async () => {
    const { session } = await makeSession("Platform Administrator", [["platformBilling", "CONFIGURE"]]);
    await updatePlatformBillingSettings(session, { vatEnabled: true, vatRateBasisPoints: 1500, vatRegistrationNumber: "4123456789" });

    const { billingPeriodId } = await buildSnapshottedPeriod(15);
    const invoice = await generateInvoiceForBillingPeriod(billingPeriodId, null);

    expect(invoice.vatRateBasisPoints).toBe(1500);
    expect(invoice.vatAmountMinorUnits).toBe(97_260);
    expect(invoice.totalMinorUnits).toBe(745_660);

    await ensureVatDisabled();
  });

  it("never charges VAT if the platform has no VAT registration number configured, even if a rate/enabled flag exist", async () => {
    const { session } = await makeSession("Platform Administrator", [["platformBilling", "CONFIGURE"]]);
    await updatePlatformBillingSettings(session, { vatEnabled: true, vatRateBasisPoints: 1500, vatRegistrationNumber: null });

    const { billingPeriodId } = await buildSnapshottedPeriod(1);
    const invoice = await generateInvoiceForBillingPeriod(billingPeriodId, null);

    expect(invoice.vatAmountMinorUnits).toBe(0);
    expect(invoice.vatRateBasisPoints).toBeNull();

    await ensureVatDisabled();
  });

  it("0 vehicles: only the base fee, a valid invoice, never an error", async () => {
    const { billingPeriodId } = await buildSnapshottedPeriod(0);
    const invoice = await generateInvoiceForBillingPeriod(billingPeriodId, null);
    expect(invoice.subtotalMinorUnits).toBe(199_900);
    expect(invoice.lineItems.find((li) => li.kind === "VEHICLE_FEE")?.lineTotalMinorUnits).toBe(0);
  });

  it("1 vehicle: base + exactly one vehicle fee", async () => {
    const { billingPeriodId } = await buildSnapshottedPeriod(1);
    const invoice = await generateInvoiceForBillingPeriod(billingPeriodId, null);
    expect(invoice.subtotalMinorUnits).toBe(229_800);
  });

  it("is idempotent for the same billing period: a second call returns the identical invoice, never a duplicate", async () => {
    const { billingPeriodId } = await buildSnapshottedPeriod(3);
    const first = await generateInvoiceForBillingPeriod(billingPeriodId, null);
    const second = await generateInvoiceForBillingPeriod(billingPeriodId, null);
    expect(second.id).toBe(first.id);

    const allInvoices = await prisma.invoice.findMany({ where: { billingPeriodId } });
    expect(allInvoices).toHaveLength(1);
  });

  it("is idempotent under real concurrency: many simultaneous calls for the same billing period never create more than one invoice", async () => {
    const { billingPeriodId } = await buildSnapshottedPeriod(2);
    const results = await Promise.all(Array.from({ length: 8 }, () => generateInvoiceForBillingPeriod(billingPeriodId, null)));
    const distinctIds = new Set(results.map((r) => r.id));
    expect(distinctIds.size).toBe(1);

    const allInvoices = await prisma.invoice.findMany({ where: { billingPeriodId } });
    expect(allInvoices).toHaveLength(1);
  });

  it("every invoice gets a unique sequential invoice number, even generated concurrently across different tenants", async () => {
    const periods = await Promise.all(Array.from({ length: 5 }, () => buildSnapshottedPeriod(1, new Date(Date.UTC(2026, 8, 1)))));
    const invoices = await Promise.all(periods.map((p) => generateInvoiceForBillingPeriod(p.billingPeriodId, null)));
    const numbers = new Set(invoices.map((i) => i.invoiceNumber));
    expect(numbers.size).toBe(5);
  });

  it("renders and attaches a PDF via the existing MediaAsset/object-storage architecture", async () => {
    const { billingPeriodId } = await buildSnapshottedPeriod(2);
    const invoice = await generateInvoiceForBillingPeriod(billingPeriodId, null);

    const reloaded = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { pdfMediaAsset: true } });
    expect(reloaded.pdfMediaAssetId).toBeTruthy();
    expect(reloaded.pdfMediaAsset?.ownerType).toBe("INVOICE");
    expect(reloaded.pdfMediaAsset?.ownerId).toBe(invoice.id);
    expect(reloaded.pdfMediaAsset?.category).toBe("GENERATED_REPORT");
    expect(reloaded.pdfMediaAsset?.contentType).toBe("application/pdf");
    expect(reloaded.pdfMediaAsset?.fileSizeBytes).toBeGreaterThan(0);
    // System-generated — no human captured it (P9F/media-asset nullability change).
    expect(reloaded.pdfMediaAsset?.capturedByUserId).toBeNull();
  });

  it("an issued invoice is an immutable snapshot: a later pricing change never rewrites it", async () => {
    const { billingPeriodId } = await buildSnapshottedPeriod(1);
    const invoice = await generateInvoiceForBillingPeriod(billingPeriodId, null);
    const totalAtIssue = invoice.totalMinorUnits;

    const { session } = await makeSession("Platform Administrator", [["platformBilling", "CONFIGURE"]]);
    await updatePlatformBillingSettings(session, { defaultBaseFeeMinorUnits: 1 });

    const reloaded = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(reloaded.totalMinorUnits).toBe(totalAtIssue);

    await updatePlatformBillingSettings(session, { defaultBaseFeeMinorUnits: 199_900 }); // restore for other tests in this file
  });

  it("void requires invoice:EDIT and refuses to void an already-PAID invoice; cannot double-void", async () => {
    const { billingPeriodId, tenant } = await buildSnapshottedPeriod(1);
    const invoice = await generateInvoiceForBillingPeriod(billingPeriodId, null);

    const { session: unauthorised } = await makeSession("Gate Security Officer", []);
    await expect(voidInvoice(unauthorised, invoice.id, "test")).rejects.toBeInstanceOf(ForbiddenError);

    const { session: adminSession } = await makeSession("Platform Administrator", [["invoice", "EDIT"]]);
    // Different tenant's session cannot see this invoice at all — cross-tenant isolation.
    await expect(voidInvoice(adminSession, invoice.id, "test")).rejects.toBeInstanceOf(InvoiceNotFoundError);

    // A role scoped to the invoice's own tenant.
    const { session: voiderSession } = await makeSessionForTenant(tenant, "Test Voider", [["invoice", "EDIT"]]);

    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "PAID" } });
    await expect(voidInvoice(voiderSession, invoice.id, "should be rejected")).rejects.toBeInstanceOf(InvoiceAlreadyPaidError);
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "ISSUED" } });

    const voided = await voidInvoice(voiderSession, invoice.id, "duplicate charge");
    expect(voided.status).toBe("VOID");

    await expect(voidInvoice(voiderSession, invoice.id, "again")).rejects.toThrow(/already been voided/);
  });

  it("reissue requires the original to be VOID first, and links back via reissueOfInvoiceId", async () => {
    const { billingPeriodId, tenant } = await buildSnapshottedPeriod(1);
    const invoice = await generateInvoiceForBillingPeriod(billingPeriodId, null);

    const { session } = await makeSessionForTenant(tenant, "Test Reissuer", [["invoice", "EDIT"]]);

    await expect(reissueInvoice(session, invoice.id, "correction")).rejects.toBeInstanceOf(InvoiceMustBeVoidedBeforeReissueError);

    await voidInvoice(session, invoice.id, "wrong vehicle count");
    const reissued = await reissueInvoice(session, invoice.id, "corrected vehicle count");
    expect(reissued.reissueOfInvoiceId).toBe(invoice.id);
    expect(reissued.invoiceNumber).not.toBe(invoice.invoiceNumber);
    expect(reissued.totalMinorUnits).toBe(invoice.totalMinorUnits);
  });

  it("listInvoicesForTenant/getInvoiceForTenant require invoice:VIEW and never return another tenant's invoices", async () => {
    const { billingPeriodId, tenant } = await buildSnapshottedPeriod(1);
    const invoice = await generateInvoiceForBillingPeriod(billingPeriodId, null);

    const { session: unauthorised } = await makeSession("Gate Security Officer", []);
    await expect(listInvoicesForTenant(unauthorised, tenant.id)).rejects.toBeInstanceOf(ForbiddenError);

    const { session: viewerSession } = await makeSessionForTenant(tenant, "Test Viewer", [["invoice", "VIEW"]]);

    const list = await listInvoicesForTenant(viewerSession, tenant.id);
    expect(list.map((i) => i.id)).toContain(invoice.id);

    const fetched = await getInvoiceForTenant(viewerSession, tenant.id, invoice.id);
    expect(fetched.id).toBe(invoice.id);

    // A different tenant's own VIEW-permitted session can never fetch this invoice.
    const { session: otherTenantSession } = await makeSession("Platform Administrator", [["invoice", "VIEW"]]);
    await expect(getInvoiceForTenant(otherTenantSession, otherTenantSession.tenantId, invoice.id)).rejects.toBeInstanceOf(InvoiceNotFoundError);
  });
});

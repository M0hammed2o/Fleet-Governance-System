import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { requirePermission } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record-audit";
import type { AuthenticatedSession } from "@/lib/auth/session";
import { calculateBillableFees } from "@/lib/billing/money";
import { renderInvoicePdf } from "@/lib/billing/invoice-pdf";
import { formatBillingPeriodLabel } from "@/lib/billing/billing-period";
import { allocateNextInvoiceNumber, getPlatformBillingSettingsUnchecked } from "@/lib/repositories/platform-billing-repository";
import { getTenantBillingProfileUnchecked } from "@/lib/repositories/tenant-billing-repository";
import { activateTenantSubscription, markTenantPastDue } from "@/lib/repositories/subscription-repository";
import { uploadMediaAsset } from "@/lib/repositories/media-asset-repository";

/**
 * Phase 10 (P10E) — invoice generation from an already-snapshotted
 * BillingPeriod, PDF rendering/storage via the existing MediaAsset/
 * object-storage architecture, and the controlled void/reissue correction
 * process. An invoice is an immutable snapshot: once created, its stored
 * amounts/supplier/customer JSON never change even if pricing, VAT
 * configuration, or the tenant's billing profile change afterward (D-035)
 * — a correction is always a new, linked invoice (reissue) or a
 * CreditAdjustment, never a silent in-place edit.
 */

export class BillingPeriodNotFoundError extends Error {
  constructor() {
    super("No billing period with that id was found.");
    this.name = "BillingPeriodNotFoundError";
  }
}

export class SnapshotRequiredBeforeInvoiceError extends Error {
  constructor() {
    super("A billable-vehicle snapshot must be generated for this billing period before an invoice can be created.");
    this.name = "SnapshotRequiredBeforeInvoiceError";
  }
}

function isUniqueConstraintViolation(err: unknown, target: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002" && JSON.stringify((err as { meta?: unknown }).meta ?? "").includes(target);
}

function buildAddressLines(parts: Array<string | null | undefined>): string[] {
  return parts.filter((p): p is string => !!p && p.trim().length > 0);
}

/**
 * Idempotent: calling this twice for the same billing period (including
 * concurrently) always returns the same invoice, never creates a second
 * one — the hard guarantee is the DB-level unique constraint on
 * `Invoice.billingPeriodId`. A PDF-rendering/storage failure does not
 * undo the financial record; the invoice row is created first, in its own
 * transaction, and the PDF is attached afterward (best-effort, with its
 * own audit trail on failure — the invoice always exists and is correct
 * even if the PDF needs a manual retry).
 */
export async function generateInvoiceForBillingPeriod(billingPeriodId: string, actorUserId: string | null) {
  const billingPeriod = await prisma.billingPeriod.findUnique({
    where: { id: billingPeriodId },
    include: { invoice: true, billableVehicleSnapshot: true },
  });
  if (!billingPeriod) throw new BillingPeriodNotFoundError();
  if (billingPeriod.invoice) return getInvoiceWithDetailsUnchecked(billingPeriod.invoice.id);
  if (!billingPeriod.billableVehicleSnapshot) throw new SnapshotRequiredBeforeInvoiceError();

  const snapshot = billingPeriod.billableVehicleSnapshot;
  const [platformSettings, tenantProfile, tenant] = await Promise.all([
    getPlatformBillingSettingsUnchecked(),
    getTenantBillingProfileUnchecked(billingPeriod.tenantId),
    prisma.tenant.findUniqueOrThrow({ where: { id: billingPeriod.tenantId } }),
  ]);

  const isVatTaxInvoice = platformSettings.vatEnabled && !!platformSettings.vatRegistrationNumber && platformSettings.vatRateBasisPoints != null;
  const fees = calculateBillableFees({
    baseFeeMinorUnits: snapshot.baseFeeMinorUnitsApplied,
    perVehicleFeeMinorUnits: snapshot.perVehicleFeeMinorUnitsApplied,
    vehicleCount: snapshot.vehicleCount,
    vatRateBasisPoints: isVatTaxInvoice ? platformSettings.vatRateBasisPoints : null,
  });

  const issueDate = new Date();
  const paymentTermsDays = tenantProfile?.paymentTermsDays ?? platformSettings.defaultPaymentTermsDays;
  const dueDate = new Date(issueDate.getTime() + paymentTermsDays * 24 * 60 * 60 * 1000);
  const invoiceNumber = await allocateNextInvoiceNumber();

  const supplierSnapshot = {
    legalName: platformSettings.legalName,
    tradingName: platformSettings.tradingName,
    registrationNumber: platformSettings.registrationNumber,
    vatRegistrationNumber: isVatTaxInvoice ? platformSettings.vatRegistrationNumber : null,
    addressLines: buildAddressLines([platformSettings.addressLine1, platformSettings.addressLine2, platformSettings.city, platformSettings.postalCode, platformSettings.country]),
    billingEmail: platformSettings.billingEmail,
    telephone: platformSettings.telephone,
    bankingInstructions: platformSettings.bankingInstructions,
  };
  const customerSnapshot = {
    name: tenantProfile?.registeredBusinessName || tenant.name,
    tradingName: tenantProfile?.tradingName,
    registrationNumber: tenantProfile?.registrationNumber,
    vatNumber: tenantProfile?.vatNumber,
    addressLines: buildAddressLines([tenantProfile?.billingAddressLine1, tenantProfile?.billingAddressLine2, tenantProfile?.billingCity, tenantProfile?.billingPostalCode, tenantProfile?.billingCountry]),
    billingEmail: tenantProfile?.billingEmail,
    customerReference: tenantProfile?.customerReference,
  };

  let invoice;
  try {
    invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          tenantId: billingPeriod.tenantId,
          billingPeriodId: billingPeriod.id,
          invoiceNumber,
          status: "ISSUED",
          issueDate,
          dueDate,
          currency: snapshot.currency,
          subtotalMinorUnits: fees.subtotalMinorUnits,
          vatRateBasisPoints: isVatTaxInvoice ? platformSettings.vatRateBasisPoints : null,
          vatAmountMinorUnits: fees.vatAmountMinorUnits,
          totalMinorUnits: fees.totalMinorUnits,
          supplierSnapshot,
          customerSnapshot,
          customerPoReference: tenantProfile?.customerReference,
          createdByUserId: actorUserId,
          lineItems: {
            create: [
              { kind: "BASE_FEE", description: "Monthly platform base fee", quantity: 1, unitPriceMinorUnits: snapshot.baseFeeMinorUnitsApplied, lineTotalMinorUnits: snapshot.baseFeeMinorUnitsApplied, sortOrder: 0 },
              {
                kind: "VEHICLE_FEE",
                description: `Active vehicle fee — ${snapshot.vehicleCount} vehicle${snapshot.vehicleCount === 1 ? "" : "s"} (${formatBillingPeriodLabel(billingPeriod.periodStart)})`,
                quantity: snapshot.vehicleCount,
                unitPriceMinorUnits: snapshot.perVehicleFeeMinorUnitsApplied,
                lineTotalMinorUnits: fees.vehicleFeeMinorUnits,
                sortOrder: 1,
              },
            ],
          },
        },
        include: { lineItems: true },
      });
      await tx.billingPeriod.update({ where: { id: billingPeriod.id }, data: { status: "INVOICED" } });
      return created;
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err, "billingPeriodId")) {
      const existing = await prisma.invoice.findUnique({ where: { billingPeriodId: billingPeriod.id } });
      if (existing) return getInvoiceWithDetailsUnchecked(existing.id);
    }
    throw err;
  }

  await recordAudit({
    tenantId: billingPeriod.tenantId,
    userId: actorUserId,
    action: "invoice.generated",
    entityType: "Invoice",
    entityId: invoice.id,
    afterValue: { invoiceNumber, totalMinorUnits: fees.totalMinorUnits, vehicleCount: snapshot.vehicleCount },
  });

  // A tenant's first invoice moves its subscription out of PENDING. Never
  // fails the whole invoice-generation call if this has an issue — the
  // financial record is the primary concern; subscription-state
  // reconciliation can be retried independently.
  await activateTenantSubscription(billingPeriod.tenantId, actorUserId).catch((err) => {
    console.error("activateTenantSubscription failed after invoice generation", err);
  });

  await attachInvoicePdf(invoice.id, { isVatTaxInvoice, billingPeriodLabel: formatBillingPeriodLabel(billingPeriod.periodStart) }).catch(async (err) => {
    await recordAudit({
      tenantId: billingPeriod.tenantId,
      userId: actorUserId,
      action: "invoice.pdfGenerationFailed",
      entityType: "Invoice",
      entityId: invoice.id,
      reason: err instanceof Error ? err.message : "unknown error",
    });
  });

  return getInvoiceWithDetailsUnchecked(invoice.id);
}

async function attachInvoicePdf(invoiceId: string, extra: { isVatTaxInvoice: boolean; billingPeriodLabel: string }) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lineItems: true } });
  const supplier = invoice.supplierSnapshot as { legalName: string; tradingName?: string | null; registrationNumber?: string | null; vatRegistrationNumber?: string | null; addressLines: string[]; billingEmail?: string | null; telephone?: string | null; bankingInstructions?: string | null };
  const customer = invoice.customerSnapshot as { name: string; registrationNumber?: string | null; vatNumber?: string | null; addressLines: string[]; billingEmail?: string | null };

  const pdfBytes = await renderInvoicePdf({
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    billingPeriodLabel: extra.billingPeriodLabel,
    currency: invoice.currency,
    supplier,
    customer,
    lineItems: invoice.lineItems.map((li) => ({ description: li.description, quantity: li.quantity, unitPriceMinorUnits: li.unitPriceMinorUnits, lineTotalMinorUnits: li.lineTotalMinorUnits })),
    subtotalMinorUnits: invoice.subtotalMinorUnits,
    vatRateBasisPoints: invoice.vatRateBasisPoints,
    vatAmountMinorUnits: invoice.vatAmountMinorUnits,
    totalMinorUnits: invoice.totalMinorUnits,
    customerPoReference: invoice.customerPoReference,
    paymentReference: invoice.paymentReference,
    paymentStatusLabel: invoice.status,
    isVatTaxInvoice: extra.isVatTaxInvoice,
  });

  const mediaAsset = await uploadMediaAsset({
    tenantId: invoice.tenantId,
    actorUserId: invoice.createdByUserId,
    ownerType: "INVOICE",
    ownerId: invoice.id,
    fileName: `${invoice.invoiceNumber}.pdf`,
    contentType: "application/pdf",
    data: pdfBytes,
    idempotencyKey: `invoice-pdf:${invoice.id}`,
    category: "GENERATED_REPORT",
  });

  await prisma.invoice.update({ where: { id: invoice.id }, data: { pdfMediaAssetId: mediaAsset.id } });
}

/** Regenerates and (re)attaches the PDF for an existing invoice — e.g. after a transient failure. Does not change any financial field. */
export async function regenerateInvoicePdf(session: AuthenticatedSession, invoiceId: string) {
  await requirePermission(session, "invoice", "EDIT");
  const invoice = await prisma.invoice.findFirst({ where: tenantWhere(session.tenantId, { id: invoiceId }) });
  if (!invoice) throw new InvoiceNotFoundError();
  const platformSettings = await getPlatformBillingSettingsUnchecked();
  const isVatTaxInvoice = invoice.vatRateBasisPoints != null && platformSettings.vatEnabled;
  const billingPeriod = invoice.billingPeriodId ? await prisma.billingPeriod.findUnique({ where: { id: invoice.billingPeriodId } }) : null;
  await attachInvoicePdf(invoiceId, { isVatTaxInvoice, billingPeriodLabel: billingPeriod ? formatBillingPeriodLabel(billingPeriod.periodStart) : "" });

  await recordAudit({ tenantId: session.tenantId, userId: session.userId, action: "invoice.pdfRegenerated", entityType: "Invoice", entityId: invoiceId });

  return getInvoiceWithDetailsUnchecked(invoiceId);
}

export class InvoiceNotFoundError extends Error {
  constructor() {
    super("No invoice with that id was found in your company.");
    this.name = "InvoiceNotFoundError";
  }
}

export class InvoiceAlreadyVoidError extends Error {
  constructor() {
    super("This invoice has already been voided.");
    this.name = "InvoiceAlreadyVoidError";
  }
}

export class InvoiceAlreadyPaidError extends Error {
  constructor() {
    super("A paid invoice cannot be voided directly — use a credit adjustment or a controlled reissue instead.");
    this.name = "InvoiceAlreadyPaidError";
  }
}

/** A controlled void: never a silent regeneration — records who, when, and why (P10E). */
export async function voidInvoice(session: AuthenticatedSession, invoiceId: string, reason: string) {
  await requirePermission(session, "invoice", "EDIT");
  const invoice = await prisma.invoice.findFirst({ where: tenantWhere(session.tenantId, { id: invoiceId }) });
  if (!invoice) throw new InvoiceNotFoundError();
  if (invoice.status === "VOID") throw new InvoiceAlreadyVoidError();
  if (invoice.status === "PAID") throw new InvoiceAlreadyPaidError();

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: "VOID", voidedAt: new Date(), voidedByUserId: session.userId, voidReason: reason },
  });

  await recordAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "invoice.voided",
    entityType: "Invoice",
    entityId: invoiceId,
    beforeValue: { status: invoice.status },
    afterValue: { status: updated.status },
    reason,
  });

  return updated;
}

/**
 * Reissues a voided invoice as a brand-new invoice (new sequential number,
 * fresh snapshot/PDF) linked back to the original via `reissueOfInvoiceId`
 * — a controlled correction, never a silent in-place edit (P10E).
 */
export async function reissueInvoice(session: AuthenticatedSession, originalInvoiceId: string, reason: string) {
  await requirePermission(session, "invoice", "EDIT");
  const original = await prisma.invoice.findFirst({ where: tenantWhere(session.tenantId, { id: originalInvoiceId }), include: { lineItems: true } });
  if (!original) throw new InvoiceNotFoundError();
  if (original.status !== "VOID") throw new InvoiceMustBeVoidedBeforeReissueError();

  const invoiceNumber = await allocateNextInvoiceNumber();
  const dueDate = new Date(Date.now() + (original.dueDate.getTime() - original.issueDate.getTime()));

  const reissued = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        tenantId: original.tenantId,
        invoiceNumber,
        status: "ISSUED",
        issueDate: new Date(),
        dueDate,
        currency: original.currency,
        subtotalMinorUnits: original.subtotalMinorUnits,
        vatRateBasisPoints: original.vatRateBasisPoints,
        vatAmountMinorUnits: original.vatAmountMinorUnits,
        totalMinorUnits: original.totalMinorUnits,
        supplierSnapshot: original.supplierSnapshot as object,
        customerSnapshot: original.customerSnapshot as object,
        customerPoReference: original.customerPoReference,
        reissueOfInvoiceId: original.id,
        createdByUserId: session.userId,
        lineItems: { create: original.lineItems.map((li) => ({ kind: li.kind, description: li.description, quantity: li.quantity, unitPriceMinorUnits: li.unitPriceMinorUnits, lineTotalMinorUnits: li.lineTotalMinorUnits, sortOrder: li.sortOrder })) },
      },
      include: { lineItems: true },
    });
    return created;
  });

  await recordAudit({
    tenantId: original.tenantId,
    userId: session.userId,
    action: "invoice.reissued",
    entityType: "Invoice",
    entityId: reissued.id,
    beforeValue: { reissueOfInvoiceId: original.id },
    afterValue: { invoiceNumber: reissued.invoiceNumber },
    reason,
  });

  await attachInvoicePdf(reissued.id, { isVatTaxInvoice: original.vatRateBasisPoints != null, billingPeriodLabel: "" }).catch(() => {});

  return getInvoiceWithDetailsUnchecked(reissued.id);
}

export class InvoiceMustBeVoidedBeforeReissueError extends Error {
  constructor() {
    super("An invoice must be voided before it can be reissued.");
    this.name = "InvoiceMustBeVoidedBeforeReissueError";
  }
}

export async function listInvoicesForTenant(session: AuthenticatedSession, tenantId: string) {
  await requirePermission(session, "invoice", "VIEW");
  return prisma.invoice.findMany({ where: tenantWhere(tenantId), orderBy: { issueDate: "desc" }, include: { lineItems: true, payments: true } });
}

export async function getInvoiceForTenant(session: AuthenticatedSession, tenantId: string, invoiceId: string) {
  await requirePermission(session, "invoice", "VIEW");
  const invoice = await prisma.invoice.findFirst({ where: tenantWhere(tenantId, { id: invoiceId }), include: { lineItems: true, payments: true } });
  if (!invoice) throw new InvoiceNotFoundError();

  await recordAudit({ tenantId, userId: session.userId, action: "invoice.viewed", entityType: "Invoice", entityId: invoiceId });

  return invoice;
}

/** Internal, unchecked read — used by callers (invoice generation itself, the recurring job) that already established their own authorisation boundary. */
export async function getInvoiceWithDetailsUnchecked(invoiceId: string) {
  return prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lineItems: true, payments: true } });
}

/**
 * Phase 10 (P10L) — marks every ISSUED invoice whose dueDate has passed as
 * OVERDUE, and correspondingly moves each affected tenant's subscription
 * from ACTIVE to PAST_DUE (a clear warning, never itself a block — see
 * subscription-repository.ts). Idempotent: an invoice already OVERDUE, or
 * a tenant already PAST_DUE/SUSPENDED, is simply left alone on a repeat
 * run — safe to call on every recurring-job tick.
 */
export async function markOverdueInvoices(now: Date = new Date()): Promise<number> {
  const dueInvoices = await prisma.invoice.findMany({ where: { status: "ISSUED", dueDate: { lt: now } } });
  for (const invoice of dueInvoices) {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "OVERDUE" } });
    await recordAudit({ tenantId: invoice.tenantId, userId: null, action: "invoice.markedOverdue", entityType: "Invoice", entityId: invoice.id });
    await markTenantPastDue(invoice.tenantId, null);
  }
  return dueInvoices.length;
}

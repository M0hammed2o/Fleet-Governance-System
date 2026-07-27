import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { requirePermission } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record-audit";
import type { AuthenticatedSession } from "@/lib/auth/session";
import { getPlatformBillingSettingsUnchecked, getCurrentPlatformPricing } from "@/lib/repositories/platform-billing-repository";

/**
 * Phase 10 (P10C) — tenant-scoped commercial/contact/registration details
 * and (P10A/B) append-only tenant-specific negotiated pricing. Deliberately
 * does not store negotiated fee amounts on TenantBillingProfile itself —
 * those live only on TenantPricingAgreement, versioned, so an issued
 * invoice's historical price is never affected by a later negotiation
 * (D-035).
 */

export interface UpsertTenantBillingProfileInput {
  registeredBusinessName?: string | null;
  tradingName?: string | null;
  registrationNumber?: string | null;
  vatNumber?: string | null;
  billingAddressLine1?: string | null;
  billingAddressLine2?: string | null;
  billingCity?: string | null;
  billingPostalCode?: string | null;
  billingCountry?: string;
  billingEmail?: string | null;
  accountsContactName?: string | null;
  accountsContactEmail?: string | null;
  accountsContactPhone?: string | null;
  poRequired?: boolean;
  customerReference?: string | null;
  paymentTermsDays?: number | null;
  gracePeriodDays?: number | null;
  subscriptionStartDate?: Date | null;
  notes?: string | null;
}

export async function getTenantBillingProfile(session: AuthenticatedSession, tenantId: string) {
  await requirePermission(session, "tenantBilling", "VIEW");
  return prisma.tenantBillingProfile.findUnique({ where: { tenantId } });
}

/** Internal, unchecked read for other repositories (invoice generation, dashboards) that already established their own permission boundary. */
export async function getTenantBillingProfileUnchecked(tenantId: string) {
  return prisma.tenantBillingProfile.findUnique({ where: { tenantId } });
}

export async function upsertTenantBillingProfile(session: AuthenticatedSession, tenantId: string, input: UpsertTenantBillingProfileInput) {
  await requirePermission(session, "tenantBilling", "EDIT");

  const before = await prisma.tenantBillingProfile.findUnique({ where: { tenantId } });
  const updated = await prisma.tenantBillingProfile.upsert({
    where: { tenantId },
    update: input,
    create: { tenantId, ...input },
  });

  await recordAudit({
    tenantId,
    userId: session.userId,
    action: "tenantBilling.profileUpdated",
    entityType: "TenantBillingProfile",
    entityId: updated.id,
    beforeValue: before,
    afterValue: updated,
  });

  return updated;
}

export async function listCustomerBillingContacts(session: AuthenticatedSession, tenantId: string) {
  await requirePermission(session, "tenantBilling", "VIEW");
  return prisma.customerBillingContact.findMany({ where: tenantWhere(tenantId), orderBy: { createdAt: "asc" } });
}

/** Internal, unchecked read used by the invoice-email workflow (P10H) — every active contact plus the profile's own accountsContactEmail/billingEmail is the delivery list. */
export async function listActiveCustomerBillingContactEmailsUnchecked(tenantId: string): Promise<string[]> {
  const [profile, contacts] = await Promise.all([
    prisma.tenantBillingProfile.findUnique({ where: { tenantId } }),
    prisma.customerBillingContact.findMany({ where: tenantWhere(tenantId, { isActive: true }) }),
  ]);
  const emails = new Set<string>();
  if (profile?.accountsContactEmail) emails.add(profile.accountsContactEmail);
  if (profile?.billingEmail) emails.add(profile.billingEmail);
  for (const contact of contacts) emails.add(contact.email);
  return Array.from(emails);
}

export async function createCustomerBillingContact(session: AuthenticatedSession, tenantId: string, input: { name?: string; email: string }) {
  await requirePermission(session, "tenantBilling", "EDIT");

  const created = await prisma.customerBillingContact.create({ data: { tenantId, name: input.name, email: input.email } });

  await recordAudit({
    tenantId,
    userId: session.userId,
    action: "tenantBilling.contactCreated",
    entityType: "CustomerBillingContact",
    entityId: created.id,
    afterValue: created,
  });

  return created;
}

export class BillingContactNotFoundError extends Error {
  constructor() {
    super("No billing contact with that id was found in your company.");
    this.name = "BillingContactNotFoundError";
  }
}

export async function setCustomerBillingContactActive(session: AuthenticatedSession, tenantId: string, contactId: string, isActive: boolean) {
  await requirePermission(session, "tenantBilling", "EDIT");

  const existing = await prisma.customerBillingContact.findFirst({ where: tenantWhere(tenantId, { id: contactId }) });
  if (!existing) throw new BillingContactNotFoundError();

  const updated = await prisma.customerBillingContact.update({ where: { id: contactId }, data: { isActive } });

  await recordAudit({
    tenantId,
    userId: session.userId,
    action: isActive ? "tenantBilling.contactReactivated" : "tenantBilling.contactDeactivated",
    entityType: "CustomerBillingContact",
    entityId: contactId,
  });

  return updated;
}

export interface CreateTenantPricingAgreementInput {
  baseFeeMinorUnits: number;
  perVehicleFeeMinorUnits: number;
  currency?: string;
  effectiveFrom?: Date;
  note?: string;
}

export class InvalidPricingAmountError extends Error {
  constructor() {
    super("Base fee and per-vehicle fee must both be zero or a positive integer minor-currency-unit amount.");
    this.name = "InvalidPricingAmountError";
  }
}

/**
 * Append-only — records a new negotiated price for a tenant (P10B/I,
 * "a tenant may have a negotiated base fee or per-vehicle fee"); never
 * edits or deletes an existing row, so an already-issued invoice's
 * snapshot is never retroactively affected (D-035). Platform Administrator
 * only (`pricingAgreement:EDIT`) — a customer-tenant role can view its own
 * current price but never negotiate it directly.
 */
export async function createTenantPricingAgreement(session: AuthenticatedSession, tenantId: string, input: CreateTenantPricingAgreementInput) {
  await requirePermission(session, "pricingAgreement", "EDIT");

  if (!Number.isInteger(input.baseFeeMinorUnits) || input.baseFeeMinorUnits < 0) throw new InvalidPricingAmountError();
  if (!Number.isInteger(input.perVehicleFeeMinorUnits) || input.perVehicleFeeMinorUnits < 0) throw new InvalidPricingAmountError();

  const created = await prisma.tenantPricingAgreement.create({
    data: {
      tenantId,
      baseFeeMinorUnits: input.baseFeeMinorUnits,
      perVehicleFeeMinorUnits: input.perVehicleFeeMinorUnits,
      currency: input.currency ?? "ZAR",
      effectiveFrom: input.effectiveFrom ?? new Date(),
      note: input.note,
      createdByUserId: session.userId,
    },
  });

  await recordAudit({
    tenantId,
    userId: session.userId,
    action: "pricingAgreement.created",
    entityType: "TenantPricingAgreement",
    entityId: created.id,
    afterValue: created,
  });

  return created;
}

export async function listTenantPricingAgreements(session: AuthenticatedSession, tenantId: string) {
  await requirePermission(session, "pricingAgreement", "VIEW");
  return prisma.tenantPricingAgreement.findMany({ where: tenantWhere(tenantId), orderBy: { effectiveFrom: "desc" } });
}

export interface EffectivePricing {
  baseFeeMinorUnits: number;
  perVehicleFeeMinorUnits: number;
  currency: string;
  source: "TENANT_NEGOTIATED" | "PLATFORM_DEFAULT";
}

/**
 * The price this tenant is actually charged at `at` (defaults to now): the
 * tenant's own negotiated TenantPricingAgreement with the latest
 * effectiveFrom <= at, if one exists, otherwise the platform default in
 * effect at the same moment. No permission check — this is the pure pricing
 * resolution used by invoice generation itself, called internally after the
 * caller has already established its own authorisation.
 */
export async function getEffectivePricingForTenant(tenantId: string, at: Date = new Date()): Promise<EffectivePricing> {
  const agreement = await prisma.tenantPricingAgreement.findFirst({
    where: { tenantId, effectiveFrom: { lte: at } },
    orderBy: { effectiveFrom: "desc" },
  });
  if (agreement) {
    return { baseFeeMinorUnits: agreement.baseFeeMinorUnits, perVehicleFeeMinorUnits: agreement.perVehicleFeeMinorUnits, currency: agreement.currency, source: "TENANT_NEGOTIATED" };
  }
  const platformDefault = await getCurrentPlatformPricing(at);
  return { ...platformDefault, source: "PLATFORM_DEFAULT" };
}

/** Re-exported for callers that only need platform settings alongside tenant billing context, avoiding two import paths for closely related reads. */
export { getPlatformBillingSettingsUnchecked };

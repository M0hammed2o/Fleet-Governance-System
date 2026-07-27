import "server-only";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record-audit";
import type { AuthenticatedSession } from "@/lib/auth/session";

/**
 * Phase 10 (P10B) — platform-wide billing configuration: the platform
 * company's own legal/trading identity, VAT configuration, invoice
 * numbering, and default pricing. A single, fixed-id ("platform") row,
 * managed exclusively by Platform Administrator (`platformBilling`
 * permission) — never editable by an ordinary client user, even a Company
 * Administrator, matching the same boundary `platformTenant` already
 * enforces for tenant management (D-005).
 */

const SETTINGS_ID = "platform";

export interface UpdatePlatformBillingSettingsInput {
  legalName?: string;
  tradingName?: string | null;
  registrationNumber?: string | null;
  vatRegistrationNumber?: string | null;
  vatEnabled?: boolean;
  vatRateBasisPoints?: number | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string;
  billingEmail?: string | null;
  telephone?: string | null;
  bankingInstructions?: string | null;
  invoicePrefix?: string;
  currency?: string;
  defaultPaymentTermsDays?: number;
  defaultGracePeriodDays?: number;
  defaultBaseFeeMinorUnits?: number;
  defaultPerVehicleFeeMinorUnits?: number;
}

function isUniqueConstraintViolation(err: unknown, target: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002" && JSON.stringify((err as { meta?: unknown }).meta ?? "").includes(target);
}

/**
 * Auto-creates the singleton row with schema defaults on first access —
 * never a null "not configured yet" state to null-check everywhere else.
 * `upsert()` is not atomic against a genuinely concurrent first caller
 * under Postgres' default isolation (two callers can both fail to see each
 * other's yet-uncommitted INSERT); caught and resolved by re-fetching the
 * row the other caller just created.
 */
export async function getPlatformBillingSettings() {
  try {
    return await prisma.platformBillingSettings.upsert({
      where: { id: SETTINGS_ID },
      update: {},
      create: { id: SETTINGS_ID },
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err, "id")) {
      return prisma.platformBillingSettings.findUniqueOrThrow({ where: { id: SETTINGS_ID } });
    }
    throw err;
  }
}

/** No permission check — every internal caller (invoice generation, dashboards) needs read access regardless of the caller's own role; the platformBilling:VIEW check belongs to the route serving it directly to a user. */
export async function getPlatformBillingSettingsUnchecked() {
  return getPlatformBillingSettings();
}

export async function updatePlatformBillingSettings(session: AuthenticatedSession, input: UpdatePlatformBillingSettingsInput) {
  await requirePermission(session, "platformBilling", "CONFIGURE");

  if (input.vatEnabled && (input.vatRateBasisPoints == null)) {
    const existing = await getPlatformBillingSettings();
    if (existing.vatRateBasisPoints == null) {
      throw new VatConfigurationError("A VAT rate must be set before VAT can be enabled.");
    }
  }

  const before = await getPlatformBillingSettings();
  const updated = await prisma.platformBillingSettings.update({
    where: { id: SETTINGS_ID },
    data: { ...input, updatedByUserId: session.userId },
  });

  await recordAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "platformBilling.settingsUpdated",
    entityType: "PlatformBillingSettings",
    entityId: SETTINGS_ID,
    beforeValue: before,
    afterValue: updated,
  });

  return updated;
}

export class VatConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VatConfigurationError";
  }
}

/**
 * Atomically allocates the next sequential invoice number
 * ("<prefix>-<zero-padded sequence>") — a single Postgres UPDATE
 * (`nextInvoiceSequence = nextInvoiceSequence + 1 RETURNING ...`) so two
 * concurrent invoice-generation calls can never receive the same number
 * (P10E "prevent invoice-number duplication under concurrency", P10N).
 */
export async function allocateNextInvoiceNumber(): Promise<string> {
  const settings = await getPlatformBillingSettings();
  const updated = await prisma.platformBillingSettings.update({
    where: { id: SETTINGS_ID },
    data: { nextInvoiceSequence: { increment: 1 } },
  });
  const sequenceUsed = updated.nextInvoiceSequence - 1;
  return `${settings.invoicePrefix}-${String(sequenceUsed).padStart(6, "0")}`;
}

export async function listPlatformPricingVersions(session: AuthenticatedSession) {
  await requirePermission(session, "platformBilling", "VIEW");
  return prisma.platformPricingVersion.findMany({ orderBy: { effectiveFrom: "desc" } });
}

export interface CreatePlatformPricingVersionInput {
  baseFeeMinorUnits: number;
  perVehicleFeeMinorUnits: number;
  currency?: string;
  effectiveFrom?: Date;
  note?: string;
}

/** Append-only — never edits/deletes an existing row (D-035); a change is always a new version. */
export async function createPlatformPricingVersion(session: AuthenticatedSession, input: CreatePlatformPricingVersionInput) {
  await requirePermission(session, "platformBilling", "CONFIGURE");

  const created = await prisma.platformPricingVersion.create({
    data: {
      baseFeeMinorUnits: input.baseFeeMinorUnits,
      perVehicleFeeMinorUnits: input.perVehicleFeeMinorUnits,
      currency: input.currency ?? "ZAR",
      effectiveFrom: input.effectiveFrom ?? new Date(),
      note: input.note,
      createdByUserId: session.userId,
    },
  });

  await recordAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "platformBilling.pricingVersionCreated",
    entityType: "PlatformPricingVersion",
    entityId: created.id,
    afterValue: created,
  });

  return created;
}

/** The platform default pricing in effect at `at` (defaults to now) — the row with the latest effectiveFrom <= at, falling back to PlatformBillingSettings' own defaults if no version row exists yet. */
export async function getCurrentPlatformPricing(at: Date = new Date()): Promise<{ baseFeeMinorUnits: number; perVehicleFeeMinorUnits: number; currency: string }> {
  const version = await prisma.platformPricingVersion.findFirst({
    where: { effectiveFrom: { lte: at } },
    orderBy: { effectiveFrom: "desc" },
  });
  if (version) return { baseFeeMinorUnits: version.baseFeeMinorUnits, perVehicleFeeMinorUnits: version.perVehicleFeeMinorUnits, currency: version.currency };

  const settings = await getPlatformBillingSettings();
  return { baseFeeMinorUnits: settings.defaultBaseFeeMinorUnits, perVehicleFeeMinorUnits: settings.defaultPerVehicleFeeMinorUnits, currency: settings.currency };
}

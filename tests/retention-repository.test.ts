import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { uploadMediaAsset } from "@/lib/repositories/media-asset-repository";
import { startGateEvent } from "@/lib/repositories/gate-event-repository";
import { createMovement } from "@/lib/repositories/movement-repository";
import {
  getEffectiveRetentionPolicy,
  upsertRetentionPolicy,
  listRetentionPoliciesInTenant,
  DEFAULT_RETENTION_DAYS,
} from "@/lib/repositories/retention-policy-repository";
import {
  setLegalHold,
  setInvestigationHold,
  extendRetention,
  moveAssetsToArchive,
  createDeletionRequest,
  approveDeletionRequest,
  rejectDeletionRequest,
  cancelDeletionRequest,
  completeDeletionRequest,
  getDeletionRequestInTenant,
  createExportRequest,
  getDueRetentionNotifications,
  EmptyDeletionScopeError,
  SelfApprovalNotAllowedError,
  NotRequestInitiatorError,
  DeletionRequestNotPendingError,
  DeletionRequestNotApprovedError,
  RecoveryPeriodNotElapsedError,
} from "@/lib/repositories/retention-repository";
import {
  evaluateDeletionEligibility,
  computeScheduledDeletionAt,
  currentRetentionMilestone,
  daysUntil,
} from "@/lib/retention/deletion-rules";
import { getArchiveTierForBytes, ARCHIVE_PRICING_TIERS, NO_ARCHIVE_TIER } from "@/lib/retention/archive-pricing";
import type { StorageBillingHookProvider } from "@/lib/retention/storage-billing-hook";
import { createTenant, createRole, createUser, createSite, createGate, createDriver, createVehicle, fakeImageBytes } from "./helpers/fixtures";

function unique() {
  return crypto.randomUUID();
}

async function makeActor(tenantId: string) {
  const role = await createRole(tenantId);
  return createUser({ tenantId, roleId: role.id, email: `${unique()}@example.test` });
}

async function uploadAsset(tenantId: string, actorId: string, driverId: string, opts: { category?: "DAMAGE_EVIDENCE" | "OTHER_DOCUMENT"; seed?: number } = {}) {
  return uploadMediaAsset({
    tenantId,
    actorUserId: actorId,
    ownerType: "DRIVER_PORTRAIT",
    ownerId: driverId,
    fileName: "evidence.jpg",
    contentType: "image/jpeg",
    data: await fakeImageBytes(opts.seed ?? Math.floor(Math.random() * 100000)),
    idempotencyKey: unique(),
    category: opts.category ?? "OTHER_DOCUMENT",
  });
}

describe("deletion-rules (pure — lib/retention/deletion-rules.ts)", () => {
  it("blocks deletion for legal hold, investigation hold, and an unresolved linked exception independently", () => {
    expect(evaluateDeletionEligibility({ legalHold: true, investigationHold: false, hasUnresolvedLinkedException: false }).allowed).toBe(false);
    expect(evaluateDeletionEligibility({ legalHold: false, investigationHold: true, hasUnresolvedLinkedException: false }).allowed).toBe(false);
    expect(evaluateDeletionEligibility({ legalHold: false, investigationHold: false, hasUnresolvedLinkedException: true }).allowed).toBe(false);
  });

  it("allows deletion when none of the blocking conditions apply", () => {
    const result = evaluateDeletionEligibility({ legalHold: false, investigationHold: false, hasUnresolvedLinkedException: false });
    expect(result.allowed).toBe(true);
    expect(result.blockingReasons).toHaveLength(0);
  });

  it("computeScheduledDeletionAt adds retentionDays to capturedAt", () => {
    const capturedAt = new Date("2026-01-01T00:00:00Z");
    const result = computeScheduledDeletionAt(capturedAt, 365);
    expect(result.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("currentRetentionMilestone picks the tightest applicable threshold", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(currentRetentionMilestone(new Date(now.getTime() + 100 * 86400000), now)).toBeNull(); // >90 days out
    expect(currentRetentionMilestone(new Date(now.getTime() + 75 * 86400000), now)).toBe(90);
    expect(currentRetentionMilestone(new Date(now.getTime() + 45 * 86400000), now)).toBe(60);
    expect(currentRetentionMilestone(new Date(now.getTime() + 15 * 86400000), now)).toBe(30);
    expect(currentRetentionMilestone(new Date(now.getTime() + 3 * 86400000), now)).toBe(7);
    expect(currentRetentionMilestone(new Date(now.getTime()), now)).toBe(0);
    expect(currentRetentionMilestone(new Date(now.getTime() - 86400000), now)).toBeNull(); // already past expiry
  });

  it("daysUntil is exact", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(daysUntil(new Date("2026-01-08T00:00:00Z"), now)).toBe(7);
  });
});

describe("archive-pricing (pure — lib/retention/archive-pricing.ts)", () => {
  const GB = 1024 ** 3;

  it("matches the documented tier boundaries", () => {
    expect(getArchiveTierForBytes(50 * GB).label).toBe("Up to 100GB");
    expect(getArchiveTierForBytes(100 * GB).label).toBe("Up to 100GB");
    expect(getArchiveTierForBytes(101 * GB).label).toBe("101GB-250GB");
    expect(getArchiveTierForBytes(250 * GB).label).toBe("101GB-250GB");
    expect(getArchiveTierForBytes(499 * GB).label).toBe("251GB-500GB");
    expect(getArchiveTierForBytes(900 * GB).label).toBe("501GB-1TB");
    expect(getArchiveTierForBytes(1025 * GB).label).toBe("More than 1TB");
  });

  it("prices match the specified ZAR-excl-VAT schedule", () => {
    expect(ARCHIVE_PRICING_TIERS[0]).toMatchObject({ monthlyPriceZarExclVat: 149, annualPriceZarExclVat: 1500 });
    expect(ARCHIVE_PRICING_TIERS[1]).toMatchObject({ monthlyPriceZarExclVat: 299, annualPriceZarExclVat: 3000 });
    expect(ARCHIVE_PRICING_TIERS[2]).toMatchObject({ monthlyPriceZarExclVat: 499, annualPriceZarExclVat: 5000 });
    expect(ARCHIVE_PRICING_TIERS[3]).toMatchObject({ monthlyPriceZarExclVat: 899, annualPriceZarExclVat: 9000 });
    expect(ARCHIVE_PRICING_TIERS[4].customQuote).toBe(true);
  });

  // 8E-002: a tenant with nothing archived must never be quoted the lowest
  // paid tier's price — zero archived bytes must always price at R0.
  it("prices at exactly R0 when archivedBytes is 0 — never the lowest paid tier (8E-002)", () => {
    const tier = getArchiveTierForBytes(0);
    expect(tier).toEqual(NO_ARCHIVE_TIER);
    expect(tier.monthlyPriceZarExclVat).toBe(0);
    expect(tier.annualPriceZarExclVat).toBe(0);
    expect(tier.customQuote).toBe(false);
  });

  it("prices the very first archived byte at the lowest real paid tier, not R0", () => {
    const tier = getArchiveTierForBytes(1);
    expect(tier.label).toBe("Up to 100GB");
    expect(tier.monthlyPriceZarExclVat).toBe(149);
  });

  it("boundary: exactly 100GB is still the lowest tier; 100GB + 1 byte rolls into the next tier", () => {
    expect(getArchiveTierForBytes(100 * GB).label).toBe("Up to 100GB");
    expect(getArchiveTierForBytes(100 * GB + 1).label).toBe("101GB-250GB");
  });

  it("boundary: exactly 250GB and exactly 500GB stay in their own tier, not the next one", () => {
    expect(getArchiveTierForBytes(250 * GB).label).toBe("101GB-250GB");
    expect(getArchiveTierForBytes(250 * GB + 1).label).toBe("251GB-500GB");
    expect(getArchiveTierForBytes(500 * GB).label).toBe("251GB-500GB");
    expect(getArchiveTierForBytes(500 * GB + 1).label).toBe("501GB-1TB");
  });

  it("boundary: exactly 1TB prices at the flat 501GB-1TB tier, not a custom quote", () => {
    const oneTb = 1024 * GB;
    const tier = getArchiveTierForBytes(oneTb);
    expect(tier.label).toBe("501GB-1TB");
    expect(tier.customQuote).toBe(false);
    expect(tier.monthlyPriceZarExclVat).toBe(899);
  });

  it("boundary: more than 1TB (1TB + 1 byte) requires a custom quotation", () => {
    const overOneTb = 1024 * GB + 1;
    const tier = getArchiveTierForBytes(overOneTb);
    expect(tier.label).toBe("More than 1TB");
    expect(tier.customQuote).toBe(true);
    expect(tier.monthlyPriceZarExclVat).toBeNull();
  });
});

describe("RetentionPolicy (Phase 8C)", () => {
  it("falls back to the 12-month default when no policy row exists", async () => {
    const tenant = await createTenant();
    const policy = await getEffectiveRetentionPolicy(tenant.id, "OTHER_DOCUMENT");
    expect(policy.retentionDays).toBe(DEFAULT_RETENTION_DAYS);
    expect(policy.isDefault).toBe(true);
  });

  it("upserting a policy overrides the default for that category only", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    await upsertRetentionPolicy({ tenantId: tenant.id, actorUserId: actor.id, category: "DAMAGE_EVIDENCE", retentionDays: 2555 });

    const damage = await getEffectiveRetentionPolicy(tenant.id, "DAMAGE_EVIDENCE");
    expect(damage.retentionDays).toBe(2555);
    expect(damage.isDefault).toBe(false);

    const other = await getEffectiveRetentionPolicy(tenant.id, "OTHER_DOCUMENT");
    expect(other.retentionDays).toBe(DEFAULT_RETENTION_DAYS);
  });

  it("does not leak another tenant's retention policies", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const actorA = await makeActor(tenantA.id);
    await upsertRetentionPolicy({ tenantId: tenantA.id, actorUserId: actorA.id, category: "DAMAGE_EVIDENCE", retentionDays: 999 });

    expect(await listRetentionPoliciesInTenant(tenantB.id)).toHaveLength(0);
  });
});

describe("holds and retention extension (Phase 8C)", () => {
  it("legal hold blocks a deletion request from including the asset", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const asset = await uploadAsset(tenant.id, actor.id, driver.id, { seed: 1 });

    await setLegalHold(tenant.id, actor.id, asset.id, true, "Pending litigation");

    await expect(createDeletionRequest({ tenantId: tenant.id, actorUserId: actor.id, scope: { categories: ["OTHER_DOCUMENT"] } })).rejects.toBeInstanceOf(
      EmptyDeletionScopeError,
    );
  });

  it("investigation hold blocks a deletion request from including the asset", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const asset = await uploadAsset(tenant.id, actor.id, driver.id, { seed: 2 });

    await setInvestigationHold(tenant.id, actor.id, asset.id, true, "Internal investigation open");

    await expect(createDeletionRequest({ tenantId: tenant.id, actorUserId: actor.id, scope: { categories: ["OTHER_DOCUMENT"] } })).rejects.toBeInstanceOf(
      EmptyDeletionScopeError,
    );
  });

  it("releasing a hold makes the asset eligible again", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const asset = await uploadAsset(tenant.id, actor.id, driver.id, { seed: 3 });

    await setLegalHold(tenant.id, actor.id, asset.id, true, "hold");
    await setLegalHold(tenant.id, actor.id, asset.id, false, "hold released");

    const { deletionRequest } = await createDeletionRequest({ tenantId: tenant.id, actorUserId: actor.id, scope: { categories: ["OTHER_DOCUMENT"] } });
    expect(deletionRequest.assetCount).toBe(1);
  });

  it("an unresolved exception linked to the evidence's gate event blocks deletion", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const site = await createSite(tenant.id);
    const gate = await createGate(tenant.id, site.id);
    const driver = await createDriver(tenant.id);
    const vehicle = await createVehicle(tenant.id);
    const movement = await createMovement({ tenantId: tenant.id, siteId: site.id, vehicleId: vehicle.id, driverId: driver.id, movementType: "DELIVERY", requesterUserId: actor.id });
    await prisma.movementAuthorisation.update({ where: { id: movement.id }, data: { status: "APPROVED" } });
    const gateEvent = await startGateEvent({ tenantId: tenant.id, movementAuthorisationId: movement.id, gateId: gate.id, direction: "ENTRY", securityOfficerUserId: actor.id });

    const asset = await uploadMediaAsset({
      tenantId: tenant.id,
      actorUserId: actor.id,
      ownerType: "GATE_EVENT_INSPECTION_ITEM",
      ownerId: gateEvent!.id,
      fileName: "evidence.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(4),
      idempotencyKey: unique(),
      category: "OTHER_DOCUMENT",
    });

    await prisma.exception.create({ data: { tenantId: tenant.id, gateEventId: gateEvent!.id, description: "test exception", severity: "MEDIUM", raisedByUserId: actor.id } });

    await expect(createDeletionRequest({ tenantId: tenant.id, actorUserId: actor.id, scope: { categories: ["OTHER_DOCUMENT"] } })).rejects.toBeInstanceOf(
      EmptyDeletionScopeError,
    );
    // Sanity: the asset really was uploaded (not some other reason for the empty scope).
    expect(await prisma.mediaAsset.findUnique({ where: { id: asset.id } })).not.toBeNull();
  });

  it("extendRetention pushes scheduledDeletionAt out and is audit-logged", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const asset = await uploadAsset(tenant.id, actor.id, driver.id, { seed: 5 });
    const newDate = new Date(Date.now() + 999 * 24 * 60 * 60 * 1000);

    const updated = await extendRetention(tenant.id, actor.id, asset.id, newDate, "Litigation likely");
    expect(updated.scheduledDeletionAt?.getTime()).toBe(newDate.getTime());

    const audit = await prisma.auditLog.findFirst({ where: { tenantId: tenant.id, action: "retention.extended", entityId: asset.id } });
    expect(audit).not.toBeNull();
  });
});

describe("archive workflow (Phase 8C)", () => {
  it("moves eligible assets to ARCHIVED status and reports usage through the billing hook", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const asset = await uploadAsset(tenant.id, actor.id, driver.id, { seed: 6 });

    const reported: unknown[] = [];
    const spyHook: StorageBillingHookProvider = { reportUsage: async (report) => { reported.push(report); } };

    const result = await moveAssetsToArchive(tenant.id, actor.id, [asset.id], spyHook);
    expect(result.archivedCount).toBe(1);
    expect(reported).toHaveLength(1);

    const reloaded = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.retentionStatus).toBe("ARCHIVED");
  });

  it("skips a category whose retention policy marks it not archive-eligible", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    await upsertRetentionPolicy({ tenantId: tenant.id, actorUserId: actor.id, category: "OTHER_DOCUMENT", archiveEligible: false });
    const asset = await uploadAsset(tenant.id, actor.id, driver.id, { seed: 7 });

    const result = await moveAssetsToArchive(tenant.id, actor.id, [asset.id]);
    expect(result.archivedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });
});

describe("deletion request workflow — dual-control and 30-day recovery (Phase 8C)", () => {
  it("the initiator cannot approve their own deletion request", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    await uploadAsset(tenant.id, actor.id, driver.id, { seed: 10 });

    const { deletionRequest } = await createDeletionRequest({ tenantId: tenant.id, actorUserId: actor.id, scope: { categories: ["OTHER_DOCUMENT"] } });
    await expect(approveDeletionRequest(tenant.id, actor.id, deletionRequest.id)).rejects.toBeInstanceOf(SelfApprovalNotAllowedError);
  });

  it("the initiator cannot reject their own deletion request either", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    await uploadAsset(tenant.id, actor.id, driver.id, { seed: 11 });

    const { deletionRequest } = await createDeletionRequest({ tenantId: tenant.id, actorUserId: actor.id, scope: { categories: ["OTHER_DOCUMENT"] } });
    await expect(rejectDeletionRequest(tenant.id, actor.id, deletionRequest.id, "changed my mind")).rejects.toBeInstanceOf(SelfApprovalNotAllowedError);
  });

  it("a different user approves successfully, setting a recoveryExpiresAt and moving assets to PENDING_DELETION", async () => {
    const tenant = await createTenant();
    const initiator = await makeActor(tenant.id);
    const approver = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const asset = await uploadAsset(tenant.id, initiator.id, driver.id, { seed: 12 });

    const { deletionRequest } = await createDeletionRequest({ tenantId: tenant.id, actorUserId: initiator.id, scope: { categories: ["OTHER_DOCUMENT"] } });
    const approved = await approveDeletionRequest(tenant.id, approver.id, deletionRequest.id);

    expect(approved.status).toBe("APPROVED");
    expect(approved.recoveryExpiresAt).not.toBeNull();

    const reloadedAsset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloadedAsset.retentionStatus).toBe("PENDING_DELETION");
  });

  it("rejects approving/rejecting a request that isn't PENDING_APPROVAL", async () => {
    const tenant = await createTenant();
    const initiator = await makeActor(tenant.id);
    const approver = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    await uploadAsset(tenant.id, initiator.id, driver.id, { seed: 13 });

    const { deletionRequest } = await createDeletionRequest({ tenantId: tenant.id, actorUserId: initiator.id, scope: { categories: ["OTHER_DOCUMENT"] } });
    await approveDeletionRequest(tenant.id, approver.id, deletionRequest.id);

    await expect(approveDeletionRequest(tenant.id, approver.id, deletionRequest.id)).rejects.toBeInstanceOf(DeletionRequestNotPendingError);
  });

  it("only the initiator can cancel their own pending request", async () => {
    const tenant = await createTenant();
    const initiator = await makeActor(tenant.id);
    const other = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    await uploadAsset(tenant.id, initiator.id, driver.id, { seed: 14 });

    const { deletionRequest } = await createDeletionRequest({ tenantId: tenant.id, actorUserId: initiator.id, scope: { categories: ["OTHER_DOCUMENT"] } });
    await expect(cancelDeletionRequest(tenant.id, other.id, deletionRequest.id)).rejects.toBeInstanceOf(NotRequestInitiatorError);

    const cancelled = await cancelDeletionRequest(tenant.id, initiator.id, deletionRequest.id);
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("completing before the recovery period elapses is rejected", async () => {
    const tenant = await createTenant();
    const initiator = await makeActor(tenant.id);
    const approver = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    await uploadAsset(tenant.id, initiator.id, driver.id, { seed: 15 });

    const { deletionRequest } = await createDeletionRequest({ tenantId: tenant.id, actorUserId: initiator.id, scope: { categories: ["OTHER_DOCUMENT"] } });
    await approveDeletionRequest(tenant.id, approver.id, deletionRequest.id);

    await expect(completeDeletionRequest(tenant.id, deletionRequest.id)).rejects.toBeInstanceOf(RecoveryPeriodNotElapsedError);
  });

  it("completing an un-approved request is rejected", async () => {
    const tenant = await createTenant();
    const initiator = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    await uploadAsset(tenant.id, initiator.id, driver.id, { seed: 16 });

    const { deletionRequest } = await createDeletionRequest({ tenantId: tenant.id, actorUserId: initiator.id, scope: { categories: ["OTHER_DOCUMENT"] } });
    await expect(completeDeletionRequest(tenant.id, deletionRequest.id)).rejects.toBeInstanceOf(DeletionRequestNotApprovedError);
  });

  it("permanently deletes eligible assets once the recovery period has elapsed, issuing a certificate with a checksum manifest", async () => {
    const tenant = await createTenant();
    const initiator = await makeActor(tenant.id);
    const approver = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const asset = await uploadAsset(tenant.id, initiator.id, driver.id, { seed: 17 });
    const originalChecksum = asset.checksumSha256;

    const { deletionRequest } = await createDeletionRequest({ tenantId: tenant.id, actorUserId: initiator.id, scope: { categories: ["OTHER_DOCUMENT"] }, recoveryDays: 30 });
    await approveDeletionRequest(tenant.id, approver.id, deletionRequest.id);

    // Simulate the recovery period having elapsed.
    await prisma.deletionRequest.update({ where: { id: deletionRequest.id }, data: { recoveryExpiresAt: new Date(Date.now() - 1000) } });

    const certificate = await completeDeletionRequest(tenant.id, deletionRequest.id);
    expect(certificate.assetCount).toBe(1);
    expect(certificate.checksumManifest).toEqual([{ mediaAssetId: asset.id, fileName: asset.fileName, checksumSha256: originalChecksum }]);
    expect(certificate.initiatedByUserId).toBe(initiator.id);
    expect(certificate.approvedByUserId).toBe(approver.id);

    const reloadedAsset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloadedAsset.retentionStatus).toBe("DELETED");
    expect(reloadedAsset.binaryDeletedAt).not.toBeNull();

    const reloadedRequest = await getDeletionRequestInTenant(tenant.id, deletionRequest.id);
    expect(reloadedRequest?.status).toBe("COMPLETED");
    expect(reloadedRequest?.certificate?.id).toBe(certificate.id);
  });

  it("skips (does not delete) an asset that gained a hold during the recovery window", async () => {
    const tenant = await createTenant();
    const initiator = await makeActor(tenant.id);
    const approver = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const asset = await uploadAsset(tenant.id, initiator.id, driver.id, { seed: 18 });

    const { deletionRequest } = await createDeletionRequest({ tenantId: tenant.id, actorUserId: initiator.id, scope: { categories: ["OTHER_DOCUMENT"] } });
    await approveDeletionRequest(tenant.id, approver.id, deletionRequest.id);

    // A hold is applied after approval but before the recovery period elapses.
    await setLegalHold(tenant.id, approver.id, asset.id, true, "Litigation surfaced during recovery window");
    await prisma.deletionRequest.update({ where: { id: deletionRequest.id }, data: { recoveryExpiresAt: new Date(Date.now() - 1000) } });

    const certificate = await completeDeletionRequest(tenant.id, deletionRequest.id);
    expect(certificate.assetCount).toBe(0);

    const reloadedAsset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloadedAsset.binaryDeletedAt).toBeNull();
    expect(reloadedAsset.retentionStatus).toBe("PENDING_DELETION");
  });

  it("never touches another tenant's assets", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const actorA = await makeActor(tenantA.id);
    const actorBApprover = await makeActor(tenantA.id);
    const driverA = await createDriver(tenantA.id);
    const driverB = await createDriver(tenantB.id);
    await uploadAsset(tenantA.id, actorA.id, driverA.id, { seed: 19 });
    const assetB = await uploadAsset(tenantB.id, actorA.id, driverB.id, { seed: 20 });

    const { deletionRequest } = await createDeletionRequest({ tenantId: tenantA.id, actorUserId: actorA.id, scope: { categories: ["OTHER_DOCUMENT"] } });
    await approveDeletionRequest(tenantA.id, actorBApprover.id, deletionRequest.id);
    await prisma.deletionRequest.update({ where: { id: deletionRequest.id }, data: { recoveryExpiresAt: new Date(Date.now() - 1000) } });
    await completeDeletionRequest(tenantA.id, deletionRequest.id);

    const reloadedB = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetB.id } });
    expect(reloadedB.binaryDeletedAt).toBeNull();
    expect(reloadedB.retentionStatus).toBe("ACTIVE");
  });
});

describe("export request workflow (Phase 8C)", () => {
  it("generates a manifest with a signed URL per matching asset", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    await uploadAsset(tenant.id, actor.id, driver.id, { seed: 21 });
    await uploadAsset(tenant.id, actor.id, driver.id, { seed: 22 });

    const request = await createExportRequest({ tenantId: tenant.id, actorUserId: actor.id, scope: { categories: ["OTHER_DOCUMENT"] } });
    expect(request.status).toBe("READY");
    expect(request.assetCount).toBe(2);
    const manifest = request.manifest as { assets: Array<{ signedUrl: string; checksumSha256: string }> };
    expect(manifest.assets).toHaveLength(2);
    for (const entry of manifest.assets) {
      expect(entry.signedUrl).toContain("/api/media/raw");
      expect(entry.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("does not include another tenant's evidence", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const actorA = await makeActor(tenantA.id);
    const driverA = await createDriver(tenantA.id);
    const driverB = await createDriver(tenantB.id);
    await uploadAsset(tenantA.id, actorA.id, driverA.id, { seed: 23 });
    const actorB = await makeActor(tenantB.id);
    await uploadAsset(tenantB.id, actorB.id, driverB.id, { seed: 24 });

    const request = await createExportRequest({ tenantId: tenantA.id, actorUserId: actorA.id, scope: { categories: ["OTHER_DOCUMENT"] } });
    expect(request.assetCount).toBe(1);
  });
});

describe("retention-expiry notifications (Phase 8C — computed, not delivered)", () => {
  it("finds an asset due for a milestone notification and excludes ones outside the 90-day window", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const dueSoon = await uploadAsset(tenant.id, actor.id, driver.id, { seed: 25 });
    const farOut = await uploadAsset(tenant.id, actor.id, driver.id, { seed: 26 });

    await prisma.mediaAsset.update({ where: { id: dueSoon.id }, data: { scheduledDeletionAt: new Date(Date.now() + 5 * 86400000) } });
    await prisma.mediaAsset.update({ where: { id: farOut.id }, data: { scheduledDeletionAt: new Date(Date.now() + 200 * 86400000) } });

    const due = await getDueRetentionNotifications(tenant.id);
    expect(due.some((d) => d.mediaAssetId === dueSoon.id && d.milestone === 7)).toBe(true);
    expect(due.some((d) => d.mediaAssetId === farOut.id)).toBe(false);
  });

  it("excludes an archived asset even if its scheduledDeletionAt would otherwise be due", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const asset = await uploadAsset(tenant.id, actor.id, driver.id, { seed: 27 });
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { scheduledDeletionAt: new Date(Date.now() + 5 * 86400000), retentionStatus: "ARCHIVED" } });

    const due = await getDueRetentionNotifications(tenant.id);
    expect(due.some((d) => d.mediaAssetId === asset.id)).toBe(false);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createTrackerMapping, endTrackerMapping, listTrackerMappingHistory, SyntheticMappingProductionError, TrackerMappingConflictError } from "@/lib/repositories/tracker-mapping-repository";
import { ForbiddenError } from "@/lib/auth/authorize";
import type { AuthenticatedSession } from "@/lib/auth/session";
import { createRole, createTenant, createUser, createVehicle, grantPermission } from "./helpers/fixtures";

const originalAppEnvironment = process.env.APP_ENV;
const originalNodeEnvironment = process.env.NODE_ENV;
afterEach(() => {
  if (originalAppEnvironment === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = originalAppEnvironment;
  if (originalNodeEnvironment === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Reflect.set(process.env, "NODE_ENV", originalNodeEnvironment);
});

async function setup(configure = true) {
  const tenant = await createTenant();
  const role = await createRole(tenant.id, configure ? "Tracker configurator" : "Tracker viewer");
  await grantPermission(role.id, "telematics", "VIEW");
  if (configure) await grantPermission(role.id, "telematics", "CONFIGURE");
  const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const vehicle = await createVehicle(tenant.id);
  const session: AuthenticatedSession = { sessionId: "mapping-test", tenantId: tenant.id, userId: user.id, roleId: role.id, roleName: role.name, userStatus: "ACTIVE", tenantStatus: "ACTIVE" };
  return { tenant, user, vehicle, session };
}

function input(session: AuthenticatedSession, vehicleId: string, providerAssetId = "SYNTHETIC-ASSET-001") {
  return { session, vehicleId, providerId: "synthetic", providerAssetId, source: "SYNTHETIC" as const, effectiveFrom: new Date("2030-01-01T00:00:00Z"), reason: "Authorised synthetic mapping for Phase 15 verification." };
}

describe("effective-dated tracker mapping and provenance controls", () => {
  it("requires telematics CONFIGURE and records audit-safe mapping history", async () => {
    const viewer = await setup(false);
    await expect(createTrackerMapping(input(viewer.session, viewer.vehicle.id))).rejects.toBeInstanceOf(ForbiddenError);
    const owner = await setup();
    const mapping = await createTrackerMapping(input(owner.session, owner.vehicle.id));
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId: owner.tenant.id, entityId: mapping.id, action: "trackerMapping.created" } });
    expect(JSON.stringify(audit.afterValue)).toContain("providerAssetFingerprint");
    expect(JSON.stringify(audit.afterValue)).not.toContain("SYNTHETIC-ASSET-001");
  });

  it("prevents duplicate active vehicle and tracker-asset assignments", async () => {
    const { session, tenant, vehicle } = await setup();
    await createTrackerMapping(input(session, vehicle.id));
    await expect(createTrackerMapping(input(session, vehicle.id, "SYNTHETIC-ASSET-002"))).rejects.toBeInstanceOf(TrackerMappingConflictError);
    const otherVehicle = await createVehicle(tenant.id);
    await expect(createTrackerMapping(input(session, otherVehicle.id))).rejects.toBeInstanceOf(TrackerMappingConflictError);
  });

  it("rejects cross-tenant vehicle and actor identifier manipulation", async () => {
    const owner = await setup();
    const foreign = await setup();
    await expect(createTrackerMapping(input(owner.session, foreign.vehicle.id))).rejects.toThrow(/not found/i);
    await expect(createTrackerMapping(input({ ...owner.session, userId: foreign.user.id }, owner.vehicle.id))).rejects.toThrow(/not found/i);
  });

  it("ends and corrects mappings without destroying history or event context", async () => {
    const { session, tenant, vehicle } = await setup();
    const first = await createTrackerMapping(input(session, vehicle.id));
    const providerReference = `synthetic-history-${crypto.randomUUID()}`;
    const historicEvent = await prisma.telematicsEvent.create({ data: { tenantId: tenant.id, vehicleId: vehicle.id, source: "SYNTHETIC", recordedAt: new Date("2030-01-02T00:00:00Z"), providerReference, trackerMappingId: first.id, providerId: "synthetic", providerEventId: providerReference, collectionMethod: "SIMULATOR", freshness: "FRESH", mappingState: "MAPPED", processingStatus: "ACCEPTED", correctionStatus: "ORIGINAL", confidenceLimitations: "Synthetic test data.", isSynthetic: true } });
    await endTrackerMapping({ session, vehicleId: vehicle.id, mappingId: first.id, effectiveTo: new Date("2030-01-03T00:00:00Z"), reason: "Incorrect synthetic assignment corrected after review." });
    const corrected = await createTrackerMapping({ ...input(session, vehicle.id, "SYNTHETIC-ASSET-002"), effectiveFrom: new Date("2030-01-03T00:00:00Z"), correctionOfId: first.id });
    const history = await listTrackerMappingHistory(session, vehicle.id);
    expect(history).toHaveLength(2);
    expect(history.every((entry) => !("providerAssetId" in entry))).toBe(true);
    expect(corrected.correctionOfId).toBe(first.id);
    expect((await prisma.telematicsEvent.findUniqueOrThrow({ where: { id: historicEvent.id } })).trackerMappingId).toBe(first.id);
  });

  it("rejects correction lineage that points at another vehicle", async () => {
    const { session, tenant, vehicle } = await setup();
    const first = await createTrackerMapping(input(session, vehicle.id));
    await endTrackerMapping({ session, vehicleId: vehicle.id, mappingId: first.id, effectiveTo: new Date("2030-01-03T00:00:00Z"), reason: "End the first synthetic mapping after review." });
    const otherVehicle = await createVehicle(tenant.id);
    await expect(createTrackerMapping({ ...input(session, otherVehicle.id, "SYNTHETIC-ASSET-009"), effectiveFrom: new Date("2030-01-03T00:00:00Z"), correctionOfId: first.id })).rejects.toThrow(/same vehicle history/i);
  });

  it("refuses synthetic mapping activation in production", async () => {
    const { session, vehicle } = await setup();
    process.env.APP_ENV = "production";
    await expect(createTrackerMapping(input(session, vehicle.id))).rejects.toBeInstanceOf(SyntheticMappingProductionError);
    process.env.APP_ENV = "test";
    Reflect.set(process.env, "NODE_ENV", "production");
    await expect(createTrackerMapping(input(session, vehicle.id))).rejects.toBeInstanceOf(SyntheticMappingProductionError);
  });
});

import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { ForbiddenError } from "@/lib/auth/authorize";
import { getInvestigationCaseInTenant, InvestigationEntityNotFoundError } from "@/lib/repositories/investigation-case-repository";
import { referExceptionToInvestigation, SourceRecordNotFoundError } from "@/lib/repositories/investigation-referral-repository";
import { createTenant, createVehicle } from "./helpers/fixtures";
import { makeManagerSessionForTenant, makeReferrerSessionForTenant } from "./helpers/investigation-fixtures";

async function createGpsException(tenantId: string, raisedByUserId: string) {
  const vehicle = await createVehicle(tenantId);
  return prisma.exception.create({
    data: {
      tenantId,
      vehicleId: vehicle.id,
      raisedByUserId,
      description: "Vehicle crossed the configured geofence boundary.",
      severity: "HIGH",
      violationType: "GEOFENCE_BREACH",
    },
  });
}

describe("investigation referrals", () => {
  it("creates an immutable GPS-exception referral snapshot without mutating the source record", async () => {
    const tenant = await createTenant("Referral");
    const { session: referrer } = await makeReferrerSessionForTenant(tenant);
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const source = await createGpsException(tenant.id, referrer.userId);

    const result = await referExceptionToInvestigation(referrer, source.id, {
      title: "Geofence concern",
      priority: "HIGH",
      caseOwnerUserId: manager.userId,
    });

    expect(result.wasExistingCase).toBe(false);
    expect(result.investigationCase.source).toBe("GPS_GEOFENCE_EXCEPTION");
    expect(result.investigationCase.outcome).toBe("NOT_DETERMINED");
    const link = await prisma.investigationRelatedRecord.findFirstOrThrow({ where: { caseId: result.investigationCase.id, isReferralSource: true } });
    expect(link.recordId).toBe(source.id);
    expect(link.snapshotSummary).toMatchObject({ description: source.description, severity: "HIGH", violationType: "GEOFENCE_BREACH" });

    const unchanged = await prisma.exception.findUniqueOrThrow({ where: { id: source.id } });
    expect(unchanged.resolvedAt).toBeNull();
    expect(unchanged.resolvedByUserId).toBeNull();
  });

  it("is idempotent for a second referral to the same still-open source record", async () => {
    const tenant = await createTenant("Referral idempotency");
    const { session: referrer } = await makeReferrerSessionForTenant(tenant);
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const source = await createGpsException(tenant.id, referrer.userId);
    const fields = { title: "Duplicate-safe referral", caseOwnerUserId: manager.userId };

    const first = await referExceptionToInvestigation(referrer, source.id, fields);
    const second = await referExceptionToInvestigation(referrer, source.id, fields);

    expect(second.wasExistingCase).toBe(true);
    expect(second.investigationCase.id).toBe(first.investigationCase.id);
    expect(await prisma.investigationRelatedRecord.count({ where: { tenantId: tenant.id, recordId: source.id, isReferralSource: true } })).toBe(1);
  });

  it("creates exactly one active case when identical referrals race", async () => {
    const tenant = await createTenant("Concurrent referral idempotency");
    const { session: referrer } = await makeReferrerSessionForTenant(tenant);
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const source = await createGpsException(tenant.id, referrer.userId);
    const fields = { title: "Concurrent duplicate-safe referral", caseOwnerUserId: manager.userId };

    const results = await Promise.all(
      Array.from({ length: 8 }, () => referExceptionToInvestigation(referrer, source.id, fields)),
    );

    expect(new Set(results.map((result) => result.investigationCase.id))).toHaveLength(1);
    expect(results.filter((result) => !result.wasExistingCase)).toHaveLength(1);
    expect(await prisma.investigationRelatedRecord.count({
      where: { tenantId: tenant.id, recordId: source.id, isReferralSource: true },
    })).toBe(1);
  });

  it("rejects a source record and case owner from another tenant with non-disclosing errors", async () => {
    const tenantA = await createTenant("Referral tenant A");
    const tenantB = await createTenant("Referral tenant B");
    const { session: referrerA } = await makeReferrerSessionForTenant(tenantA);
    const { session: managerA } = await makeManagerSessionForTenant(tenantA);
    const { session: managerB } = await makeManagerSessionForTenant(tenantB);
    const sourceA = await createGpsException(tenantA.id, referrerA.userId);
    const sourceB = await createGpsException(tenantB.id, managerB.userId);

    await expect(
      referExceptionToInvestigation(referrerA, sourceB.id, { title: "Cross tenant", caseOwnerUserId: managerA.userId }),
    ).rejects.toBeInstanceOf(SourceRecordNotFoundError);
    await expect(
      referExceptionToInvestigation(referrerA, sourceA.id, { title: "Cross tenant owner", caseOwnerUserId: managerB.userId }),
    ).rejects.toBeInstanceOf(InvestigationEntityNotFoundError);
  });

  it("keeps referral-only users out of the investigation workspace", async () => {
    const tenant = await createTenant("Referral permissions");
    const { session: referrer } = await makeReferrerSessionForTenant(tenant);
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const source = await createGpsException(tenant.id, referrer.userId);
    const { investigationCase } = await referExceptionToInvestigation(referrer, source.id, {
      title: "Referral-only boundary",
      caseOwnerUserId: manager.userId,
    });

    await expect(getInvestigationCaseInTenant(referrer, investigationCase.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

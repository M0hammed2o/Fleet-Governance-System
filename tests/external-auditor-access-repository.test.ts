import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { ForbiddenError } from "@/lib/auth/authorize";
import { getDefaultAuditorInvitationProvider } from "@/lib/investigations/auditor-invitation-provider";
import { getDefaultInvestigationNotificationProvider } from "@/lib/investigations/investigation-notification-provider";
import {
  AuditorAccessDeniedError,
  AuditorUserNotEligibleError,
  DownloadNotPermittedByGrantError,
  GrantCaseNotInTenantError,
  GrantExpiryInvalidError,
  getCaseForAuditor,
  getEvidenceForAuditor,
  grantExternalAuditorAccess,
  listEvidenceManifestForAuditor,
  listPermittedCasesForAuditor,
  revokeExternalAuditorAccess,
} from "@/lib/repositories/external-auditor-access-repository";
import { createInvestigationCase } from "@/lib/repositories/investigation-case-repository";
import { linkEvidenceFromMediaAsset } from "@/lib/repositories/investigation-evidence-repository";
import { uploadMediaAsset } from "@/lib/repositories/media-asset-repository";
import { createDriver, createTenant, fakeImageBytes } from "./helpers/fixtures";
import { makeExternalAuditorSessionForTenant, makeManagerSessionForTenant } from "./helpers/investigation-fixtures";

async function linkEvidence(
  manager: Awaited<ReturnType<typeof makeManagerSessionForTenant>>["session"],
  caseId: string,
  confidentiality: "STANDARD" | "RESTRICTED",
) {
  const driver = await createDriver(manager.tenantId);
  const asset = await uploadMediaAsset({
    tenantId: manager.tenantId,
    actorUserId: manager.userId,
    ownerType: "DRIVER_PORTRAIT",
    ownerId: driver.id,
    fileName: `${confidentiality.toLowerCase()}.jpg`,
    contentType: "image/jpeg",
    data: await fakeImageBytes(confidentiality === "STANDARD" ? 31 : 32),
    idempotencyKey: crypto.randomUUID(),
    category: "INVESTIGATION_EVIDENCE",
  });
  return linkEvidenceFromMediaAsset(manager, caseId, { mediaAssetId: asset.id, description: `${confidentiality} evidence`, confidentiality });
}

describe("external-auditor access", () => {
  it("is tenant-, user-, case- and time-scoped, read-only, and audit logs every case view", async () => {
    const tenant = await createTenant("External access");
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const auditor = await makeExternalAuditorSessionForTenant(tenant);
    const grantedCase = await createInvestigationCase(manager, { title: "Granted", description: "Permitted narrative", source: "MANUAL_CONCERN" });
    const unrelatedCase = await createInvestigationCase(manager, { title: "Unrelated", description: "Must stay hidden", source: "MANUAL_CONCERN" });

    const grant = await grantExternalAuditorAccess(manager, {
      externalAuditorUserId: auditor.user.id,
      caseIds: [grantedCase.id],
      reason: "Independent assurance review",
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect((await listPermittedCasesForAuditor(auditor.session)).map((record) => record.id)).toEqual([grantedCase.id]);
    expect((await getCaseForAuditor(auditor.session, grantedCase.id)).description).toBe("Permitted narrative");
    await expect(getCaseForAuditor(auditor.session, unrelatedCase.id)).rejects.toBeInstanceOf(AuditorAccessDeniedError);
    await expect(createInvestigationCase(auditor.session, { title: "edit", description: "blocked", source: "MANUAL_CONCERN" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.externalAuditorAccessLog.count({ where: { grantId: grant.id, caseId: grantedCase.id, action: "VIEW_CASE" } })).toBe(1);
  });

  it("takes revocation effect on the next access check and rejects expired grants", async () => {
    const tenant = await createTenant("Revocation");
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const auditor = await makeExternalAuditorSessionForTenant(tenant);
    const investigationCase = await createInvestigationCase(manager, { title: "Revocable", description: "Narrative", source: "MANUAL_CONCERN" });
    const grant = await grantExternalAuditorAccess(manager, {
      externalAuditorUserId: auditor.user.id,
      caseIds: [investigationCase.id],
      reason: "Temporary review",
      expiresAt: new Date(Date.now() + 60_000),
    });

    await getCaseForAuditor(auditor.session, investigationCase.id);
    await revokeExternalAuditorAccess(manager, grant.id, "Review withdrawn");
    await expect(getCaseForAuditor(auditor.session, investigationCase.id)).rejects.toBeInstanceOf(AuditorAccessDeniedError);

    const secondGrant = await grantExternalAuditorAccess(manager, {
      externalAuditorUserId: auditor.user.id,
      caseIds: [investigationCase.id],
      reason: "Short review",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await prisma.externalAuditorAccessGrant.update({ where: { id: secondGrant.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    await expect(getCaseForAuditor(auditor.session, investigationCase.id)).rejects.toBeInstanceOf(AuditorAccessDeniedError);
  });

  it("never exposes restricted evidence metadata or bytes without an express confidentiality grant", async () => {
    const tenant = await createTenant("External confidentiality");
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const auditor = await makeExternalAuditorSessionForTenant(tenant);
    const investigationCase = await createInvestigationCase(manager, {
      title: "Restricted case",
      description: "Highly sensitive allegation detail",
      source: "MANUAL_CONCERN",
      confidentiality: "HIGHLY_RESTRICTED",
    });
    const standard = await linkEvidence(manager, investigationCase.id, "STANDARD");
    const restricted = await linkEvidence(manager, investigationCase.id, "RESTRICTED");
    await grantExternalAuditorAccess(manager, {
      externalAuditorUserId: auditor.user.id,
      caseIds: [investigationCase.id],
      reason: "Scoped evidence review",
      expiresAt: new Date(Date.now() + 60_000),
      canDownloadEvidence: true,
    });

    expect((await getCaseForAuditor(auditor.session, investigationCase.id)).description).toBe("[Confidential — access restricted]");
    expect((await listEvidenceManifestForAuditor(auditor.session, investigationCase.id)).map((item) => item.id)).toEqual([standard.id]);
    await expect(getEvidenceForAuditor(auditor.session, investigationCase.id, restricted.id)).rejects.toBeInstanceOf(AuditorAccessDeniedError);
    await expect(getEvidenceForAuditor(auditor.session, investigationCase.id, standard.id)).resolves.toHaveProperty("url");
  });

  it("requires explicit download flags and rejects foreign cases, ineligible users and past expiry at grant creation", async () => {
    const tenantA = await createTenant("Grant A");
    const tenantB = await createTenant("Grant B");
    const { session: managerA, user: managerUserA } = await makeManagerSessionForTenant(tenantA);
    const { session: managerB } = await makeManagerSessionForTenant(tenantB);
    const auditor = await makeExternalAuditorSessionForTenant(tenantA);
    const caseA = await createInvestigationCase(managerA, { title: "A", description: "A", source: "MANUAL_CONCERN" });
    const caseB = await createInvestigationCase(managerB, { title: "B", description: "B", source: "MANUAL_CONCERN" });
    const evidence = await linkEvidence(managerA, caseA.id, "STANDARD");

    await expect(
      grantExternalAuditorAccess(managerA, { externalAuditorUserId: auditor.user.id, caseIds: [caseB.id], reason: "foreign", expiresAt: new Date(Date.now() + 60_000) }),
    ).rejects.toBeInstanceOf(GrantCaseNotInTenantError);
    await expect(
      grantExternalAuditorAccess(managerA, { externalAuditorUserId: managerUserA.id, caseIds: [caseA.id], reason: "wrong role", expiresAt: new Date(Date.now() + 60_000) }),
    ).rejects.toBeInstanceOf(AuditorUserNotEligibleError);
    await expect(
      grantExternalAuditorAccess(managerA, { externalAuditorUserId: auditor.user.id, caseIds: [caseA.id], reason: "past", expiresAt: new Date(Date.now() - 1_000) }),
    ).rejects.toBeInstanceOf(GrantExpiryInvalidError);

    await grantExternalAuditorAccess(managerA, { externalAuditorUserId: auditor.user.id, caseIds: [caseA.id], reason: "view only", expiresAt: new Date(Date.now() + 60_000) });
    await expect(getEvidenceForAuditor(auditor.session, caseA.id, evidence.id)).rejects.toBeInstanceOf(DownloadNotPermittedByGrantError);
  });

  it("defaults both notification and invitation delivery to honest local no-op providers", () => {
    expect(getDefaultAuditorInvitationProvider().name).toBe("noop");
    expect(getDefaultInvestigationNotificationProvider().channel).toBe("NOOP");
  });
});

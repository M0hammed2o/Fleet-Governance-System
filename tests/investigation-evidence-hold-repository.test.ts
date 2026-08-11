import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createInvestigationCase } from "@/lib/repositories/investigation-case-repository";
import {
  EvidenceLinkNotFoundError,
  MediaAssetNotInTenantError,
  getEvidenceDownloadUrl,
  linkEvidenceFromMediaAsset,
  markEvidenceEnteredInError,
} from "@/lib/repositories/investigation-evidence-repository";
import { releaseInvestigationHold } from "@/lib/repositories/investigation-hold-repository";
import { uploadMediaAsset } from "@/lib/repositories/media-asset-repository";
import { createDeletionRequest, EmptyDeletionScopeError } from "@/lib/repositories/retention-repository";
import { createDriver, createTenant, fakeImageBytes } from "./helpers/fixtures";
import { makeManagerSessionForTenant } from "./helpers/investigation-fixtures";

async function createAsset(tenantId: string, actorUserId: string) {
  const driver = await createDriver(tenantId);
  return uploadMediaAsset({
    tenantId,
    actorUserId,
    ownerType: "DRIVER_PORTRAIT",
    ownerId: driver.id,
    fileName: "case-evidence.jpg",
    contentType: "image/jpeg",
    data: await fakeImageBytes(21),
    idempotencyKey: crypto.randomUUID(),
    category: "INVESTIGATION_EVIDENCE",
  });
}

describe("investigation evidence and holds", () => {
  it("links existing media once, applies a hold, and records append-only chain-of-custody events", async () => {
    const tenant = await createTenant("Evidence");
    const { session } = await makeManagerSessionForTenant(tenant);
    const investigationCase = await createInvestigationCase(session, { title: "Evidence case", description: "Neutral allegation", source: "MANUAL_CONCERN" });
    const asset = await createAsset(tenant.id, session.userId);

    const link = await linkEvidenceFromMediaAsset(session, investigationCase.id, { mediaAssetId: asset.id, description: "Gate photograph" });
    expect(link.evidenceNumber).toBe(1);
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).investigationHold).toBe(true);

    const correction = await markEvidenceEnteredInError(session, investigationCase.id, link.id, "Wrong camera angle selected");
    expect(correction.enteredInError).toBe(true);
    expect(await prisma.investigationEvidenceLink.count({ where: { id: link.id } })).toBe(1);
    const chronology = await prisma.investigationChronologyEvent.findMany({ where: { caseId: investigationCase.id }, orderBy: { occurredAt: "asc" } });
    expect(chronology.map((event) => event.eventType)).toEqual(expect.arrayContaining(["investigation.evidenceLinked", "investigation.evidenceMarkedEnteredInError"]));
  });

  it("rejects cross-tenant media and rejects a same-tenant cross-case nested evidence id", async () => {
    const tenantA = await createTenant("Evidence A");
    const tenantB = await createTenant("Evidence B");
    const { session: managerA } = await makeManagerSessionForTenant(tenantA);
    const { session: managerB } = await makeManagerSessionForTenant(tenantB);
    const caseA = await createInvestigationCase(managerA, { title: "A", description: "A", source: "MANUAL_CONCERN" });
    const otherCaseA = await createInvestigationCase(managerA, { title: "A2", description: "A2", source: "MANUAL_CONCERN" });
    const foreignAsset = await createAsset(tenantB.id, managerB.userId);

    await expect(linkEvidenceFromMediaAsset(managerA, caseA.id, { mediaAssetId: foreignAsset.id, description: "foreign" })).rejects.toBeInstanceOf(MediaAssetNotInTenantError);

    const localAsset = await createAsset(tenantA.id, managerA.userId);
    const link = await linkEvidenceFromMediaAsset(managerA, caseA.id, { mediaAssetId: localAsset.id, description: "local" });
    await expect(getEvidenceDownloadUrl(managerA, otherCaseA.id, link.id)).rejects.toBeInstanceOf(EvidenceLinkNotFoundError);
    await expect(markEvidenceEnteredInError(managerA, otherCaseA.id, link.id, "wrong case")).rejects.toBeInstanceOf(EvidenceLinkNotFoundError);
  });

  it("prevents ordinary retention deletion while an investigation hold is active", async () => {
    const tenant = await createTenant("Held deletion");
    const { session } = await makeManagerSessionForTenant(tenant);
    const investigationCase = await createInvestigationCase(session, { title: "Held", description: "Held evidence", source: "MANUAL_CONCERN" });
    const asset = await createAsset(tenant.id, session.userId);
    await linkEvidenceFromMediaAsset(session, investigationCase.id, { mediaAssetId: asset.id, description: "Held item" });

    await expect(
      createDeletionRequest({ tenantId: tenant.id, actorUserId: session.userId, scope: { categories: ["INVESTIGATION_EVIDENCE"] } }),
    ).rejects.toBeInstanceOf(EmptyDeletionScopeError);
  });

  it("requires a different second approver to release a high-severity hold and audits the release", async () => {
    const tenant = await createTenant("Dual hold");
    const { session: first } = await makeManagerSessionForTenant(tenant);
    const { session: second } = await makeManagerSessionForTenant(tenant);
    const investigationCase = await createInvestigationCase(first, { title: "High severity", description: "Neutral", source: "MANUAL_CONCERN", priority: "HIGH" });
    const asset = await createAsset(tenant.id, first.userId);
    await linkEvidenceFromMediaAsset(first, investigationCase.id, { mediaAssetId: asset.id, description: "Held item" });

    expect(await releaseInvestigationHold(first, investigationCase.id, "Review complete")).toEqual({ released: false, requiresSecondApprover: true });
    expect(await releaseInvestigationHold(first, investigationCase.id, "Still requesting")).toEqual({ released: false, requiresSecondApprover: true });
    expect((await prisma.investigationCase.findUniqueOrThrow({ where: { id: investigationCase.id } })).evidenceHoldActive).toBe(true);

    expect(await releaseInvestigationHold(second, investigationCase.id, "Independent confirmation")).toEqual({ released: true, caseId: investigationCase.id });
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).investigationHold).toBe(false);
    expect(await prisma.investigationChronologyEvent.count({ where: { caseId: investigationCase.id, eventType: "investigation.holdReleased" } })).toBe(1);
  });
});

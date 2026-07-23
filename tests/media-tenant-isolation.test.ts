import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  uploadMediaAsset,
  getMediaAssetInTenant,
  mintSignedUrlForMediaAsset,
  serveRawMediaAsset,
  MediaOwnerNotFoundError,
} from "@/lib/repositories/media-asset-repository";
import { startGateEvent, recordInspectionResult, EvidenceMediaAssetNotFoundError } from "@/lib/repositories/gate-event-repository";
import { createMovement } from "@/lib/repositories/movement-repository";
import { prisma } from "@/lib/db/prisma";
import { createTenant, createRole, createUser, createSite, createGate, createDriver, createVehicle } from "./helpers/fixtures";

function unique() {
  return crypto.randomUUID();
}

async function makeActor(tenantId: string) {
  const role = await createRole(tenantId);
  return createUser({ tenantId, roleId: role.id, email: `${unique()}@example.test` });
}

async function setUpGateEvent(tenantId: string) {
  const actor = await makeActor(tenantId);
  const site = await createSite(tenantId);
  const gate = await createGate(tenantId, site.id);
  const driver = await createDriver(tenantId);
  const vehicle = await createVehicle(tenantId);
  const movement = await createMovement({
    tenantId,
    siteId: site.id,
    vehicleId: vehicle.id,
    driverId: driver.id,
    movementType: "DELIVERY",
    requesterUserId: actor.id,
  });
  await prisma.movementAuthorisation.update({ where: { id: movement.id }, data: { status: "APPROVED" } });
  const gateEvent = await startGateEvent({
    tenantId,
    movementAuthorisationId: movement.id,
    gateId: gate.id,
    direction: "ENTRY",
    securityOfficerUserId: actor.id,
  });
  return { actor, gateEvent: gateEvent! };
}

describe("cross-tenant access denied for MediaAsset (Phase 4)", () => {
  it("a MediaAsset uploaded in Tenant A is invisible to Tenant B via getMediaAssetInTenant", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const { actor, gateEvent } = await setUpGateEvent(tenantA.id);

    const asset = await uploadMediaAsset({
      tenantId: tenantA.id,
      actorUserId: actor.id,
      ownerType: "GATE_EVENT_INSPECTION_ITEM",
      ownerId: gateEvent.id,
      fileName: "evidence.jpg",
      contentType: "image/jpeg",
      data: Buffer.from("tenant a evidence bytes"),
      idempotencyKey: unique(),
    });

    expect(await getMediaAssetInTenant(tenantB.id, asset.id)).toBeNull();
    expect(await getMediaAssetInTenant(tenantA.id, asset.id)).not.toBeNull();
  });

  it("Tenant B cannot mint a signed URL for Tenant A's media (mintSignedUrlForMediaAsset returns null)", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const { actor, gateEvent } = await setUpGateEvent(tenantA.id);
    const actorB = await makeActor(tenantB.id);

    const asset = await uploadMediaAsset({
      tenantId: tenantA.id,
      actorUserId: actor.id,
      ownerType: "GATE_EVENT_INSPECTION_ITEM",
      ownerId: gateEvent.id,
      fileName: "evidence.jpg",
      contentType: "image/jpeg",
      data: Buffer.from("tenant a evidence bytes"),
      idempotencyKey: unique(),
    });

    expect(await mintSignedUrlForMediaAsset(tenantB.id, actorB.id, asset.id)).toBeNull();
  });

  it("Tenant B cannot read Tenant A's media even with a genuine Tenant-A-minted signed URL (serveRawMediaAsset checks the requesting tenant too)", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const { actor, gateEvent } = await setUpGateEvent(tenantA.id);

    const asset = await uploadMediaAsset({
      tenantId: tenantA.id,
      actorUserId: actor.id,
      ownerType: "GATE_EVENT_INSPECTION_ITEM",
      ownerId: gateEvent.id,
      fileName: "evidence.jpg",
      contentType: "image/jpeg",
      data: Buffer.from("tenant a evidence bytes"),
      idempotencyKey: unique(),
    });
    const minted = await mintSignedUrlForMediaAsset(tenantA.id, actor.id, asset.id, 300);
    const parsed = new URL(minted!.url, "http://localhost");
    const storageKey = Buffer.from(parsed.searchParams.get("key")!, "base64url").toString("utf8");
    const expiresAt = Number(parsed.searchParams.get("expires"));
    const signature = parsed.searchParams.get("sig")!;

    await expect(
      serveRawMediaAsset({ storageKey, expiresAt, signature, requestingTenantId: tenantB.id }),
    ).rejects.toThrow();
  });

  it("Tenant B cannot upload evidence against Tenant A's gate event by guessing its id (MediaOwnerNotFoundError)", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const { gateEvent } = await setUpGateEvent(tenantA.id);
    const actorB = await makeActor(tenantB.id);

    await expect(
      uploadMediaAsset({
        tenantId: tenantB.id,
        actorUserId: actorB.id,
        ownerType: "GATE_EVENT_INSPECTION_ITEM",
        ownerId: gateEvent.id, // belongs to tenant A
        fileName: "evidence.jpg",
        contentType: "image/jpeg",
        data: Buffer.from("bytes"),
        idempotencyKey: unique(),
      }),
    ).rejects.toBeInstanceOf(MediaOwnerNotFoundError);
  });

  it("recordInspectionResult rejects an evidenceMediaAssetId that belongs to a different gate event/tenant", async () => {
    const tenantA = await createTenant("Tenant A");
    const { actor, gateEvent } = await setUpGateEvent(tenantA.id);
    const otherTenant = await createTenant("Other Tenant");
    const { actor: otherActor, gateEvent: otherGateEvent } = await setUpGateEvent(otherTenant.id);

    // Evidence genuinely uploaded, but against a *different* gate event.
    const foreignAsset = await uploadMediaAsset({
      tenantId: otherTenant.id,
      actorUserId: otherActor.id,
      ownerType: "GATE_EVENT_INSPECTION_ITEM",
      ownerId: otherGateEvent.id,
      fileName: "evidence.jpg",
      contentType: "image/jpeg",
      data: Buffer.from("bytes"),
      idempotencyKey: unique(),
    });

    const tpl = await prisma.inspectionTemplate.create({
      data: {
        tenantId: tenantA.id,
        name: `Template ${unique()}`,
        version: 1,
        isActive: true,
        items: { create: [{ section: "VEHICLE_IDENTITY", label: "Registration matches", sortOrder: 0, responseType: "CHECK" }] },
      },
      include: { items: true },
    });
    await prisma.gateEvent.update({
      where: { id: gateEvent.id },
      data: { status: "VEHICLE_CHECKS_IN_PROGRESS", inspectionTemplateId: tpl.id },
    });

    await expect(
      recordInspectionResult({
        tenantId: tenantA.id,
        gateEventId: gateEvent.id,
        inspectionItemId: tpl.items[0].id,
        actorUserId: actor.id,
        outcome: "FAIL",
        evidenceMediaAssetId: foreignAsset.id,
      }),
    ).rejects.toBeInstanceOf(EvidenceMediaAssetNotFoundError);
  });
});

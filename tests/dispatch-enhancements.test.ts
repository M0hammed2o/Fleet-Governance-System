import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createMovement } from "@/lib/repositories/movement-repository";
import { uploadMediaAsset, MediaOwnerNotFoundError } from "@/lib/repositories/media-asset-repository";
import { createTenant, createRole, createUser, createSite, createDriver, createVehicle, fakeImageBytes } from "./helpers/fixtures";

async function baseSetup() {
  const tenant = await createTenant();
  const role = await createRole(tenant.id);
  const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const site = await createSite(tenant.id);
  const driver = await createDriver(tenant.id);
  const vehicle = await createVehicle(tenant.id);
  return { tenant, user, site, driver, vehicle };
}

describe("DISPATCH-001 — extended movement types", () => {
  it.each(["SALES_VISIT", "SERVICE", "AUTHORISED_PRIVATE_USE"] as const)(
    "accepts the new movement type %s while existing types remain unaffected",
    async (movementType) => {
      const { tenant, user, site, driver, vehicle } = await baseSetup();
      const movement = await createMovement({
        tenantId: tenant.id,
        siteId: site.id,
        vehicleId: vehicle.id,
        driverId: driver.id,
        movementType,
        requesterUserId: user.id,
      });
      expect(movement.movementType).toBe(movementType);
    },
  );

  it("still accepts every pre-existing movement type", async () => {
    const { tenant, user, site, driver, vehicle } = await baseSetup();
    for (const movementType of ["ENTRY", "EXIT", "DELIVERY", "COLLECTION", "RETURN", "SITE_TRANSFER", "MAINTENANCE", "OTHER"] as const) {
      const movement = await createMovement({
        tenantId: tenant.id,
        siteId: site.id,
        vehicleId: vehicle.id,
        driverId: driver.id,
        movementType,
        requesterUserId: user.id,
      });
      expect(movement.movementType).toBe(movementType);
    }
  });
});

describe("DISPATCH-002 — sender/recipient fields", () => {
  it("captures sender and recipient details on the movement record", async () => {
    const { tenant, user, site, driver, vehicle } = await baseSetup();
    const movement = await createMovement({
      tenantId: tenant.id,
      siteId: site.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      movementType: "DELIVERY",
      requesterUserId: user.id,
      senderName: "Acme Warehouse",
      senderContact: "+27 11 555 0100",
      recipientName: "Beta Retail (Pty) Ltd",
      recipientContact: "orders@beta-retail.test",
    });

    expect(movement.senderName).toBe("Acme Warehouse");
    expect(movement.senderContact).toBe("+27 11 555 0100");
    expect(movement.recipientName).toBe("Beta Retail (Pty) Ltd");
    expect(movement.recipientContact).toBe("orders@beta-retail.test");
  });

  it("leaves sender/recipient null when not provided (not required for every movement type)", async () => {
    const { tenant, user, site, driver, vehicle } = await baseSetup();
    const movement = await createMovement({
      tenantId: tenant.id,
      siteId: site.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      movementType: "SITE_TRANSFER",
      requesterUserId: user.id,
    });
    expect(movement.senderName).toBeNull();
    expect(movement.recipientName).toBeNull();
  });
});

describe("DISPATCH-004 — optional vehicle-use-policy reference", () => {
  // As of Phase 6, VehicleUsePolicy exists and vehicleUsePolicyId is a real
  // FK (DECISIONS.md D-019's revisit condition) — a plain unvalidated string
  // is no longer accepted; see tests/telematics-repository.test.ts for the
  // full VehicleUsePolicy behaviour this now enforces.
  it("rejects a vehicleUsePolicyId that doesn't reference a real policy", async () => {
    const { tenant, user, site, driver, vehicle } = await baseSetup();
    await expect(
      createMovement({
        tenantId: tenant.id,
        siteId: site.id,
        vehicleId: vehicle.id,
        driverId: driver.id,
        movementType: "AUTHORISED_PRIVATE_USE",
        requesterUserId: user.id,
        vehicleUsePolicyId: "not-a-real-policy-id",
      }),
    ).rejects.toThrow();
  });

  it("leaves vehicleUsePolicyId null when not provided", async () => {
    const { tenant, user, site, driver, vehicle } = await baseSetup();
    const movement = await createMovement({
      tenantId: tenant.id,
      siteId: site.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      movementType: "DELIVERY",
      requesterUserId: user.id,
    });
    expect(movement.vehicleUsePolicyId).toBeNull();
  });
});

describe("DISPATCH-003 — secure delivery-note/document upload (existing MediaAsset architecture)", () => {
  it("uploads a document against a real movement, tenant-scoped", async () => {
    const { tenant, user, site, driver, vehicle } = await baseSetup();
    const movement = await createMovement({
      tenantId: tenant.id,
      siteId: site.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      movementType: "DELIVERY",
      requesterUserId: user.id,
    });

    const asset = await uploadMediaAsset({
      tenantId: tenant.id,
      actorUserId: user.id,
      ownerType: "MOVEMENT_DOCUMENT",
      ownerId: movement.id,
      fileName: "delivery-note.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(201),
      idempotencyKey: crypto.randomUUID(),
    });

    expect(asset.ownerType).toBe("MOVEMENT_DOCUMENT");
    expect(asset.ownerId).toBe(movement.id);
  });

  it("rejects uploading a document against a movement id from a different tenant", async () => {
    const setup = await baseSetup();
    const otherTenant = await createTenant("Other Tenant");
    const movement = await createMovement({
      tenantId: setup.tenant.id,
      siteId: setup.site.id,
      vehicleId: setup.vehicle.id,
      driverId: setup.driver.id,
      movementType: "DELIVERY",
      requesterUserId: setup.user.id,
    });

    await expect(
      uploadMediaAsset({
        tenantId: otherTenant.id,
        actorUserId: setup.user.id,
        ownerType: "MOVEMENT_DOCUMENT",
        ownerId: movement.id,
        fileName: "delivery-note.pdf",
        contentType: "image/png",
        data: await fakeImageBytes(202),
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(MediaOwnerNotFoundError);
  });

  it("allows multiple documents against the same movement (many-to-one, not a unique-per-owner constraint)", async () => {
    const { tenant, user, site, driver, vehicle } = await baseSetup();
    const movement = await createMovement({
      tenantId: tenant.id,
      siteId: site.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      movementType: "DELIVERY",
      requesterUserId: user.id,
    });

    await uploadMediaAsset({
      tenantId: tenant.id,
      actorUserId: user.id,
      ownerType: "MOVEMENT_DOCUMENT",
      ownerId: movement.id,
      fileName: "delivery-note.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(203),
      idempotencyKey: crypto.randomUUID(),
    });
    await uploadMediaAsset({
      tenantId: tenant.id,
      actorUserId: user.id,
      ownerType: "MOVEMENT_DOCUMENT",
      ownerId: movement.id,
      fileName: "proof-of-delivery.jpg",
      contentType: "image/jpeg",
      data: await fakeImageBytes(204),
      idempotencyKey: crypto.randomUUID(),
    });

    const documents = await prisma.mediaAsset.findMany({
      where: { tenantId: tenant.id, ownerType: "MOVEMENT_DOCUMENT", ownerId: movement.id },
    });
    expect(documents).toHaveLength(2);
  });
});

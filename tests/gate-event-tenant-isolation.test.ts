import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getGateEventInTenant, listGateEventsInTenant, startGateEvent } from "@/lib/repositories/gate-event-repository";
import { createMovement } from "@/lib/repositories/movement-repository";
import { createTenant, createRole, createUser, createSite, createGate, createDriver, createVehicle } from "./helpers/fixtures";

describe("cross-tenant access denied for GateEvent (Phase 3)", () => {
  it("a gate event created in Tenant A is invisible and unreachable from Tenant B", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const role = await createRole(tenantA.id);
    const user = await createUser({ tenantId: tenantA.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const site = await createSite(tenantA.id);
    const gate = await createGate(tenantA.id, site.id);
    const driver = await createDriver(tenantA.id);
    const vehicle = await createVehicle(tenantA.id);

    const movement = await createMovement({
      tenantId: tenantA.id,
      siteId: site.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      movementType: "DELIVERY",
      requesterUserId: user.id,
    });
    await prisma.movementAuthorisation.update({ where: { id: movement.id }, data: { status: "APPROVED" } });

    const gateEvent = await startGateEvent({
      tenantId: tenantA.id,
      movementAuthorisationId: movement.id,
      gateId: gate.id,
      direction: "ENTRY",
      securityOfficerUserId: user.id,
    });

    expect(await getGateEventInTenant(tenantB.id, gateEvent!.id)).toBeNull();
    const tenantBEvents = await listGateEventsInTenant(tenantB.id);
    expect(tenantBEvents.items.find((e) => e.id === gateEvent!.id)).toBeUndefined();

    // Still fully visible from its own tenant.
    expect(await getGateEventInTenant(tenantA.id, gateEvent!.id)).not.toBeNull();
  });

  it("Tenant B cannot start a gate event against Tenant A's movement id even if it guesses it — the record is stamped to the caller's tenant", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const roleA = await createRole(tenantA.id);
    const userA = await createUser({ tenantId: tenantA.id, roleId: roleA.id, email: `${crypto.randomUUID()}@example.test` });
    const siteA = await createSite(tenantA.id);
    const driverA = await createDriver(tenantA.id);
    const vehicleA = await createVehicle(tenantA.id);
    const movementA = await createMovement({
      tenantId: tenantA.id,
      siteId: siteA.id,
      vehicleId: vehicleA.id,
      driverId: driverA.id,
      movementType: "DELIVERY",
      requesterUserId: userA.id,
    });
    await prisma.movementAuthorisation.update({ where: { id: movementA.id }, data: { status: "APPROVED" } });

    const roleB = await createRole(tenantB.id);
    const userB = await createUser({ tenantId: tenantB.id, roleId: roleB.id, email: `${crypto.randomUUID()}@example.test` });
    const siteB = await createSite(tenantB.id);
    const gateB = await createGate(tenantB.id, siteB.id);

    // tenantWhere() inside startGateEvent scopes the movement lookup to
    // tenantB, so Tenant A's movement id simply isn't found for Tenant B.
    const result = await startGateEvent({
      tenantId: tenantB.id,
      movementAuthorisationId: movementA.id,
      gateId: gateB.id,
      direction: "ENTRY",
      securityOfficerUserId: userB.id,
    });
    expect(result).toBeNull();
  });
});

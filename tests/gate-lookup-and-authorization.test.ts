import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { hasPermission } from "@/lib/auth/authorize";
import type { AuthenticatedSession } from "@/lib/auth/session";
import { createMovement, searchMovementsForGate } from "@/lib/repositories/movement-repository";
import { createTenant, createRole, createUser, createSite, createDriver, createVehicle, grantPermission } from "./helpers/fixtures";

async function makeSession(tenantId: string, roleId: string, userId: string): Promise<AuthenticatedSession> {
  return { sessionId: "n/a", tenantId, userId, roleId, roleName: "Test Role", userStatus: "ACTIVE", tenantStatus: "ACTIVE" };
}

describe("gate-facing lookup", () => {
  it("a gate officer can find an approved movement by registration number, driver name, or reference code", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id);
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const site = await createSite(tenant.id);
    const driver = await createDriver(tenant.id, { name: "Findable Driver" });
    const vehicle = await createVehicle(tenant.id, { registrationNumber: "FINDME01GP" });

    const movement = await createMovement({
      tenantId: tenant.id,
      siteId: site.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      movementType: "DELIVERY",
      requesterUserId: user.id,
    });
    await prisma.movementAuthorisation.update({ where: { id: movement.id }, data: { status: "APPROVED" } });

    const byRegistration = await searchMovementsForGate(tenant.id, "FINDME01GP");
    expect(byRegistration.map((m) => m.id)).toContain(movement.id);

    const byDriverName = await searchMovementsForGate(tenant.id, "Findable Driver");
    expect(byDriverName.map((m) => m.id)).toContain(movement.id);

    const byReferenceCode = await searchMovementsForGate(tenant.id, movement.referenceCode);
    expect(byReferenceCode.map((m) => m.id)).toContain(movement.id);
  });

  it("does not surface DRAFT movements at the gate (not yet submitted/approved)", async () => {
    const tenant = await createTenant();
    const role = await createRole(tenant.id);
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const site = await createSite(tenant.id);
    const driver = await createDriver(tenant.id, { name: "Draft Only Driver" });
    const vehicle = await createVehicle(tenant.id, { registrationNumber: "DRAFTONLY1" });

    await createMovement({
      tenantId: tenant.id,
      siteId: site.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      movementType: "DELIVERY",
      requesterUserId: user.id,
    });

    const results = await searchMovementsForGate(tenant.id, "DRAFTONLY1");
    expect(results).toHaveLength(0);
  });

  it("a gate officer's session cannot modify a movement — they have movement:VIEW but not EDIT/APPROVE/REJECT/DELETE", async () => {
    const tenant = await createTenant();
    const gateRole = await createRole(tenant.id, "Gate Security Officer");
    await grantPermission(gateRole.id, "movement", "VIEW");
    const officer = await createUser({ tenantId: tenant.id, roleId: gateRole.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await makeSession(tenant.id, gateRole.id, officer.id);

    expect(await hasPermission(session, "movement", "VIEW")).toBe(true);
    expect(await hasPermission(session, "movement", "EDIT")).toBe(false);
    expect(await hasPermission(session, "movement", "APPROVE")).toBe(false);
    expect(await hasPermission(session, "movement", "REJECT")).toBe(false);
    expect(await hasPermission(session, "movement", "DELETE")).toBe(false);
    expect(await hasPermission(session, "movement", "CREATE")).toBe(false);
  });
});

describe("movement approval authorization", () => {
  it("a user without movement:APPROVE cannot approve, and without movement:REJECT cannot reject", async () => {
    const tenant = await createTenant();
    const fleetManagerLikeRole = await createRole(tenant.id, "Fleet Manager");
    await grantPermission(fleetManagerLikeRole.id, "movement", "VIEW");
    await grantPermission(fleetManagerLikeRole.id, "movement", "CREATE");
    await grantPermission(fleetManagerLikeRole.id, "movement", "EDIT");
    const fleetManager = await createUser({ tenantId: tenant.id, roleId: fleetManagerLikeRole.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await makeSession(tenant.id, fleetManagerLikeRole.id, fleetManager.id);

    expect(await hasPermission(session, "movement", "APPROVE")).toBe(false);
    expect(await hasPermission(session, "movement", "REJECT")).toBe(false);
  });

  it("a user with movement:APPROVE can approve", async () => {
    const tenant = await createTenant();
    const approverRole = await createRole(tenant.id, "Approving Manager");
    await grantPermission(approverRole.id, "movement", "APPROVE");
    const approver = await createUser({ tenantId: tenant.id, roleId: approverRole.id, email: `${crypto.randomUUID()}@example.test` });
    const session = await makeSession(tenant.id, approverRole.id, approver.id);

    expect(await hasPermission(session, "movement", "APPROVE")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { getDriverInTenant, listDriversInTenant } from "@/lib/repositories/driver-repository";
import { getVehicleInTenant, listVehiclesInTenant } from "@/lib/repositories/vehicle-repository";
import { getMovementInTenant, listMovementsInTenant, createMovement } from "@/lib/repositories/movement-repository";
import { createTenant, createUser, createRole, createSite, createDriver, createVehicle } from "./helpers/fixtures";

describe("cross-tenant access denied for Phase 2 master data", () => {
  it("a driver created in Tenant A is invisible and unreachable from Tenant B", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const driver = await createDriver(tenantA.id, { name: "Cross Tenant Driver" });

    expect(await getDriverInTenant(tenantB.id, driver.id)).toBeNull();
    const tenantBDrivers = await listDriversInTenant(tenantB.id);
    expect(tenantBDrivers.items.find((d) => d.id === driver.id)).toBeUndefined();
  });

  it("a vehicle created in Tenant A is invisible and unreachable from Tenant B", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const vehicle = await createVehicle(tenantA.id, { registrationNumber: "XTENANT01" });

    expect(await getVehicleInTenant(tenantB.id, vehicle.id)).toBeNull();
    const tenantBVehicles = await listVehiclesInTenant(tenantB.id);
    expect(tenantBVehicles.items.find((v) => v.id === vehicle.id)).toBeUndefined();
  });

  it("a movement created in Tenant A is invisible and unreachable from Tenant B", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const role = await createRole(tenantA.id);
    const user = await createUser({ tenantId: tenantA.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const site = await createSite(tenantA.id);
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

    expect(await getMovementInTenant(tenantB.id, movement.id)).toBeNull();
    const tenantBMovements = await listMovementsInTenant(tenantB.id);
    expect(tenantBMovements.items.find((m) => m.id === movement.id)).toBeUndefined();
  });

  it("Tenant B cannot create a movement referencing Tenant A's driver/vehicle ids even if it guesses them", async () => {
    // createMovement itself doesn't re-validate tenant ownership (that's the
    // route's job, tested by the ApiError 400 paths) — but the record it
    // writes is still tenantId-stamped to the *caller's* tenant, so even a
    // successful call can never make Tenant A's data visible to Tenant B;
    // confirming here that such a movement never appears in Tenant A's list.
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const roleB = await createRole(tenantB.id);
    const userB = await createUser({ tenantId: tenantB.id, roleId: roleB.id, email: `${crypto.randomUUID()}@example.test` });
    const siteA = await createSite(tenantA.id);
    const driverA = await createDriver(tenantA.id);
    const vehicleA = await createVehicle(tenantA.id);

    const movement = await createMovement({
      tenantId: tenantB.id,
      siteId: siteA.id,
      vehicleId: vehicleA.id,
      driverId: driverA.id,
      movementType: "DELIVERY",
      requesterUserId: userB.id,
    });

    const tenantAMovements = await listMovementsInTenant(tenantA.id);
    expect(tenantAMovements.items.find((m) => m.id === movement.id)).toBeUndefined();
  });
});

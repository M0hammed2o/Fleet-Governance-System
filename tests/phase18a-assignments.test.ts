import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { assignDriverToVehicle, AssignmentConflictError, AssignmentOwnershipError, endDriverVehicleAssignment, listAssignmentsInTenant } from "@/lib/repositories/driver-vehicle-assignment-repository";
import { createDriver, createRole, createTenant, createUser, createVehicle } from "./helpers/fixtures";

describe("Phase 18A effective-dated assignments", () => {
  it("refuses conflicts, permits explicit reassignment and preserves history", async () => {
    const tenant = await createTenant("Assignment tenant"); const role = await createRole(tenant.id);
    const actor = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const firstDriver = await createDriver(tenant.id); const secondDriver = await createDriver(tenant.id); const vehicle = await createVehicle(tenant.id);
    const first = await assignDriverToVehicle({ tenantId: tenant.id, driverId: firstDriver.id, vehicleId: vehicle.id, actorUserId: actor.id, reason: "Initial allocation", replaceExisting: false });
    await expect(assignDriverToVehicle({ tenantId: tenant.id, driverId: secondDriver.id, vehicleId: vehicle.id, actorUserId: actor.id, reason: "Conflicting allocation", replaceExisting: false })).rejects.toBeInstanceOf(AssignmentConflictError);
    const second = await assignDriverToVehicle({ tenantId: tenant.id, driverId: secondDriver.id, vehicleId: vehicle.id, actorUserId: actor.id, reason: "Authorised operational reassignment", replaceExisting: true });
    const history = await listAssignmentsInTenant(tenant.id, { vehicleId: vehicle.id });
    expect(history).toHaveLength(2); expect(history.find((item) => item.id === first.id)).toMatchObject({ status: "ENDED" }); expect(history.find((item) => item.id === second.id)).toMatchObject({ status: "ACTIVE", effectiveTo: null });
    await endDriverVehicleAssignment({ tenantId: tenant.id, assignmentId: second.id, actorUserId: actor.id, reason: "End of synthetic duty" });
    expect((await listAssignmentsInTenant(tenant.id, { activeOnly: true })).length).toBe(0);
  });

  it("rejects cross-tenant driver or vehicle identifiers", async () => {
    const tenantA = await createTenant("Assignment A"); const tenantB = await createTenant("Assignment B"); const role = await createRole(tenantB.id);
    const actor = await createUser({ tenantId: tenantB.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
    const driverA = await createDriver(tenantA.id); const vehicleB = await createVehicle(tenantB.id);
    await expect(assignDriverToVehicle({ tenantId: tenantB.id, driverId: driverA.id, vehicleId: vehicleB.id, actorUserId: actor.id, reason: "Guessed foreign identifier", replaceExisting: false })).rejects.toBeInstanceOf(AssignmentOwnershipError);
  });
});

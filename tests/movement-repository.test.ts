import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createMovement,
  approveMovement,
  rejectMovement,
  cancelMovement,
  DriverNotAvailableError,
  VehicleNotAvailableError,
  SelfApprovalNotAllowedError,
} from "@/lib/repositories/movement-repository";
import { InvalidMovementTransitionError } from "@/lib/movements/state-machine";
import { createTenant, createRole, createUser, createSite, createDriver, createVehicle } from "./helpers/fixtures";

async function baseSetup() {
  const tenant = await createTenant();
  const role = await createRole(tenant.id);
  const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const site = await createSite(tenant.id);
  const driver = await createDriver(tenant.id);
  const vehicle = await createVehicle(tenant.id);
  return { tenant, user, site, driver, vehicle };
}

describe("createMovement eligibility (suspended driver / locked vehicle)", () => {
  it("rejects creating a movement for a suspended driver", async () => {
    const { tenant, user, site, vehicle } = await baseSetup();
    const suspendedDriver = await createDriver(tenant.id, { status: "SUSPENDED" });

    await expect(
      createMovement({
        tenantId: tenant.id,
        siteId: site.id,
        vehicleId: vehicle.id,
        driverId: suspendedDriver.id,
        movementType: "DELIVERY",
        requesterUserId: user.id,
      }),
    ).rejects.toBeInstanceOf(DriverNotAvailableError);
  });

  it("rejects creating a movement for a blacklisted driver", async () => {
    const { tenant, user, site, vehicle } = await baseSetup();
    const blacklistedDriver = await createDriver(tenant.id, { status: "BLACKLISTED" });

    await expect(
      createMovement({
        tenantId: tenant.id,
        siteId: site.id,
        vehicleId: vehicle.id,
        driverId: blacklistedDriver.id,
        movementType: "DELIVERY",
        requesterUserId: user.id,
      }),
    ).rejects.toBeInstanceOf(DriverNotAvailableError);
  });

  it("rejects creating a movement for a workshop-locked vehicle", async () => {
    const { tenant, user, site, driver } = await baseSetup();
    const lockedVehicle = await createVehicle(tenant.id, { operationalStatus: "WORKSHOP_LOCKOUT" });

    await expect(
      createMovement({
        tenantId: tenant.id,
        siteId: site.id,
        vehicleId: lockedVehicle.id,
        driverId: driver.id,
        movementType: "DELIVERY",
        requesterUserId: user.id,
      }),
    ).rejects.toBeInstanceOf(VehicleNotAvailableError);
  });

  it("rejects creating a movement for a security-locked vehicle", async () => {
    const { tenant, user, site, driver } = await baseSetup();
    const lockedVehicle = await createVehicle(tenant.id, { operationalStatus: "SECURITY_LOCKOUT" });

    await expect(
      createMovement({
        tenantId: tenant.id,
        siteId: site.id,
        vehicleId: lockedVehicle.id,
        driverId: driver.id,
        movementType: "DELIVERY",
        requesterUserId: user.id,
      }),
    ).rejects.toBeInstanceOf(VehicleNotAvailableError);
  });

  it("allows creating a movement for an active driver and operational vehicle", async () => {
    const { tenant, user, site, driver, vehicle } = await baseSetup();
    const movement = await createMovement({
      tenantId: tenant.id,
      siteId: site.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      movementType: "DELIVERY",
      requesterUserId: user.id,
    });
    expect(movement.status).toBe("DRAFT");
    expect(movement.referenceCode).toMatch(/^MV-/);
  });

  it("records an audit event for every create/edit/suspension/approval-relevant transition", async () => {
    const { tenant, user, site, driver, vehicle } = await baseSetup();
    const movement = await createMovement({
      tenantId: tenant.id,
      siteId: site.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      movementType: "DELIVERY",
      requesterUserId: user.id,
    });

    // createMovement itself doesn't audit-log (the route does, since it's the
    // place with a session/actor) — submit/approve/reject/cancel do, from the
    // repository layer directly.
    await prisma.movementAuthorisation.update({ where: { id: movement.id }, data: { status: "SUBMITTED" } });
    const role2 = await createRole(tenant.id, "Approver");
    const approver = await createUser({ tenantId: tenant.id, roleId: role2.id, email: `${crypto.randomUUID()}@example.test` });

    await approveMovement({ tenantId: tenant.id, movementId: movement.id, approverUserId: approver.id });

    const auditRow = await prisma.auditLog.findFirst({
      where: { tenantId: tenant.id, action: "movement.approved", entityId: movement.id },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.userId).toBe(approver.id);
    expect(auditRow?.beforeValue).toEqual({ status: "SUBMITTED" });
    expect(auditRow?.afterValue).toEqual({ status: "APPROVED" });
  });
});

describe("movement self-approval rule", () => {
  it("rejects a requester approving their own movement when the tenant disallows self-approval (default)", async () => {
    const { tenant, user, site, driver, vehicle } = await baseSetup();
    const movement = await createMovement({
      tenantId: tenant.id,
      siteId: site.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      movementType: "DELIVERY",
      requesterUserId: user.id,
    });
    await prisma.movementAuthorisation.update({ where: { id: movement.id }, data: { status: "SUBMITTED" } });

    await expect(
      approveMovement({ tenantId: tenant.id, movementId: movement.id, approverUserId: user.id }),
    ).rejects.toBeInstanceOf(SelfApprovalNotAllowedError);
  });

  it("allows self-approval when the tenant explicitly opts in", async () => {
    const { tenant, user, site, driver, vehicle } = await baseSetup();
    await prisma.tenant.update({ where: { id: tenant.id }, data: { allowSelfApproveMovement: true } });

    const movement = await createMovement({
      tenantId: tenant.id,
      siteId: site.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      movementType: "DELIVERY",
      requesterUserId: user.id,
    });
    await prisma.movementAuthorisation.update({ where: { id: movement.id }, data: { status: "SUBMITTED" } });

    const approved = await approveMovement({ tenantId: tenant.id, movementId: movement.id, approverUserId: user.id });
    expect(approved?.status).toBe("APPROVED");
  });

  it("a different user (not the requester) can approve normally regardless of tenant policy", async () => {
    const { tenant, user, site, driver, vehicle } = await baseSetup();
    const approverRole = await createRole(tenant.id, "Approver");
    const approver = await createUser({ tenantId: tenant.id, roleId: approverRole.id, email: `${crypto.randomUUID()}@example.test` });

    const movement = await createMovement({
      tenantId: tenant.id,
      siteId: site.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      movementType: "DELIVERY",
      requesterUserId: user.id,
    });
    await prisma.movementAuthorisation.update({ where: { id: movement.id }, data: { status: "SUBMITTED" } });

    const approved = await approveMovement({ tenantId: tenant.id, movementId: movement.id, approverUserId: approver.id });
    expect(approved?.status).toBe("APPROVED");
  });
});

describe("movement transition enforcement via repository functions", () => {
  it("rejects approving a DRAFT movement (must be SUBMITTED first)", async () => {
    const { tenant, user, site, driver, vehicle } = await baseSetup();
    const approverRole = await createRole(tenant.id, "Approver");
    const approver = await createUser({ tenantId: tenant.id, roleId: approverRole.id, email: `${crypto.randomUUID()}@example.test` });

    const movement = await createMovement({
      tenantId: tenant.id,
      siteId: site.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      movementType: "DELIVERY",
      requesterUserId: user.id,
    });

    await expect(
      approveMovement({ tenantId: tenant.id, movementId: movement.id, approverUserId: approver.id }),
    ).rejects.toBeInstanceOf(InvalidMovementTransitionError);
  });

  it("rejects rejecting an already-cancelled movement", async () => {
    const { tenant, user, site, driver, vehicle } = await baseSetup();
    const movement = await createMovement({
      tenantId: tenant.id,
      siteId: site.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      movementType: "DELIVERY",
      requesterUserId: user.id,
    });
    await cancelMovement(tenant.id, movement.id, user.id, "changed plans");

    await expect(
      rejectMovement({ tenantId: tenant.id, movementId: movement.id, approverUserId: user.id }),
    ).rejects.toBeInstanceOf(InvalidMovementTransitionError);
  });
});

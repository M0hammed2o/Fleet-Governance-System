import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  startGateEvent,
  moveToIdentityPending,
  verifyIdentityForGateEvent,
  beginVehicleChecks,
  recordInspectionResult,
  raiseException,
  escalateExceptionToSupervisor,
  resolveException,
  clearGateEvent,
  denyGateEvent,
  completeGateEvent,
  cancelGateEvent,
  findOpenGateEventForMovement,
  getGateEventInTenant,
  MovementNotApprovedError,
  DriverNotAvailableError,
  VehicleNotAvailableError,
  SelfApprovalNotAllowedError,
  ExceptionAlreadyResolvedError,
  ExceptionNotEscalatedError,
  GateEventPreconditionError,
  InspectionItemNotFoundError,
} from "@/lib/repositories/gate-event-repository";
import { createMovement } from "@/lib/repositories/movement-repository";
import { InvalidGateEventTransitionError } from "@/lib/gate-events/state-machine";
import { createTenant, createRole, createUser, createSite, createGate, createDriver, createVehicle } from "./helpers/fixtures";

async function baseSetup() {
  const tenant = await createTenant();
  const role = await createRole(tenant.id);
  const requester = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const officer = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const supervisor = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const site = await createSite(tenant.id);
  const gate = await createGate(tenant.id, site.id);
  const driver = await createDriver(tenant.id);
  const vehicle = await createVehicle(tenant.id);
  return { tenant, requester, officer, supervisor, site, gate, driver, vehicle };
}

async function approvedMovement(tenantId: string, siteId: string, vehicleId: string, driverId: string, requesterUserId: string) {
  const movement = await createMovement({
    tenantId,
    siteId,
    vehicleId,
    driverId,
    movementType: "DELIVERY",
    requesterUserId,
  });
  return prisma.movementAuthorisation.update({ where: { id: movement.id }, data: { status: "APPROVED" } });
}

async function template(tenantId: string) {
  return prisma.inspectionTemplate.create({
    data: {
      tenantId,
      name: `Template ${crypto.randomUUID()}`,
      version: 1,
      isActive: true,
      items: {
        create: [
          { section: "VEHICLE_IDENTITY", label: "Registration matches", sortOrder: 0, responseType: "CHECK" },
          {
            section: "TYRES_WHEELS",
            label: "Tyre tread depth",
            sortOrder: 1,
            responseType: "READING",
            unit: "mm",
            defaultExceptionSeverity: "HIGH",
            requiresSupervisorApprovalOnFail: true,
          },
        ],
      },
    },
    include: { items: true },
  });
}

describe("startGateEvent eligibility and idempotency", () => {
  it("rejects starting a gate event for a movement that is not APPROVED", async () => {
    const { tenant, requester, site, driver, vehicle } = await baseSetup();
    const movement = await createMovement({
      tenantId: tenant.id,
      siteId: site.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      movementType: "DELIVERY",
      requesterUserId: requester.id,
    });
    const gate = await createGate(tenant.id, site.id);

    await expect(
      startGateEvent({ tenantId: tenant.id, movementAuthorisationId: movement.id, gateId: gate.id, direction: "ENTRY", securityOfficerUserId: requester.id }),
    ).rejects.toBeInstanceOf(MovementNotApprovedError);
  });

  it("rejects starting a gate event when the driver was suspended after the movement was approved (defense in depth)", async () => {
    const { tenant, requester, site, gate, driver, vehicle } = await baseSetup();
    const movement = await approvedMovement(tenant.id, site.id, vehicle.id, driver.id, requester.id);
    // Driver was fine at movement-creation/approval time, but has since been
    // suspended before physically reaching the gate — startGateEvent must
    // re-check, not just trust the earlier movement approval.
    await prisma.driver.update({ where: { id: driver.id }, data: { status: "SUSPENDED" } });

    await expect(
      startGateEvent({ tenantId: tenant.id, movementAuthorisationId: movement.id, gateId: gate.id, direction: "ENTRY", securityOfficerUserId: requester.id }),
    ).rejects.toBeInstanceOf(DriverNotAvailableError);
  });

  it("rejects starting a gate event when the vehicle was workshop-locked after the movement was approved (defense in depth)", async () => {
    const { tenant, requester, site, gate, driver, vehicle } = await baseSetup();
    const movement = await approvedMovement(tenant.id, site.id, vehicle.id, driver.id, requester.id);
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { operationalStatus: "WORKSHOP_LOCKOUT" } });

    await expect(
      startGateEvent({ tenantId: tenant.id, movementAuthorisationId: movement.id, gateId: gate.id, direction: "ENTRY", securityOfficerUserId: requester.id }),
    ).rejects.toBeInstanceOf(VehicleNotAvailableError);
  });

  it("is idempotent: a duplicate start call returns the existing open gate event, not a second row", async () => {
    const { tenant, requester, officer, site, gate, driver, vehicle } = await baseSetup();
    const movement = await approvedMovement(tenant.id, site.id, vehicle.id, driver.id, requester.id);

    const first = await startGateEvent({ tenantId: tenant.id, movementAuthorisationId: movement.id, gateId: gate.id, direction: "ENTRY", securityOfficerUserId: officer.id });
    const second = await startGateEvent({ tenantId: tenant.id, movementAuthorisationId: movement.id, gateId: gate.id, direction: "ENTRY", securityOfficerUserId: officer.id });

    expect(second?.id).toBe(first?.id);
    const count = await prisma.gateEvent.count({ where: { tenantId: tenant.id, movementAuthorisationId: movement.id } });
    expect(count).toBe(1);
  });

  it("starts directly into INSPECTION_STARTED with startedAt set (combined start+begin-inspection step)", async () => {
    const { tenant, requester, officer, site, gate, driver, vehicle } = await baseSetup();
    const movement = await approvedMovement(tenant.id, site.id, vehicle.id, driver.id, requester.id);

    const gateEvent = await startGateEvent({ tenantId: tenant.id, movementAuthorisationId: movement.id, gateId: gate.id, direction: "ENTRY", securityOfficerUserId: officer.id });

    expect(gateEvent?.status).toBe("INSPECTION_STARTED");
    expect(gateEvent?.startedAt).not.toBeNull();
    const auditRow = await prisma.auditLog.findFirst({ where: { tenantId: tenant.id, action: "gateEvent.started", entityId: gateEvent!.id } });
    expect(auditRow).not.toBeNull();
  });
});

describe("identity verification wiring", () => {
  it("moves to IDENTITY_VERIFIED on a VERIFIED mock outcome", async () => {
    const { tenant, requester, officer, site, gate, driver, vehicle } = await baseSetup();
    const movement = await approvedMovement(tenant.id, site.id, vehicle.id, driver.id, requester.id);
    const gateEvent = await startGateEvent({ tenantId: tenant.id, movementAuthorisationId: movement.id, gateId: gate.id, direction: "ENTRY", securityOfficerUserId: officer.id });
    await moveToIdentityPending(tenant.id, gateEvent!.id, officer.id);

    const outcome = await verifyIdentityForGateEvent(tenant.id, gateEvent!.id, officer.id, "normal-capture");
    expect(outcome?.outcome.result).toBe("VERIFIED");
    expect(outcome?.gateEvent?.status).toBe("IDENTITY_VERIFIED");
  });

  it("stays in IDENTITY_PENDING on a NOT_VERIFIED mock outcome (forced marker)", async () => {
    const { tenant, requester, officer, site, gate, driver, vehicle } = await baseSetup();
    const movement = await approvedMovement(tenant.id, site.id, vehicle.id, driver.id, requester.id);
    const gateEvent = await startGateEvent({ tenantId: tenant.id, movementAuthorisationId: movement.id, gateId: gate.id, direction: "ENTRY", securityOfficerUserId: officer.id });
    await moveToIdentityPending(tenant.id, gateEvent!.id, officer.id);

    const outcome = await verifyIdentityForGateEvent(tenant.id, gateEvent!.id, officer.id, "force:not_verified");
    expect(outcome?.outcome.result).toBe("NOT_VERIFIED");
    expect(outcome?.gateEvent).toBeNull();

    const reloaded = await getGateEventInTenant(tenant.id, gateEvent!.id);
    expect(reloaded?.status).toBe("IDENTITY_PENDING");
  });
});

describe("guided inspection and automatic exception raising", () => {
  it("a FAIL outcome on a supervisor-required item raises an exception and moves the gate event to EXCEPTION_RAISED", async () => {
    const { tenant, requester, officer, site, gate, driver, vehicle } = await baseSetup();
    const tpl = await template(tenant.id);
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { tyrePositionConfigId: null } });
    const movement = await approvedMovement(tenant.id, site.id, vehicle.id, driver.id, requester.id);
    const gateEvent = await startGateEvent({ tenantId: tenant.id, movementAuthorisationId: movement.id, gateId: gate.id, direction: "ENTRY", securityOfficerUserId: officer.id });
    await prisma.gateEvent.update({ where: { id: gateEvent!.id }, data: { inspectionTemplateId: tpl.id } });
    await moveToIdentityPending(tenant.id, gateEvent!.id, officer.id);
    await verifyIdentityForGateEvent(tenant.id, gateEvent!.id, officer.id, "normal-capture");
    await beginVehicleChecks(tenant.id, gateEvent!.id, officer.id);

    const tyreItem = tpl.items.find((i) => i.label === "Tyre tread depth")!;
    const { result, exception } = (await recordInspectionResult({
      tenantId: tenant.id,
      gateEventId: gateEvent!.id,
      actorUserId: officer.id,
      inspectionItemId: tyreItem.id,
      outcome: "FAIL",
      readingValue: "1.0",
    }))!;

    expect(result.outcome).toBe("FAIL");
    expect(exception).not.toBeNull();
    expect(exception!.requiresSupervisorApproval).toBe(true);
    expect(exception!.severity).toBe("HIGH");

    const reloaded = await getGateEventInTenant(tenant.id, gateEvent!.id);
    expect(reloaded?.status).toBe("EXCEPTION_RAISED");
  });
});

describe("exception resolution — hard self-approval rule (not tenant-configurable)", () => {
  async function toExceptionRaised() {
    const setup = await baseSetup();
    const movement = await approvedMovement(setup.tenant.id, setup.site.id, setup.vehicle.id, setup.driver.id, setup.requester.id);
    const gateEvent = await startGateEvent({
      tenantId: setup.tenant.id,
      movementAuthorisationId: movement.id,
      gateId: setup.gate.id,
      direction: "ENTRY",
      securityOfficerUserId: setup.officer.id,
    });
    await moveToIdentityPending(setup.tenant.id, gateEvent!.id, setup.officer.id);
    await verifyIdentityForGateEvent(setup.tenant.id, gateEvent!.id, setup.officer.id, "normal-capture");
    await beginVehicleChecks(setup.tenant.id, gateEvent!.id, setup.officer.id);
    const exception = await raiseException({
      tenantId: setup.tenant.id,
      gateEventId: gateEvent!.id,
      actorUserId: setup.officer.id,
      description: "Serious safety concern found during inspection.",
      severity: "HIGH",
      requiresSupervisorApproval: true,
    });
    return { ...setup, gateEvent: gateEvent!, exception: exception! };
  }

  it("rejects the same officer who raised a serious exception from resolving it themselves", async () => {
    const { tenant, officer, exception } = await toExceptionRaised();

    await expect(
      resolveException({ tenantId: tenant.id, exceptionId: exception.id, actorUserId: officer.id, outcomeAction: "SUPERVISOR_APPROVAL" }),
    ).rejects.toBeInstanceOf(SelfApprovalNotAllowedError);
  });

  it("rejects resolving a serious exception before it has been escalated to SUPERVISOR_REVIEW", async () => {
    const { tenant, supervisor, exception } = await toExceptionRaised();

    await expect(
      resolveException({ tenantId: tenant.id, exceptionId: exception.id, actorUserId: supervisor.id, outcomeAction: "SUPERVISOR_APPROVAL" }),
    ).rejects.toBeInstanceOf(ExceptionNotEscalatedError);
  });

  it("allows a different (supervisor) user to resolve after escalation, returning the gate event to VEHICLE_CHECKS_IN_PROGRESS on a continue outcome", async () => {
    const { tenant, supervisor, gateEvent, exception } = await toExceptionRaised();
    await escalateExceptionToSupervisor(tenant.id, gateEvent.id, supervisor.id);

    const outcome = await resolveException({
      tenantId: tenant.id,
      exceptionId: exception.id,
      actorUserId: supervisor.id,
      outcomeAction: "CLEARED_WITH_OBSERVATION",
      resolutionNotes: "Reviewed and acceptable to proceed.",
    });

    expect(outcome?.exception.resolvedByUserId).toBe(supervisor.id);
    expect(outcome?.gateEvent?.status).toBe("VEHICLE_CHECKS_IN_PROGRESS");
  });

  it("denies the gate event on a block outcome (e.g. WORKSHOP_LOCKOUT)", async () => {
    const { tenant, supervisor, gateEvent, exception } = await toExceptionRaised();
    await escalateExceptionToSupervisor(tenant.id, gateEvent.id, supervisor.id);

    const outcome = await resolveException({
      tenantId: tenant.id,
      exceptionId: exception.id,
      actorUserId: supervisor.id,
      outcomeAction: "WORKSHOP_LOCKOUT",
    });

    expect(outcome?.gateEvent?.status).toBe("DENIED");
    expect(outcome?.gateEvent?.decision).toBe("DENIED");
  });

  it("rejects resolving an already-resolved exception", async () => {
    const { tenant, supervisor, gateEvent, exception } = await toExceptionRaised();
    await escalateExceptionToSupervisor(tenant.id, gateEvent.id, supervisor.id);
    await resolveException({ tenantId: tenant.id, exceptionId: exception.id, actorUserId: supervisor.id, outcomeAction: "WARNING" });

    await expect(
      resolveException({ tenantId: tenant.id, exceptionId: exception.id, actorUserId: supervisor.id, outcomeAction: "WARNING" }),
    ).rejects.toBeInstanceOf(ExceptionAlreadyResolvedError);
  });
});

describe("clearance decision and vehicle-lockout defense in depth", () => {
  async function toVehicleChecksInProgress() {
    const setup = await baseSetup();
    const movement = await approvedMovement(setup.tenant.id, setup.site.id, setup.vehicle.id, setup.driver.id, setup.requester.id);
    const gateEvent = await startGateEvent({
      tenantId: setup.tenant.id,
      movementAuthorisationId: movement.id,
      gateId: setup.gate.id,
      direction: "ENTRY",
      securityOfficerUserId: setup.officer.id,
    });
    await moveToIdentityPending(setup.tenant.id, gateEvent!.id, setup.officer.id);
    await verifyIdentityForGateEvent(setup.tenant.id, gateEvent!.id, setup.officer.id, "normal-capture");
    await beginVehicleChecks(setup.tenant.id, gateEvent!.id, setup.officer.id);
    return { ...setup, gateEvent: gateEvent!, movement };
  }

  it("clears the vehicle and moves the linked ENTRY movement to IN_PROGRESS", async () => {
    const { tenant, officer, gateEvent, movement } = await toVehicleChecksInProgress();

    const cleared = await clearGateEvent({ tenantId: tenant.id, gateEventId: gateEvent.id, actorUserId: officer.id, reason: "All checks passed" });
    expect(cleared?.status).toBe("CLEARED");
    expect(cleared?.decision).toBe("CLEARED");

    const reloadedMovement = await prisma.movementAuthorisation.findUnique({ where: { id: movement.id } });
    expect(reloadedMovement?.status).toBe("IN_PROGRESS");
  });

  it("rejects clearing a vehicle that was locked after the gate event started (defense in depth)", async () => {
    const { tenant, officer, gateEvent, vehicle } = await toVehicleChecksInProgress();
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { operationalStatus: "SECURITY_LOCKOUT" } });

    await expect(
      clearGateEvent({ tenantId: tenant.id, gateEventId: gateEvent.id, actorUserId: officer.id }),
    ).rejects.toBeInstanceOf(VehicleNotAvailableError);
  });

  it("denies the vehicle with a required reason", async () => {
    const { tenant, officer, gateEvent } = await toVehicleChecksInProgress();
    const denied = await denyGateEvent({ tenantId: tenant.id, gateEventId: gateEvent.id, actorUserId: officer.id, reason: "Damage found" });
    expect(denied?.status).toBe("DENIED");
    expect(denied?.decisionReason).toBe("Damage found");
  });

  it("rejects an invalid direct transition (e.g. completing a gate event that hasn't been cleared or denied yet)", async () => {
    const { tenant, officer, gateEvent } = await toVehicleChecksInProgress();
    await expect(completeGateEvent(tenant.id, gateEvent.id, officer.id)).rejects.toBeInstanceOf(InvalidGateEventTransitionError);
  });

  it("cancels an in-flight gate event", async () => {
    const { tenant, officer, gateEvent } = await toVehicleChecksInProgress();
    const cancelled = await cancelGateEvent(tenant.id, gateEvent.id, officer.id, "Vehicle departed before inspection completed");
    expect(cancelled?.status).toBe("CANCELLED");
  });
});

describe("findOpenGateEventForMovement", () => {
  it("returns null once the gate event reaches a terminal state", async () => {
    const { tenant, requester, officer, site, gate, driver, vehicle } = await baseSetup();
    const movement = await approvedMovement(tenant.id, site.id, vehicle.id, driver.id, requester.id);
    const gateEvent = await startGateEvent({ tenantId: tenant.id, movementAuthorisationId: movement.id, gateId: gate.id, direction: "ENTRY", securityOfficerUserId: officer.id });
    await cancelGateEvent(tenant.id, gateEvent!.id, officer.id);

    const open = await findOpenGateEventForMovement(tenant.id, movement.id);
    expect(open).toBeNull();
  });
});

// Regression coverage for a real bug found in manual curl testing: these
// precondition-on-current-status checks originally threw a plain `Error`,
// which every calling route's catch block let fall through to a generic 500
// instead of a meaningful 409/404 (see KNOWN_BUGS.md). Asserting the specific
// error class here, not just "rejects", so a future refactor can't silently
// regress back to an untyped throw.
describe("precondition violations surface as typed, catchable errors (not a generic 500)", () => {
  it("verifying identity before reaching IDENTITY_PENDING throws GateEventPreconditionError", async () => {
    const { tenant, requester, officer, site, gate, driver, vehicle } = await baseSetup();
    const movement = await approvedMovement(tenant.id, site.id, vehicle.id, driver.id, requester.id);
    const gateEvent = await startGateEvent({ tenantId: tenant.id, movementAuthorisationId: movement.id, gateId: gate.id, direction: "ENTRY", securityOfficerUserId: officer.id });

    // Still INSPECTION_STARTED — moveToIdentityPending was never called.
    await expect(
      verifyIdentityForGateEvent(tenant.id, gateEvent!.id, officer.id, "normal-capture"),
    ).rejects.toBeInstanceOf(GateEventPreconditionError);
  });

  it("recording an inspection result before VEHICLE_CHECKS_IN_PROGRESS throws GateEventPreconditionError", async () => {
    const { tenant, requester, officer, site, gate, driver, vehicle } = await baseSetup();
    const tpl = await template(tenant.id);
    const movement = await approvedMovement(tenant.id, site.id, vehicle.id, driver.id, requester.id);
    const gateEvent = await startGateEvent({ tenantId: tenant.id, movementAuthorisationId: movement.id, gateId: gate.id, direction: "ENTRY", securityOfficerUserId: officer.id });
    await prisma.gateEvent.update({ where: { id: gateEvent!.id }, data: { inspectionTemplateId: tpl.id } });

    // Still INSPECTION_STARTED — beginVehicleChecks was never called.
    await expect(
      recordInspectionResult({
        tenantId: tenant.id,
        gateEventId: gateEvent!.id,
        inspectionItemId: tpl.items[0].id,
        actorUserId: officer.id,
        outcome: "PASS",
      }),
    ).rejects.toBeInstanceOf(GateEventPreconditionError);
  });

  it("recording a result for an inspection item outside the gate event's template throws InspectionItemNotFoundError", async () => {
    const { tenant, requester, officer, site, gate, driver, vehicle } = await baseSetup();
    const tpl = await template(tenant.id);
    const otherTenant = await createTenant("Other Tenant");
    const otherTpl = await template(otherTenant.id);
    const movement = await approvedMovement(tenant.id, site.id, vehicle.id, driver.id, requester.id);
    const gateEvent = await startGateEvent({ tenantId: tenant.id, movementAuthorisationId: movement.id, gateId: gate.id, direction: "ENTRY", securityOfficerUserId: officer.id });
    await prisma.gateEvent.update({ where: { id: gateEvent!.id }, data: { inspectionTemplateId: tpl.id } });
    await moveToIdentityPending(tenant.id, gateEvent!.id, officer.id);
    await verifyIdentityForGateEvent(tenant.id, gateEvent!.id, officer.id, "normal-capture");
    await beginVehicleChecks(tenant.id, gateEvent!.id, officer.id);

    await expect(
      recordInspectionResult({
        tenantId: tenant.id,
        gateEventId: gateEvent!.id,
        inspectionItemId: otherTpl.items[0].id,
        actorUserId: officer.id,
        outcome: "PASS",
      }),
    ).rejects.toBeInstanceOf(InspectionItemNotFoundError);
  });

  it("resolving an exception on a gate event that isn't awaiting resolution throws GateEventPreconditionError", async () => {
    const { tenant, requester, officer, site, gate, driver, vehicle } = await baseSetup();
    const movement = await approvedMovement(tenant.id, site.id, vehicle.id, driver.id, requester.id);
    const gateEvent = await startGateEvent({ tenantId: tenant.id, movementAuthorisationId: movement.id, gateId: gate.id, direction: "ENTRY", securityOfficerUserId: officer.id });
    await moveToIdentityPending(tenant.id, gateEvent!.id, officer.id);
    await verifyIdentityForGateEvent(tenant.id, gateEvent!.id, officer.id, "normal-capture");
    await beginVehicleChecks(tenant.id, gateEvent!.id, officer.id);

    // Raise a low-severity exception that does NOT require supervisor approval,
    // then resolve it once — the gate event returns to VEHICLE_CHECKS_IN_PROGRESS,
    // so resolving the same exception again must hit the "already resolved"
    // path, not this precondition — use a fresh exception instead to isolate
    // the "gate event not awaiting resolution" branch by resolving on a gate
    // event already back in VEHICLE_CHECKS_IN_PROGRESS with no exceptions open.
    const exception = await raiseException({
      tenantId: tenant.id,
      gateEventId: gateEvent!.id,
      actorUserId: officer.id,
      description: "Minor cosmetic scratch noted",
      severity: "LOW",
      requiresSupervisorApproval: false,
    });
    await resolveException({ tenantId: tenant.id, exceptionId: exception!.id, actorUserId: officer.id, outcomeAction: "WARNING" });

    const secondException = await prisma.exception.create({
      data: { tenantId: tenant.id, gateEventId: gateEvent!.id, description: "orphan test exception", severity: "LOW", requiresSupervisorApproval: false, raisedByUserId: officer.id },
    });
    // Gate event is VEHICLE_CHECKS_IN_PROGRESS (not EXCEPTION_RAISED/SUPERVISOR_REVIEW)
    // because it was never transitioned for this second exception.
    await expect(
      resolveException({ tenantId: tenant.id, exceptionId: secondException.id, actorUserId: officer.id, outcomeAction: "WARNING" }),
    ).rejects.toBeInstanceOf(GateEventPreconditionError);
  });
});

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  startGateEvent,
  moveToIdentityPending,
  verifyIdentityForGateEvent,
  beginVehicleChecks,
  recordInspectionResult,
  resolveException,
  clearGateEvent,
  completeGateEvent,
} from "@/lib/repositories/gate-event-repository";
import { createMovement } from "@/lib/repositories/movement-repository";
import {
  buildReconciliation,
  resolveDiscrepancy,
  getReconciliationInTenant,
  ReconciliationNotReadyError,
  GateEventNotFoundError,
  DuplicateReconciliationPairingError,
  MismatchedMovementPairingError,
  MismatchedVehiclePairingError,
  SameDirectionPairingError,
  SameGateEventPairingError,
  ReversedPairingError,
  GateEventNotCompletedError,
  DiscrepancyAlreadyResolvedError,
} from "@/lib/repositories/reconciliation-repository";
import { createTenant, createRole, createUser, createSite, createGate, createDriver, createVehicle } from "./helpers/fixtures";

async function fullTemplate(tenantId: string) {
  return prisma.inspectionTemplate.create({
    data: {
      tenantId,
      name: `Recon Template ${crypto.randomUUID()}`,
      version: 1,
      isActive: true,
      items: {
        create: [
          { section: "OPERATIONAL_INFO", label: "Odometer reading recorded", sortOrder: 0, responseType: "READING", unit: "km" },
          { section: "OPERATIONAL_INFO", label: "Fuel level recorded", sortOrder: 1, responseType: "READING", unit: "%" },
          { section: "TYRES_WHEELS", label: "Tyre tread depth", sortOrder: 2, responseType: "READING", unit: "mm" },
          { section: "TYRES_WHEELS", label: "Tyre condition", sortOrder: 3, responseType: "CHECK" },
          { section: "EXTERIOR_CONDITION", label: "No new visible body damage", sortOrder: 4, responseType: "CHECK" },
          { section: "LOAD_VERIFICATION", label: "Cargo matches approved cargo summary", sortOrder: 5, responseType: "CHECK" },
        ],
      },
    },
    include: { items: true },
  });
}

type ItemAnswers = Record<string, { outcome: "PASS" | "FAIL"; readingValue?: string }>;

async function runLeg(params: {
  tenantId: string;
  movementId: string;
  gateId: string;
  officerId: string;
  direction: "ENTRY" | "EXIT";
  templateId: string;
  items: { id: string; label: string }[];
  answers: ItemAnswers;
}) {
  const gateEvent = await startGateEvent({
    tenantId: params.tenantId,
    movementAuthorisationId: params.movementId,
    gateId: params.gateId,
    direction: params.direction,
    securityOfficerUserId: params.officerId,
  });
  await prisma.gateEvent.update({ where: { id: gateEvent!.id }, data: { inspectionTemplateId: params.templateId } });
  await moveToIdentityPending(params.tenantId, gateEvent!.id, params.officerId);
  await verifyIdentityForGateEvent(params.tenantId, gateEvent!.id, params.officerId, "normal-capture");
  await beginVehicleChecks(params.tenantId, gateEvent!.id, params.officerId);

  for (const item of params.items) {
    const answer = params.answers[item.label];
    if (!answer) continue;
    const { exception } = (await recordInspectionResult({
      tenantId: params.tenantId,
      gateEventId: gateEvent!.id,
      inspectionItemId: item.id,
      actorUserId: params.officerId,
      outcome: answer.outcome,
      readingValue: answer.readingValue,
    }))!;
    // A FAIL outcome auto-raises an exception and moves the gate event to
    // EXCEPTION_RAISED (gate-event-repository.ts) — none of the template
    // items here are configured to require supervisor approval, so the same
    // officer can resolve it immediately and continue the walk-around,
    // exactly like a real non-serious in-flow exception.
    if (exception) {
      await resolveException({
        tenantId: params.tenantId,
        exceptionId: exception.id,
        actorUserId: params.officerId,
        outcomeAction: "CLEARED_WITH_OBSERVATION",
        resolutionNotes: "Test fixture: continuing walk-around after a recorded FAIL.",
      });
    }
  }

  await clearGateEvent({ tenantId: params.tenantId, gateEventId: gateEvent!.id, actorUserId: params.officerId, reason: "All checks passed" });
  return completeGateEvent(params.tenantId, gateEvent!.id, params.officerId);
}

const BASELINE_ANSWERS: ItemAnswers = {
  "Odometer reading recorded": { outcome: "PASS", readingValue: "1000" },
  "Fuel level recorded": { outcome: "PASS", readingValue: "80" },
  "Tyre tread depth": { outcome: "PASS", readingValue: "8" },
  "Tyre condition": { outcome: "PASS" },
  "No new visible body damage": { outcome: "PASS" },
  "Cargo matches approved cargo summary": { outcome: "PASS" },
};

async function fullSetup() {
  const tenant = await createTenant();
  const role = await createRole(tenant.id);
  const requester = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const officer = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const site = await createSite(tenant.id);
  const gateOut = await createGate(tenant.id, site.id, "Exit Gate");
  const gateIn = await createGate(tenant.id, site.id, "Entry Gate");
  const driver = await createDriver(tenant.id);
  const vehicle = await createVehicle(tenant.id);
  const template = await fullTemplate(tenant.id);

  const movement = await createMovement({
    tenantId: tenant.id,
    siteId: site.id,
    vehicleId: vehicle.id,
    driverId: driver.id,
    movementType: "DELIVERY",
    requesterUserId: requester.id,
  });
  await prisma.movementAuthorisation.update({ where: { id: movement.id }, data: { status: "APPROVED" } });

  return { tenant, requester, officer, site, gateOut, gateIn, driver, vehicle, template, movement };
}

async function reconciledPair(departureAnswers: ItemAnswers = BASELINE_ANSWERS, returnAnswers: ItemAnswers = BASELINE_ANSWERS) {
  const setup = await fullSetup();
  const departure = await runLeg({
    tenantId: setup.tenant.id,
    movementId: setup.movement.id,
    gateId: setup.gateOut.id,
    officerId: setup.officer.id,
    direction: "EXIT",
    templateId: setup.template.id,
    items: setup.template.items,
    answers: departureAnswers,
  });
  const returnEvent = await runLeg({
    tenantId: setup.tenant.id,
    movementId: setup.movement.id,
    gateId: setup.gateIn.id,
    officerId: setup.officer.id,
    direction: "ENTRY",
    templateId: setup.template.id,
    items: setup.template.items,
    answers: returnAnswers,
  });
  return { ...setup, departure: departure!, returnEvent: returnEvent! };
}

describe("buildReconciliation — pairing", () => {
  it("pairs the departure and return gate events for the same movement, even through different authorised gates", async () => {
    const { tenant, movement, departure, returnEvent, gateOut, gateIn } = await reconciledPair();
    expect(gateOut.id).not.toBe(gateIn.id);

    const built = await prisma.reconciliation.findFirstOrThrow({ where: { tenantId: tenant.id, movementAuthorisationId: movement.id } });
    const reconciliation = await getReconciliationInTenant(tenant.id, built.id);
    expect(reconciliation?.departureGateEventId).toBe(departure.id);
    expect(reconciliation?.returnGateEventId).toBe(returnEvent.id);
    expect(reconciliation?.status).toBe("NO_DISCREPANCIES");
  });

  it("auto-builds via completeGateEvent — no explicit buildReconciliation call needed", async () => {
    const { tenant, movement } = await reconciledPair();
    const reconciliation = await prisma.reconciliation.findFirst({ where: { tenantId: tenant.id, movementAuthorisationId: movement.id } });
    expect(reconciliation).not.toBeNull();
  });

  it("rejects building a reconciliation when only a return leg exists (no departure)", async () => {
    const setup = await fullSetup();
    await expect(
      buildReconciliation({ tenantId: setup.tenant.id, movementAuthorisationId: setup.movement.id }),
    ).rejects.toBeInstanceOf(ReconciliationNotReadyError);
  });

  it("rejects re-pairing an already-used return gate event with a different departure (duplicate return)", async () => {
    const setup = await reconciledPair();
    const { tenant, returnEvent } = setup;
    // A second, unrelated movement/departure leg, then attempt to steal the
    // already-paired return event for it. Same tenant/vehicle/driver, a
    // second movement, own departure leg only.
    const secondMovement = await createMovement({
      tenantId: tenant.id,
      siteId: setup.site.id,
      vehicleId: setup.vehicle.id,
      driverId: setup.driver.id,
      movementType: "DELIVERY",
      requesterUserId: setup.requester.id,
    });
    await prisma.movementAuthorisation.update({ where: { id: secondMovement.id }, data: { status: "APPROVED" } });
    const otherDeparture = await runLeg({
      tenantId: tenant.id,
      movementId: secondMovement.id,
      gateId: setup.gateOut.id,
      officerId: setup.officer.id,
      direction: "EXIT",
      templateId: setup.template.id,
      items: setup.template.items,
      answers: BASELINE_ANSWERS,
    });

    await expect(
      buildReconciliation({
        tenantId: tenant.id,
        departureGateEventId: otherDeparture!.id,
        returnGateEventId: returnEvent.id,
      }),
    ).rejects.toBeInstanceOf(DuplicateReconciliationPairingError);
  });

  it("is idempotent: calling buildReconciliation twice for the same movement returns the same row, not a duplicate", async () => {
    const { tenant, movement } = await reconciledPair();
    const first = await buildReconciliation({ tenantId: tenant.id, movementAuthorisationId: movement.id });
    const second = await buildReconciliation({ tenantId: tenant.id, movementAuthorisationId: movement.id });

    expect(second.id).toBe(first.id);
    const count = await prisma.reconciliation.count({ where: { tenantId: tenant.id, movementAuthorisationId: movement.id } });
    expect(count).toBe(1);
  });

  it("rejects pairing two gate events from different movements (incorrect movement)", async () => {
    const setup = await fullSetup();
    const departure = await runLeg({ tenantId: setup.tenant.id, movementId: setup.movement.id, gateId: setup.gateOut.id, officerId: setup.officer.id, direction: "EXIT", templateId: setup.template.id, items: setup.template.items, answers: BASELINE_ANSWERS });

    // A second, unrelated movement (same tenant/vehicle/driver) with its own
    // completed return leg — pairing departure (movement 1) against this
    // return (movement 2) must be rejected even though both are legitimate,
    // real, tenant-scoped gate events.
    const secondMovement = await createMovement({
      tenantId: setup.tenant.id,
      siteId: setup.site.id,
      vehicleId: setup.vehicle.id,
      driverId: setup.driver.id,
      movementType: "DELIVERY",
      requesterUserId: setup.requester.id,
    });
    await prisma.movementAuthorisation.update({ where: { id: secondMovement.id }, data: { status: "APPROVED" } });
    const returnOfSecondMovement = await runLeg({
      tenantId: setup.tenant.id,
      movementId: secondMovement.id,
      gateId: setup.gateIn.id,
      officerId: setup.officer.id,
      direction: "ENTRY",
      templateId: setup.template.id,
      items: setup.template.items,
      answers: BASELINE_ANSWERS,
    });

    await expect(
      buildReconciliation({
        tenantId: setup.tenant.id,
        departureGateEventId: departure!.id,
        returnGateEventId: returnOfSecondMovement!.id,
      }),
    ).rejects.toBeInstanceOf(MismatchedMovementPairingError);
  });

  it("rejects pairing gate events for different vehicles (defense in depth against corrupted data)", async () => {
    const { tenant, movement, departure, returnEvent } = await reconciledPair();
    // completeGateEvent already auto-built a (correct) reconciliation for this
    // pair — remove it so the retry below actually re-runs full validation
    // instead of short-circuiting on the idempotency check.
    await prisma.reconciliation.deleteMany({ where: { tenantId: tenant.id, movementAuthorisationId: movement.id } });
    // Simulate a data-integrity edge case: a GateEvent whose vehicleId no
    // longer matches its own movement's vehicle (cannot happen via the normal
    // startGateEvent path — constructed directly here to prove the defensive
    // check actually fires, independent of the movement-match check).
    const otherVehicle = await createVehicle(tenant.id);
    await prisma.gateEvent.update({ where: { id: departure.id }, data: { vehicleId: otherVehicle.id } });

    await expect(
      buildReconciliation({ tenantId: tenant.id, departureGateEventId: departure.id, returnGateEventId: returnEvent.id }),
    ).rejects.toBeInstanceOf(MismatchedVehiclePairingError);
  });

  it("rejects a reversed pairing (return completed before departure)", async () => {
    const setup = await fullSetup();
    const first = await runLeg({ tenantId: setup.tenant.id, movementId: setup.movement.id, gateId: setup.gateOut.id, officerId: setup.officer.id, direction: "EXIT", templateId: setup.template.id, items: setup.template.items, answers: BASELINE_ANSWERS });
    const second = await runLeg({ tenantId: setup.tenant.id, movementId: setup.movement.id, gateId: setup.gateIn.id, officerId: setup.officer.id, direction: "ENTRY", templateId: setup.template.id, items: setup.template.items, answers: BASELINE_ANSWERS });

    // `first` completed before `second` chronologically — explicitly claim the
    // reverse (pass the later one as departureGateEventId) to prove the check.
    await expect(
      buildReconciliation({ tenantId: setup.tenant.id, departureGateEventId: second!.id, returnGateEventId: first!.id }),
    ).rejects.toBeInstanceOf(ReversedPairingError);
  });

  it("rejects pairing the same gate event with itself", async () => {
    const { tenant, departure } = await reconciledPair();
    await expect(
      buildReconciliation({ tenantId: tenant.id, departureGateEventId: departure.id, returnGateEventId: departure.id }),
    ).rejects.toBeInstanceOf(SameGateEventPairingError);
  });

  it("rejects pairing two same-direction gate events", async () => {
    const setup = await fullSetup();
    const first = await runLeg({ tenantId: setup.tenant.id, movementId: setup.movement.id, gateId: setup.gateOut.id, officerId: setup.officer.id, direction: "EXIT", templateId: setup.template.id, items: setup.template.items, answers: BASELINE_ANSWERS });
    // Cancel and start a second EXIT leg under the same movement to get a
    // second same-direction completed event to pair against.
    const secondMovement = await createMovement({
      tenantId: setup.tenant.id,
      siteId: setup.site.id,
      vehicleId: setup.vehicle.id,
      driverId: setup.driver.id,
      movementType: "DELIVERY",
      requesterUserId: setup.requester.id,
    });
    await prisma.movementAuthorisation.update({ where: { id: secondMovement.id }, data: { status: "APPROVED" } });
    // Force the second movement's leg to share the first movement's id so the
    // "same movement" check passes and only direction differs — done via
    // direct prisma update (data-integrity edge case, same rationale as the
    // vehicle-mismatch test above).
    const secondLeg = await runLeg({ tenantId: setup.tenant.id, movementId: secondMovement.id, gateId: setup.gateOut.id, officerId: setup.officer.id, direction: "EXIT", templateId: setup.template.id, items: setup.template.items, answers: BASELINE_ANSWERS });
    await prisma.gateEvent.update({ where: { id: secondLeg!.id }, data: { movementAuthorisationId: setup.movement.id } });

    await expect(
      buildReconciliation({ tenantId: setup.tenant.id, departureGateEventId: first!.id, returnGateEventId: secondLeg!.id }),
    ).rejects.toBeInstanceOf(SameDirectionPairingError);
  });

  it("rejects pairing a gate event that isn't COMPLETED/CLEARED yet", async () => {
    const setup = await fullSetup();
    const departure = await runLeg({ tenantId: setup.tenant.id, movementId: setup.movement.id, gateId: setup.gateOut.id, officerId: setup.officer.id, direction: "EXIT", templateId: setup.template.id, items: setup.template.items, answers: BASELINE_ANSWERS });

    const inProgressReturn = await startGateEvent({
      tenantId: setup.tenant.id,
      movementAuthorisationId: setup.movement.id,
      gateId: setup.gateIn.id,
      direction: "ENTRY",
      securityOfficerUserId: setup.officer.id,
    });

    await expect(
      buildReconciliation({ tenantId: setup.tenant.id, departureGateEventId: departure!.id, returnGateEventId: inProgressReturn!.id }),
    ).rejects.toBeInstanceOf(GateEventNotCompletedError);
  });
});

describe("cross-tenant isolation", () => {
  it("guessed cross-tenant gate event ids are never found (404-equivalent), never leak another tenant's data", async () => {
    const { departure, returnEvent } = await reconciledPair();
    const otherTenant = await createTenant("Other Tenant");

    await expect(
      buildReconciliation({ tenantId: otherTenant.id, departureGateEventId: departure.id, returnGateEventId: returnEvent.id }),
    ).rejects.toBeInstanceOf(GateEventNotFoundError);
  });

  it("a reconciliation built in Tenant A is invisible from Tenant B", async () => {
    const { tenant, movement } = await reconciledPair();
    const otherTenant = await createTenant("Other Tenant");
    const reconciliation = await prisma.reconciliation.findFirstOrThrow({ where: { tenantId: tenant.id, movementAuthorisationId: movement.id } });

    const fromOtherTenant = await getReconciliationInTenant(otherTenant.id, reconciliation.id);
    expect(fromOtherTenant).toBeNull();
  });
});

describe("discrepancy detection", () => {
  it("produces no discrepancies when departure and return match", async () => {
    const { tenant, movement } = await reconciledPair();
    const reconciliation = await prisma.reconciliation.findFirstOrThrow({ where: { tenantId: tenant.id, movementAuthorisationId: movement.id } });
    expect(reconciliation.status).toBe("NO_DISCREPANCIES");
    const discrepancies = await prisma.reconciliationDiscrepancy.findMany({ where: { reconciliationId: reconciliation.id } });
    expect(discrepancies).toHaveLength(0);
  });

  it("flags a HIGH odometer discrepancy when the return reading is lower than departure", async () => {
    const { tenant, movement } = await reconciledPair(
      { ...BASELINE_ANSWERS, "Odometer reading recorded": { outcome: "PASS", readingValue: "1000" } },
      { ...BASELINE_ANSWERS, "Odometer reading recorded": { outcome: "PASS", readingValue: "900" } },
    );
    const reconciliation = await prisma.reconciliation.findFirstOrThrow({ where: { tenantId: tenant.id, movementAuthorisationId: movement.id }, include: { discrepancies: true } });
    const d = reconciliation.discrepancies.find((x) => x.category === "ODOMETER");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("HIGH");
    expect(reconciliation.status).toBe("OPEN");
  });

  it("flags excess mileage against the movement's expectedDistanceKm", async () => {
    const setup = await fullSetup();
    await prisma.movementAuthorisation.update({ where: { id: setup.movement.id }, data: { expectedDistanceKm: 50 } });
    await runLeg({ tenantId: setup.tenant.id, movementId: setup.movement.id, gateId: setup.gateOut.id, officerId: setup.officer.id, direction: "EXIT", templateId: setup.template.id, items: setup.template.items, answers: { ...BASELINE_ANSWERS, "Odometer reading recorded": { outcome: "PASS", readingValue: "1000" } } });
    await runLeg({ tenantId: setup.tenant.id, movementId: setup.movement.id, gateId: setup.gateIn.id, officerId: setup.officer.id, direction: "ENTRY", templateId: setup.template.id, items: setup.template.items, answers: { ...BASELINE_ANSWERS, "Odometer reading recorded": { outcome: "PASS", readingValue: "1200" } } });

    const reconciliation = await prisma.reconciliation.findFirstOrThrow({ where: { tenantId: setup.tenant.id, movementAuthorisationId: setup.movement.id }, include: { discrepancies: true } });
    expect(reconciliation.kmTravelled).toBe(200);
    const d = reconciliation.discrepancies.find((x) => x.category === "ODOMETER" && x.description.includes("expected trip distance"));
    expect(d).toBeDefined();
  });

  it("flags a fuel discrepancy when fuel level increases with no recorded refuelling", async () => {
    const { tenant, movement } = await reconciledPair(
      { ...BASELINE_ANSWERS, "Fuel level recorded": { outcome: "PASS", readingValue: "40" } },
      { ...BASELINE_ANSWERS, "Fuel level recorded": { outcome: "PASS", readingValue: "90" } },
    );
    const reconciliation = await prisma.reconciliation.findFirstOrThrow({ where: { tenantId: tenant.id, movementAuthorisationId: movement.id }, include: { discrepancies: true } });
    const d = reconciliation.discrepancies.find((x) => x.category === "FUEL");
    expect(d).toBeDefined();
    expect(reconciliation.fuelDeltaPercent).toBe(50);
  });

  it("flags newly recorded vehicle damage found on return", async () => {
    const { tenant, movement } = await reconciledPair(
      BASELINE_ANSWERS,
      { ...BASELINE_ANSWERS, "No new visible body damage": { outcome: "FAIL" } },
    );
    const reconciliation = await prisma.reconciliation.findFirstOrThrow({ where: { tenantId: tenant.id, movementAuthorisationId: movement.id }, include: { discrepancies: true } });
    const d = reconciliation.discrepancies.find((x) => x.category === "VEHICLE_CONDITION");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("HIGH");
    // Significant discrepancy raises a real Exception against the return leg.
    expect(d!.linkedExceptionId).not.toBeNull();
    const exception = await prisma.exception.findUnique({ where: { id: d!.linkedExceptionId! } });
    expect(exception?.gateEventId).toBe(reconciliation.returnGateEventId);
  });

  it("flags a tyre-tread discrepancy when the reading drops significantly", async () => {
    const { tenant, movement } = await reconciledPair(
      { ...BASELINE_ANSWERS, "Tyre tread depth": { outcome: "PASS", readingValue: "8" } },
      { ...BASELINE_ANSWERS, "Tyre tread depth": { outcome: "PASS", readingValue: "5" } },
    );
    const reconciliation = await prisma.reconciliation.findFirstOrThrow({ where: { tenantId: tenant.id, movementAuthorisationId: movement.id }, include: { discrepancies: true } });
    const d = reconciliation.discrepancies.find((x) => x.category === "TYRE_CONDITION");
    expect(d).toBeDefined();
  });

  it("flags a cargo/seal discrepancy when load verification fails on return", async () => {
    const { tenant, movement } = await reconciledPair(
      BASELINE_ANSWERS,
      { ...BASELINE_ANSWERS, "Cargo matches approved cargo summary": { outcome: "FAIL" } },
    );
    const reconciliation = await prisma.reconciliation.findFirstOrThrow({ where: { tenantId: tenant.id, movementAuthorisationId: movement.id }, include: { discrepancies: true } });
    const d = reconciliation.discrepancies.find((x) => x.category === "CARGO_AND_LOAD");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("HIGH");
  });

  it("records an audit event when a reconciliation is built", async () => {
    const { tenant, movement } = await reconciledPair();
    const reconciliation = await prisma.reconciliation.findFirstOrThrow({ where: { tenantId: tenant.id, movementAuthorisationId: movement.id } });
    const auditRow = await prisma.auditLog.findFirst({ where: { tenantId: tenant.id, action: "reconciliation.built", entityId: reconciliation.id } });
    expect(auditRow).not.toBeNull();
  });
});

describe("resolveDiscrepancy — human review, explanation, resolution", () => {
  it("resolves an open discrepancy with a required explanation and records an audit event", async () => {
    const { tenant, movement, officer } = await reconciledPair(
      BASELINE_ANSWERS,
      { ...BASELINE_ANSWERS, "No new visible body damage": { outcome: "FAIL" } },
    );
    const reconciliation = await prisma.reconciliation.findFirstOrThrow({ where: { tenantId: tenant.id, movementAuthorisationId: movement.id }, include: { discrepancies: true } });
    const discrepancy = reconciliation.discrepancies[0];

    const outcome = await resolveDiscrepancy({
      tenantId: tenant.id,
      discrepancyId: discrepancy.id,
      actorUserId: officer.id,
      resolutionNotes: "Confirmed with driver — pre-existing scuff, logged previously, not new damage.",
      correctiveAction: "Updated vehicle condition notes.",
    });

    expect(outcome?.discrepancy.status).toBe("RESOLVED");
    expect(outcome?.reconciliation.status).toBe("RESOLVED");

    const auditRow = await prisma.auditLog.findFirst({ where: { tenantId: tenant.id, action: "reconciliation.discrepancyResolved", entityId: discrepancy.id } });
    expect(auditRow).not.toBeNull();
  });

  it("rejects resolving an already-resolved discrepancy", async () => {
    const { tenant, movement, officer } = await reconciledPair(
      BASELINE_ANSWERS,
      { ...BASELINE_ANSWERS, "No new visible body damage": { outcome: "FAIL" } },
    );
    const reconciliation = await prisma.reconciliation.findFirstOrThrow({ where: { tenantId: tenant.id, movementAuthorisationId: movement.id }, include: { discrepancies: true } });
    const discrepancy = reconciliation.discrepancies[0];
    await resolveDiscrepancy({ tenantId: tenant.id, discrepancyId: discrepancy.id, actorUserId: officer.id, resolutionNotes: "Reviewed." });

    await expect(
      resolveDiscrepancy({ tenantId: tenant.id, discrepancyId: discrepancy.id, actorUserId: officer.id, resolutionNotes: "Reviewed again." }),
    ).rejects.toBeInstanceOf(DiscrepancyAlreadyResolvedError);
  });

  it("keeps the reconciliation OPEN while any discrepancy remains unresolved", async () => {
    const { tenant, movement, officer } = await reconciledPair(
      { ...BASELINE_ANSWERS, "Odometer reading recorded": { outcome: "PASS", readingValue: "1000" } },
      {
        ...BASELINE_ANSWERS,
        "Odometer reading recorded": { outcome: "PASS", readingValue: "900" },
        "No new visible body damage": { outcome: "FAIL" },
      },
    );
    const reconciliation = await prisma.reconciliation.findFirstOrThrow({ where: { tenantId: tenant.id, movementAuthorisationId: movement.id }, include: { discrepancies: true } });
    expect(reconciliation.discrepancies.length).toBeGreaterThanOrEqual(2);

    const outcome = await resolveDiscrepancy({
      tenantId: tenant.id,
      discrepancyId: reconciliation.discrepancies[0].id,
      actorUserId: officer.id,
      resolutionNotes: "Reviewed first item.",
    });
    expect(outcome?.reconciliation.status).toBe("OPEN");
  });
});

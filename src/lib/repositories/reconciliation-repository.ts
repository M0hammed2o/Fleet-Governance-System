import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { recordAudit } from "@/lib/audit/record-audit";
import { computeReconciliationDiscrepancies } from "@/lib/reconciliation/discrepancy-engine";
import type { Prisma } from "@/generated/prisma/client";

export class MovementNotFoundError extends Error {
  constructor() {
    super("Movement authorisation not found.");
    this.name = "MovementNotFoundError";
  }
}
export class GateEventNotFoundError extends Error {
  constructor(which: "departure" | "return") {
    super(`The specified ${which} gate event was not found.`);
    this.name = "GateEventNotFoundError";
  }
}
export class ReconciliationNotReadyError extends Error {
  constructor() {
    super("This movement does not yet have both a completed, cleared departure and return gate event to reconcile.");
    this.name = "ReconciliationNotReadyError";
  }
}
export class GateEventNotCompletedError extends Error {
  constructor(which: "departure" | "return") {
    super(`The ${which} gate event must be COMPLETED and CLEARED before it can be reconciled.`);
    this.name = "GateEventNotCompletedError";
  }
}
export class SameGateEventPairingError extends Error {
  constructor() {
    super("The departure and return gate event cannot be the same event.");
    this.name = "SameGateEventPairingError";
  }
}
export class SameDirectionPairingError extends Error {
  constructor() {
    super("The departure and return gate event must be in opposite directions (one entry, one exit).");
    this.name = "SameDirectionPairingError";
  }
}
export class ReversedPairingError extends Error {
  constructor() {
    super("The specified return gate event was completed before the specified departure gate event.");
    this.name = "ReversedPairingError";
  }
}
export class MismatchedMovementPairingError extends Error {
  constructor() {
    super("The departure and return gate event belong to different movement authorisations.");
    this.name = "MismatchedMovementPairingError";
  }
}
export class MismatchedVehiclePairingError extends Error {
  constructor() {
    super("The departure and return gate event belong to different vehicles.");
    this.name = "MismatchedVehiclePairingError";
  }
}
export class DuplicateReconciliationPairingError extends Error {
  constructor() {
    super("One of these gate events is already paired with a different reconciliation.");
    this.name = "DuplicateReconciliationPairingError";
  }
}
export class DiscrepancyAlreadyResolvedError extends Error {
  constructor() {
    super("This discrepancy has already been resolved.");
    this.name = "DiscrepancyAlreadyResolvedError";
  }
}

const RECONCILIATION_INCLUDE = {
  movementAuthorisation: { include: { vehicle: true, driver: true, site: true, requester: true, approver: true } },
  departureGateEvent: {
    include: {
      gate: true,
      securityOfficer: true,
      inspectionResults: { include: { inspectionItem: true, evidenceMediaAsset: true }, orderBy: [{ inspectionItem: { section: "asc" } }] },
      exceptions: true,
    },
  },
  returnGateEvent: {
    include: {
      gate: true,
      securityOfficer: true,
      inspectionResults: { include: { inspectionItem: true, evidenceMediaAsset: true }, orderBy: [{ inspectionItem: { section: "asc" } }] },
      exceptions: true,
    },
  },
  discrepancies: { include: { inspectionItem: true, linkedException: true, resolvedBy: true }, orderBy: { createdAt: "asc" as const } },
  builtBy: true,
} satisfies Prisma.ReconciliationInclude;

interface CandidatePair {
  departure: Awaited<ReturnType<typeof prisma.gateEvent.findFirstOrThrow>>;
  returnEvent: Awaited<ReturnType<typeof prisma.gateEvent.findFirstOrThrow>>;
}

async function resolveCandidatePair(
  tenantId: string,
  input: Pick<BuildReconciliationInput, "movementAuthorisationId" | "departureGateEventId" | "returnGateEventId">,
): Promise<CandidatePair> {
  if (input.departureGateEventId || input.returnGateEventId) {
    if (!input.departureGateEventId || !input.returnGateEventId) {
      throw new GateEventNotFoundError(input.departureGateEventId ? "return" : "departure");
    }
    const [departure, returnEvent] = await Promise.all([
      prisma.gateEvent.findFirst({ where: tenantWhere(tenantId, { id: input.departureGateEventId }) }),
      prisma.gateEvent.findFirst({ where: tenantWhere(tenantId, { id: input.returnGateEventId }) }),
    ]);
    if (!departure) throw new GateEventNotFoundError("departure");
    if (!returnEvent) throw new GateEventNotFoundError("return");
    return { departure, returnEvent };
  }

  if (!input.movementAuthorisationId) throw new MovementNotFoundError();
  const movement = await prisma.movementAuthorisation.findFirst({
    where: tenantWhere(tenantId, { id: input.movementAuthorisationId }),
  });
  if (!movement) throw new MovementNotFoundError();

  const completedEvents = await prisma.gateEvent.findMany({
    where: tenantWhere(tenantId, {
      movementAuthorisationId: movement.id,
      status: "COMPLETED",
      decision: "CLEARED",
    } satisfies Prisma.GateEventWhereInput),
    orderBy: { completedAt: "asc" },
  });
  if (completedEvents.length === 0) throw new ReconciliationNotReadyError();

  const departure = completedEvents[0];
  const returnEvent = completedEvents.slice(1).find((event) => event.direction !== departure.direction);
  if (!returnEvent) throw new ReconciliationNotReadyError();

  return { departure, returnEvent };
}

function assertValidPair(departure: CandidatePair["departure"], returnEvent: CandidatePair["returnEvent"]): void {
  if (departure.id === returnEvent.id) throw new SameGateEventPairingError();
  if (departure.status !== "COMPLETED" || departure.decision !== "CLEARED") throw new GateEventNotCompletedError("departure");
  if (returnEvent.status !== "COMPLETED" || returnEvent.decision !== "CLEARED") throw new GateEventNotCompletedError("return");
  if (departure.movementAuthorisationId !== returnEvent.movementAuthorisationId) throw new MismatchedMovementPairingError();
  if (departure.vehicleId !== returnEvent.vehicleId) throw new MismatchedVehiclePairingError();
  if (departure.direction === returnEvent.direction) throw new SameDirectionPairingError();
  if (!departure.completedAt || !returnEvent.completedAt || departure.completedAt > returnEvent.completedAt) {
    throw new ReversedPairingError();
  }
}

export interface BuildReconciliationInput {
  tenantId: string;
  movementAuthorisationId?: string;
  departureGateEventId?: string;
  returnGateEventId?: string;
  actorUserId?: string | null;
}

/**
 * Pairs a departure and return GateEvent for one movement, compares their
 * recorded readings, and persists the result (RECON-001). Idempotent: a
 * repeat call with the same movement (or the same explicit pair) returns the
 * existing Reconciliation unchanged rather than erroring or duplicating —
 * safe to call from both the automatic completeGateEvent hook and a manual
 * "retry pairing" action.
 */
export async function buildReconciliation(input: BuildReconciliationInput) {
  const { departure, returnEvent } = await resolveCandidatePair(input.tenantId, input);

  // A malformed request (same event given as both legs) is a more
  // fundamental input error than "already paired" — checked before the
  // idempotency lookups below so it can never be masked by them.
  if (departure.id === returnEvent.id) throw new SameGateEventPairingError();

  const existingByDeparture = await prisma.reconciliation.findFirst({
    where: tenantWhere(input.tenantId, { departureGateEventId: departure.id }),
  });
  const existingByReturn = await prisma.reconciliation.findFirst({
    where: tenantWhere(input.tenantId, { returnGateEventId: returnEvent.id }),
  });
  if (existingByDeparture && existingByDeparture.returnGateEventId === returnEvent.id) {
    return prisma.reconciliation.findUniqueOrThrow({ where: { id: existingByDeparture.id }, include: RECONCILIATION_INCLUDE });
  }
  if (existingByDeparture || existingByReturn) throw new DuplicateReconciliationPairingError();

  assertValidPair(departure, returnEvent);

  const movement = await prisma.movementAuthorisation.findUniqueOrThrow({ where: { id: departure.movementAuthorisationId } });

  const [departureItems, returnItems] = await Promise.all([
    prisma.gateEventInspectionItem.findMany({ where: { gateEventId: departure.id }, include: { inspectionItem: true } }),
    prisma.gateEventInspectionItem.findMany({ where: { gateEventId: returnEvent.id }, include: { inspectionItem: true } }),
  ]);

  const computed = computeReconciliationDiscrepancies({
    departureItems: departureItems.map((r) => ({
      inspectionItemId: r.inspectionItemId,
      section: r.inspectionItem.section,
      label: r.inspectionItem.label,
      responseType: r.inspectionItem.responseType,
      unit: r.inspectionItem.unit,
      outcome: r.outcome,
      readingValue: r.readingValue,
    })),
    returnItems: returnItems.map((r) => ({
      inspectionItemId: r.inspectionItemId,
      section: r.inspectionItem.section,
      label: r.inspectionItem.label,
      responseType: r.inspectionItem.responseType,
      unit: r.inspectionItem.unit,
      outcome: r.outcome,
      readingValue: r.readingValue,
    })),
    expectedDistanceKm: movement.expectedDistanceKm,
  });

  const status = computed.discrepancies.length === 0 ? "NO_DISCREPANCIES" : "OPEN";

  let reconciliation;
  try {
    // P11-000 (DECISIONS.md D-038): discrepancies are created via a
    // separate, explicit createMany() rather than a nested
    // `discrepancies: { create: [...] }` write — see the same pattern's
    // rationale in invoice-repository.ts.
    reconciliation = await prisma.$transaction(async (tx) => {
      const created = await tx.reconciliation.create({
        data: {
          tenantId: input.tenantId,
          movementAuthorisationId: movement.id,
          departureGateEventId: departure.id,
          returnGateEventId: returnEvent.id,
          departureOdometer: computed.departureOdometer != null ? Math.round(computed.departureOdometer) : null,
          returnOdometer: computed.returnOdometer != null ? Math.round(computed.returnOdometer) : null,
          kmTravelled: computed.kmTravelled != null ? Math.round(computed.kmTravelled) : null,
          departureFuelPercent: computed.departureFuelPercent,
          returnFuelPercent: computed.returnFuelPercent,
          fuelDeltaPercent: computed.fuelDeltaPercent,
          status,
          builtByUserId: input.actorUserId ?? null,
        },
      });
      if (computed.discrepancies.length > 0) {
        await tx.reconciliationDiscrepancy.createMany({
          data: computed.discrepancies.map((d) => ({
            reconciliationId: created.id,
            tenantId: input.tenantId,
            category: d.category,
            severity: d.severity,
            description: d.description,
            departureValue: d.departureValue,
            returnValue: d.returnValue,
            deltaValue: d.deltaValue,
            inspectionItemId: d.inspectionItemId,
          })),
        });
      }
      return tx.reconciliation.findUniqueOrThrow({ where: { id: created.id }, include: RECONCILIATION_INCLUDE });
    });
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002") {
      throw new DuplicateReconciliationPairingError();
    }
    throw err;
  }

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.actorUserId ?? null,
    action: "reconciliation.built",
    entityType: "Reconciliation",
    entityId: reconciliation.id,
    afterValue: {
      movementAuthorisationId: movement.id,
      departureGateEventId: departure.id,
      returnGateEventId: returnEvent.id,
      discrepancyCount: computed.discrepancies.length,
      status,
    },
  });

  // RECON-002: significant (HIGH) discrepancies raise a real Phase 3
  // Exception against the return gate event — never a parallel mechanism.
  // Created directly (not via gate-event-repository's raiseException, which
  // would also attempt a GateEvent state transition — meaningless here since
  // both legs are already COMPLETED/terminal, and importing it would create a
  // circular module dependency between the two repositories). Best-effort per
  // discrepancy: one failing to raise its Exception must not roll back the
  // reconciliation record itself (same non-transactional, sequential-write
  // style used elsewhere, e.g. recordInspectionResult's own exception raising).
  for (const discrepancy of reconciliation.discrepancies) {
    if (discrepancy.severity !== "HIGH") continue;
    const exception = await prisma.exception.create({
      data: {
        tenantId: input.tenantId,
        gateEventId: returnEvent.id,
        description: discrepancy.description,
        severity: "HIGH",
        requiresSupervisorApproval: true,
        raisedByUserId: input.actorUserId ?? returnEvent.securityOfficerUserId,
      },
    });
    await recordAudit({
      tenantId: input.tenantId,
      userId: input.actorUserId ?? null,
      action: "gateEvent.exceptionRaised",
      entityType: "Exception",
      entityId: exception.id,
      afterValue: { severity: "HIGH", requiresSupervisorApproval: true, description: discrepancy.description, source: "reconciliation" },
    });
    await prisma.reconciliationDiscrepancy.update({ where: { id: discrepancy.id }, data: { linkedExceptionId: exception.id } });
  }

  return prisma.reconciliation.findUniqueOrThrow({ where: { id: reconciliation.id }, include: RECONCILIATION_INCLUDE });
}

export interface ResolveDiscrepancyInput {
  tenantId: string;
  discrepancyId: string;
  actorUserId: string;
  resolutionNotes: string;
  correctiveAction?: string | null;
}

/** Human review/explanation/resolution step (RECON-002) — never automatic. */
export async function resolveDiscrepancy(input: ResolveDiscrepancyInput) {
  const discrepancy = await prisma.reconciliationDiscrepancy.findFirst({
    where: tenantWhere(input.tenantId, { id: input.discrepancyId }),
  });
  if (!discrepancy) return null;
  if (discrepancy.status === "RESOLVED") throw new DiscrepancyAlreadyResolvedError();

  const updated = await prisma.reconciliationDiscrepancy.update({
    where: { id: discrepancy.id },
    data: {
      status: "RESOLVED",
      resolvedByUserId: input.actorUserId,
      resolvedAt: new Date(),
      resolutionNotes: input.resolutionNotes,
      correctiveAction: input.correctiveAction ?? null,
    },
  });

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    action: "reconciliation.discrepancyResolved",
    entityType: "ReconciliationDiscrepancy",
    entityId: discrepancy.id,
    beforeValue: { status: "OPEN" },
    afterValue: { status: "RESOLVED", resolutionNotes: input.resolutionNotes },
  });

  const remainingOpen = await prisma.reconciliationDiscrepancy.count({
    where: { reconciliationId: discrepancy.reconciliationId, status: "OPEN" },
  });
  const reconciliation = await prisma.reconciliation.update({
    where: { id: discrepancy.reconciliationId },
    data: { status: remainingOpen === 0 ? "RESOLVED" : "OPEN" },
    include: RECONCILIATION_INCLUDE,
  });

  return { discrepancy: updated, reconciliation };
}

export interface ListReconciliationsOptions {
  status?: "NO_DISCREPANCIES" | "OPEN" | "RESOLVED";
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 25;

export async function listReconciliationsInTenant(tenantId: string, options: ListReconciliationsOptions = {}) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE));
  const where = tenantWhere(tenantId, options.status ? { status: options.status } : {});

  const [items, total] = await Promise.all([
    prisma.reconciliation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        movementAuthorisation: { include: { vehicle: true, driver: true } },
        discrepancies: { select: { id: true, status: true, severity: true } },
      },
    }),
    prisma.reconciliation.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function getReconciliationInTenant(tenantId: string, id: string) {
  return prisma.reconciliation.findFirst({ where: tenantWhere(tenantId, { id }), include: RECONCILIATION_INCLUDE });
}

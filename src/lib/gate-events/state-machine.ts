export type GateEventStatus =
  | "EXPECTED"
  | "INSPECTION_STARTED"
  | "IDENTITY_PENDING"
  | "IDENTITY_VERIFIED"
  | "VEHICLE_CHECKS_IN_PROGRESS"
  | "EXCEPTION_RAISED"
  | "SUPERVISOR_REVIEW"
  | "CLEARED"
  | "DENIED"
  | "CANCELLED"
  | "COMPLETED";

/**
 * Pure transition table — no DB, fully unit-testable. Same "single source of
 * truth for is this state change allowed" pattern as
 * lib/movements/state-machine.ts. Models a vehicle's actual presence/
 * processing at the gate, distinct from MovementAuthorisation's own
 * pre-gate approval state machine.
 *
 * Happy path: EXPECTED -> INSPECTION_STARTED -> IDENTITY_PENDING ->
 * IDENTITY_VERIFIED -> VEHICLE_CHECKS_IN_PROGRESS -> CLEARED -> COMPLETED.
 *
 * EXCEPTION_RAISED can resolve itself back to VEHICLE_CHECKS_IN_PROGRESS
 * (a non-serious exception the officer resolves directly) or escalate to
 * SUPERVISOR_REVIEW (a serious exception requiring supervisor approval —
 * see gate-event-repository.ts / DECISIONS.md self-approval rule).
 * SUPERVISOR_REVIEW resolves back to VEHICLE_CHECKS_IN_PROGRESS (cleared to
 * continue) or terminates the event at DENIED.
 *
 * CLEARED/DENIED are decision states, not terminal by themselves — both must
 * still reach COMPLETED (the record-closing step) or CANCELLED never applies
 * to them since a decision has already been made. CANCELLED is reachable
 * from every non-terminal, non-decided state (an officer can abandon a gate
 * event before a clearance decision is made).
 */
const VALID_TRANSITIONS: Record<GateEventStatus, GateEventStatus[]> = {
  EXPECTED: ["INSPECTION_STARTED", "CANCELLED"],
  INSPECTION_STARTED: ["IDENTITY_PENDING", "CANCELLED"],
  IDENTITY_PENDING: ["IDENTITY_VERIFIED", "EXCEPTION_RAISED", "CANCELLED"],
  IDENTITY_VERIFIED: ["VEHICLE_CHECKS_IN_PROGRESS", "CANCELLED"],
  VEHICLE_CHECKS_IN_PROGRESS: ["EXCEPTION_RAISED", "CLEARED", "DENIED", "CANCELLED"],
  EXCEPTION_RAISED: ["SUPERVISOR_REVIEW", "VEHICLE_CHECKS_IN_PROGRESS", "CANCELLED"],
  SUPERVISOR_REVIEW: ["VEHICLE_CHECKS_IN_PROGRESS", "CLEARED", "DENIED", "CANCELLED"],
  CLEARED: ["COMPLETED"],
  DENIED: ["COMPLETED"],
  CANCELLED: [],
  COMPLETED: [],
};

export function isValidGateEventTransition(from: GateEventStatus, to: GateEventStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidNextGateEventStates(from: GateEventStatus): GateEventStatus[] {
  return VALID_TRANSITIONS[from] ?? [];
}

export class InvalidGateEventTransitionError extends Error {
  constructor(from: GateEventStatus, to: GateEventStatus) {
    super(`Cannot move a gate event from ${from} to ${to}.`);
    this.name = "InvalidGateEventTransitionError";
  }
}

export function assertValidGateEventTransition(from: GateEventStatus, to: GateEventStatus): void {
  if (!isValidGateEventTransition(from, to)) {
    throw new InvalidGateEventTransitionError(from, to);
  }
}

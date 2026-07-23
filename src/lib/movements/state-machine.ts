export type MovementStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED"
  | "IN_PROGRESS"
  | "COMPLETED";

/**
 * Pure transition table — no DB, fully unit-testable. This is the single
 * source of truth for "is this state change allowed"; every mutation in
 * movement-repository.ts checks it before writing, and the server is the
 * only enforcement point (build brief: "Reject invalid state transitions on
 * the server").
 */
const VALID_TRANSITIONS: Record<MovementStatus, MovementStatus[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["IN_PROGRESS", "CANCELLED", "EXPIRED"],
  REJECTED: [],
  CANCELLED: [],
  EXPIRED: [],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
};

export function isValidMovementTransition(from: MovementStatus, to: MovementStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidNextMovementStates(from: MovementStatus): MovementStatus[] {
  return VALID_TRANSITIONS[from] ?? [];
}

export class InvalidMovementTransitionError extends Error {
  constructor(from: MovementStatus, to: MovementStatus) {
    super(`Cannot move a movement authorisation from ${from} to ${to}.`);
    this.name = "InvalidMovementTransitionError";
  }
}

export function assertValidMovementTransition(from: MovementStatus, to: MovementStatus): void {
  if (!isValidMovementTransition(from, to)) {
    throw new InvalidMovementTransitionError(from, to);
  }
}

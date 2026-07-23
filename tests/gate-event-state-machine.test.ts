import { describe, it, expect } from "vitest";
import {
  isValidGateEventTransition,
  getValidNextGateEventStates,
  assertValidGateEventTransition,
  InvalidGateEventTransitionError,
  type GateEventStatus,
} from "@/lib/gate-events/state-machine";

const ALL_STATES: GateEventStatus[] = [
  "EXPECTED",
  "INSPECTION_STARTED",
  "IDENTITY_PENDING",
  "IDENTITY_VERIFIED",
  "VEHICLE_CHECKS_IN_PROGRESS",
  "EXCEPTION_RAISED",
  "SUPERVISOR_REVIEW",
  "CLEARED",
  "DENIED",
  "CANCELLED",
  "COMPLETED",
];

// Independently declared expectation table (not the implementation's own
// table) so the "every state x every state" sweep below is a real assertion,
// not a tautology against the module under test.
const EXPECTED_VALID: Record<GateEventStatus, GateEventStatus[]> = {
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

describe("gate event state machine — full state x state matrix", () => {
  for (const from of ALL_STATES) {
    for (const to of ALL_STATES) {
      const shouldBeValid = EXPECTED_VALID[from].includes(to);
      it(`${from} -> ${to} is ${shouldBeValid ? "allowed" : "rejected"}`, () => {
        expect(isValidGateEventTransition(from, to)).toBe(shouldBeValid);
      });
    }
  }

  it("getValidNextGateEventStates matches the expectation table for every state", () => {
    for (const from of ALL_STATES) {
      expect(getValidNextGateEventStates(from).sort()).toEqual([...EXPECTED_VALID[from]].sort());
    }
  });
});

describe("gate event state machine — documented flows", () => {
  it("allows the happy path: EXPECTED -> INSPECTION_STARTED -> IDENTITY_PENDING -> IDENTITY_VERIFIED -> VEHICLE_CHECKS_IN_PROGRESS -> CLEARED -> COMPLETED", () => {
    expect(isValidGateEventTransition("EXPECTED", "INSPECTION_STARTED")).toBe(true);
    expect(isValidGateEventTransition("INSPECTION_STARTED", "IDENTITY_PENDING")).toBe(true);
    expect(isValidGateEventTransition("IDENTITY_PENDING", "IDENTITY_VERIFIED")).toBe(true);
    expect(isValidGateEventTransition("IDENTITY_VERIFIED", "VEHICLE_CHECKS_IN_PROGRESS")).toBe(true);
    expect(isValidGateEventTransition("VEHICLE_CHECKS_IN_PROGRESS", "CLEARED")).toBe(true);
    expect(isValidGateEventTransition("CLEARED", "COMPLETED")).toBe(true);
  });

  it("allows a denial path via VEHICLE_CHECKS_IN_PROGRESS -> DENIED -> COMPLETED", () => {
    expect(isValidGateEventTransition("VEHICLE_CHECKS_IN_PROGRESS", "DENIED")).toBe(true);
    expect(isValidGateEventTransition("DENIED", "COMPLETED")).toBe(true);
  });

  it("allows an exception escalation path: VEHICLE_CHECKS_IN_PROGRESS -> EXCEPTION_RAISED -> SUPERVISOR_REVIEW -> DENIED", () => {
    expect(isValidGateEventTransition("VEHICLE_CHECKS_IN_PROGRESS", "EXCEPTION_RAISED")).toBe(true);
    expect(isValidGateEventTransition("EXCEPTION_RAISED", "SUPERVISOR_REVIEW")).toBe(true);
    expect(isValidGateEventTransition("SUPERVISOR_REVIEW", "DENIED")).toBe(true);
  });

  it("allows a non-serious exception to resolve directly back to checks without supervisor review", () => {
    expect(isValidGateEventTransition("EXCEPTION_RAISED", "VEHICLE_CHECKS_IN_PROGRESS")).toBe(true);
  });

  it("allows cancellation from every in-flight (non-terminal, non-decided) state", () => {
    const cancellable: GateEventStatus[] = [
      "EXPECTED",
      "INSPECTION_STARTED",
      "IDENTITY_PENDING",
      "IDENTITY_VERIFIED",
      "VEHICLE_CHECKS_IN_PROGRESS",
      "EXCEPTION_RAISED",
      "SUPERVISOR_REVIEW",
    ];
    for (const from of cancellable) {
      expect(isValidGateEventTransition(from, "CANCELLED")).toBe(true);
    }
  });

  it("rejects every transition out of a terminal state (CANCELLED, COMPLETED)", () => {
    for (const from of ["CANCELLED", "COMPLETED"] as GateEventStatus[]) {
      for (const to of ALL_STATES) {
        expect(isValidGateEventTransition(from, to)).toBe(false);
      }
      expect(getValidNextGateEventStates(from)).toEqual([]);
    }
  });

  it("rejects skipping straight from EXPECTED to VEHICLE_CHECKS_IN_PROGRESS", () => {
    expect(isValidGateEventTransition("EXPECTED", "VEHICLE_CHECKS_IN_PROGRESS")).toBe(false);
  });

  it("rejects moving backwards from IDENTITY_VERIFIED to IDENTITY_PENDING", () => {
    expect(isValidGateEventTransition("IDENTITY_VERIFIED", "IDENTITY_PENDING")).toBe(false);
  });

  it("rejects re-clearing an already-cleared gate event", () => {
    expect(isValidGateEventTransition("CLEARED", "CLEARED")).toBe(false);
  });

  it("rejects a CLEARED event being changed to DENIED directly", () => {
    expect(isValidGateEventTransition("CLEARED", "DENIED")).toBe(false);
  });

  it("assertValidGateEventTransition throws InvalidGateEventTransitionError for a disallowed move", () => {
    expect(() => assertValidGateEventTransition("COMPLETED", "CLEARED")).toThrow(InvalidGateEventTransitionError);
  });

  it("assertValidGateEventTransition does not throw for an allowed move", () => {
    expect(() => assertValidGateEventTransition("EXPECTED", "INSPECTION_STARTED")).not.toThrow();
  });
});

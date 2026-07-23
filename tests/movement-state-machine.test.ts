import { describe, it, expect } from "vitest";
import {
  isValidMovementTransition,
  getValidNextMovementStates,
  assertValidMovementTransition,
  InvalidMovementTransitionError,
  type MovementStatus,
} from "@/lib/movements/state-machine";

const ALL_STATES: MovementStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
  "IN_PROGRESS",
  "COMPLETED",
];

describe("movement state machine", () => {
  it("allows the documented happy path: DRAFT -> SUBMITTED -> APPROVED -> IN_PROGRESS -> COMPLETED", () => {
    expect(isValidMovementTransition("DRAFT", "SUBMITTED")).toBe(true);
    expect(isValidMovementTransition("SUBMITTED", "APPROVED")).toBe(true);
    expect(isValidMovementTransition("APPROVED", "IN_PROGRESS")).toBe(true);
    expect(isValidMovementTransition("IN_PROGRESS", "COMPLETED")).toBe(true);
  });

  it("allows rejection and cancellation from the appropriate states", () => {
    expect(isValidMovementTransition("SUBMITTED", "REJECTED")).toBe(true);
    expect(isValidMovementTransition("DRAFT", "CANCELLED")).toBe(true);
    expect(isValidMovementTransition("SUBMITTED", "CANCELLED")).toBe(true);
    expect(isValidMovementTransition("APPROVED", "CANCELLED")).toBe(true);
    expect(isValidMovementTransition("IN_PROGRESS", "CANCELLED")).toBe(true);
  });

  it("allows an approved-but-unstarted movement to expire", () => {
    expect(isValidMovementTransition("APPROVED", "EXPIRED")).toBe(true);
  });

  it("rejects every transition out of a terminal state", () => {
    const terminalStates: MovementStatus[] = ["REJECTED", "CANCELLED", "EXPIRED", "COMPLETED"];
    for (const from of terminalStates) {
      for (const to of ALL_STATES) {
        expect(isValidMovementTransition(from, to)).toBe(false);
      }
      expect(getValidNextMovementStates(from)).toEqual([]);
    }
  });

  it("rejects skipping straight from DRAFT to APPROVED", () => {
    expect(isValidMovementTransition("DRAFT", "APPROVED")).toBe(false);
  });

  it("rejects moving backwards from APPROVED to SUBMITTED", () => {
    expect(isValidMovementTransition("APPROVED", "SUBMITTED")).toBe(false);
  });

  it("rejects re-approving an already-approved movement", () => {
    expect(isValidMovementTransition("APPROVED", "APPROVED")).toBe(false);
  });

  it("assertValidMovementTransition throws InvalidMovementTransitionError for a disallowed move", () => {
    expect(() => assertValidMovementTransition("REJECTED", "APPROVED")).toThrow(InvalidMovementTransitionError);
  });

  it("assertValidMovementTransition does not throw for an allowed move", () => {
    expect(() => assertValidMovementTransition("DRAFT", "SUBMITTED")).not.toThrow();
  });
});

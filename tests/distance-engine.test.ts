import { describe, it, expect } from "vitest";
import {
  startOfDayInTimeZone,
  startOfWeekInTimeZone,
  startOfMonthInTimeZone,
  computeDistanceSoFar,
  type OdometerReading,
} from "@/lib/telematics/distance-engine";

const SAST = "Africa/Johannesburg"; // UTC+2, no DST

describe("timezone window boundaries (pure)", () => {
  it("startOfDayInTimeZone finds local midnight even when that crosses the UTC calendar day", () => {
    // 2026-07-28T01:30 SAST is 2026-07-27T23:30Z — local midnight for that
    // instant is 2026-07-27T22:00Z (2026-07-28T00:00 SAST).
    const at = new Date("2026-07-27T23:30:00Z");
    const start = startOfDayInTimeZone(at, SAST);
    expect(start.toISOString()).toBe("2026-07-27T22:00:00.000Z");
  });

  it("startOfWeekInTimeZone finds the most recent Sunday midnight, local time", () => {
    // 2026-07-29 is a Wednesday; the preceding Sunday is 2026-07-26.
    const wednesday = new Date("2026-07-29T10:00:00Z"); // 12:00 SAST
    const start = startOfWeekInTimeZone(wednesday, SAST);
    expect(start.toISOString()).toBe("2026-07-25T22:00:00.000Z"); // 2026-07-26T00:00 SAST
  });

  it("startOfMonthInTimeZone finds the 1st of the local calendar month at local midnight", () => {
    const at = new Date("2026-07-15T10:00:00Z");
    const start = startOfMonthInTimeZone(at, SAST);
    expect(start.toISOString()).toBe("2026-06-30T22:00:00.000Z"); // 2026-07-01T00:00 SAST
  });
});

describe("computeDistanceSoFar (pure)", () => {
  const at = new Date("2026-07-29T10:00:00Z"); // Wednesday, 12:00 SAST

  it("returns null for every window when there are no readings at all", () => {
    const result = computeDistanceSoFar({ readings: [], at, timezone: SAST });
    expect(result).toEqual({ trip: null, day: null, week: null, month: null });
  });

  it("returns null (not zero) when no reading exists before the window start", () => {
    const readings: OdometerReading[] = [{ recordedAt: at, odometerKm: 100, ignitionOn: true }];
    const result = computeDistanceSoFar({ readings, at, timezone: SAST });
    // Only one reading, exactly at `at` — no earlier baseline for day/week/month.
    expect(result.day).toBeNull();
    expect(result.week).toBeNull();
    expect(result.month).toBeNull();
  });

  it("computes daily distance as the delta since local midnight", () => {
    const midnightSAST = startOfDayInTimeZone(at, SAST);
    const readings: OdometerReading[] = [
      { recordedAt: new Date(midnightSAST.getTime() - 60 * 60 * 1000), odometerKm: 1000, ignitionOn: true }, // before today
      { recordedAt: new Date(midnightSAST.getTime() + 60 * 60 * 1000), odometerKm: 1050, ignitionOn: true },
      { recordedAt: at, odometerKm: 1120, ignitionOn: true },
    ];
    const result = computeDistanceSoFar({ readings, at, timezone: SAST });
    expect(result.day).toBe(120); // 1120 - 1000 (baseline is the last reading at/before midnight)
  });

  it("computes weekly and monthly distance using the same baseline/latest approach over a wider window", () => {
    const monthStart = startOfMonthInTimeZone(at, SAST);
    const readings: OdometerReading[] = [
      { recordedAt: new Date(monthStart.getTime() - 60 * 60 * 1000), odometerKm: 5000, ignitionOn: true },
      { recordedAt: at, odometerKm: 5300, ignitionOn: true },
    ];
    const result = computeDistanceSoFar({ readings, at, timezone: SAST });
    expect(result.month).toBe(300);
  });

  it("clamps to zero rather than reporting negative distance on an odometer rollback/vehicle swap", () => {
    const midnightSAST = startOfDayInTimeZone(at, SAST);
    const readings: OdometerReading[] = [
      { recordedAt: new Date(midnightSAST.getTime() - 60 * 60 * 1000), odometerKm: 5000, ignitionOn: true },
      { recordedAt: at, odometerKm: 100, ignitionOn: true }, // e.g. vehicle/tracker swapped mid-day
    ];
    const result = computeDistanceSoFar({ readings, at, timezone: SAST });
    expect(result.day).toBe(0);
  });

  describe("trip boundary (ignition on/off transitions)", () => {
    it("returns null when no ignition signal is present at all", () => {
      const readings: OdometerReading[] = [
        { recordedAt: new Date(at.getTime() - 60 * 60 * 1000), odometerKm: 100, ignitionOn: null },
        { recordedAt: at, odometerKm: 150, ignitionOn: null },
      ];
      const result = computeDistanceSoFar({ readings, at, timezone: SAST });
      expect(result.trip).toBeNull();
    });

    it("measures distance since the most recent ignition-off -> on transition", () => {
      const hourMs = 60 * 60 * 1000;
      const readings: OdometerReading[] = [
        { recordedAt: new Date(at.getTime() - 4 * hourMs), odometerKm: 100, ignitionOn: true }, // an earlier trip
        { recordedAt: new Date(at.getTime() - 3 * hourMs), odometerKm: 140, ignitionOn: false }, // parked
        { recordedAt: new Date(at.getTime() - 2 * hourMs), odometerKm: 140, ignitionOn: true }, // current trip starts here
        { recordedAt: new Date(at.getTime() - 1 * hourMs), odometerKm: 180, ignitionOn: true },
        { recordedAt: at, odometerKm: 210, ignitionOn: true },
      ];
      const result = computeDistanceSoFar({ readings, at, timezone: SAST });
      expect(result.trip).toBe(70); // 210 - 140, not 210 - 100 (the earlier trip must not be included)
    });

    it("falls back to the earliest available reading when ignition has been on the whole time (no transition to find)", () => {
      const hourMs = 60 * 60 * 1000;
      const readings: OdometerReading[] = [
        { recordedAt: new Date(at.getTime() - 2 * hourMs), odometerKm: 100, ignitionOn: true },
        { recordedAt: at, odometerKm: 160, ignitionOn: true },
      ];
      const result = computeDistanceSoFar({ readings, at, timezone: SAST });
      expect(result.trip).toBe(60);
    });
  });
});

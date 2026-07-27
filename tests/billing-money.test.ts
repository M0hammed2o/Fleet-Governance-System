import { describe, it, expect } from "vitest";
import { calculateBillableFees, computeVatAmount, formatMinorUnits } from "@/lib/billing/money";

describe("Phase 10 (P10A/D): calculateBillableFees — integer-only financial calculation", () => {
  it("matches the approved worked example exactly: 15 vehicles, R1,999 base, R299/vehicle -> R6,484 subtotal before VAT", () => {
    const result = calculateBillableFees({ baseFeeMinorUnits: 199_900, perVehicleFeeMinorUnits: 29_900, vehicleCount: 15 });
    expect(result.baseFeeMinorUnits).toBe(199_900);
    expect(result.vehicleFeeMinorUnits).toBe(448_500); // 299 * 15 = 4,485.00
    expect(result.subtotalMinorUnits).toBe(648_400); // 1,999 + 4,485 = 6,484.00
    expect(result.vatAmountMinorUnits).toBe(0);
    expect(result.totalMinorUnits).toBe(648_400);
  });

  it("0 vehicles: only the base fee is charged", () => {
    const result = calculateBillableFees({ baseFeeMinorUnits: 199_900, perVehicleFeeMinorUnits: 29_900, vehicleCount: 0 });
    expect(result.vehicleFeeMinorUnits).toBe(0);
    expect(result.subtotalMinorUnits).toBe(199_900);
  });

  it("1 vehicle: base + exactly one vehicle fee", () => {
    const result = calculateBillableFees({ baseFeeMinorUnits: 199_900, perVehicleFeeMinorUnits: 29_900, vehicleCount: 1 });
    expect(result.subtotalMinorUnits).toBe(229_800);
  });

  it("a larger fleet (250 vehicles) scales linearly with exact integer arithmetic", () => {
    const result = calculateBillableFees({ baseFeeMinorUnits: 199_900, perVehicleFeeMinorUnits: 29_900, vehicleCount: 250 });
    expect(result.vehicleFeeMinorUnits).toBe(29_900 * 250);
    expect(result.subtotalMinorUnits).toBe(199_900 + 29_900 * 250);
  });

  it("applies VAT only when a rate is configured (15% on the worked example)", () => {
    const withVat = calculateBillableFees({ baseFeeMinorUnits: 199_900, perVehicleFeeMinorUnits: 29_900, vehicleCount: 15, vatRateBasisPoints: 1500 });
    expect(withVat.subtotalMinorUnits).toBe(648_400);
    expect(withVat.vatAmountMinorUnits).toBe(97_260); // 6,484.00 * 15% = 972.60
    expect(withVat.totalMinorUnits).toBe(745_660);

    const withoutVat = calculateBillableFees({ baseFeeMinorUnits: 199_900, perVehicleFeeMinorUnits: 29_900, vehicleCount: 15, vatRateBasisPoints: null });
    expect(withoutVat.vatAmountMinorUnits).toBe(0);
    expect(withoutVat.totalMinorUnits).toBe(withoutVat.subtotalMinorUnits);
  });

  it("tenant-specific negotiated pricing produces a different total than the platform default", () => {
    const standard = calculateBillableFees({ baseFeeMinorUnits: 199_900, perVehicleFeeMinorUnits: 29_900, vehicleCount: 15 });
    const negotiated = calculateBillableFees({ baseFeeMinorUnits: 150_000, perVehicleFeeMinorUnits: 25_000, vehicleCount: 15 });
    expect(negotiated.subtotalMinorUnits).not.toBe(standard.subtotalMinorUnits);
    expect(negotiated.subtotalMinorUnits).toBe(150_000 + 25_000 * 15);
  });

  it("computeVatAmount rounds half-up to the nearest minor unit", () => {
    expect(computeVatAmount(100, 1550)).toBe(16); // 100 * 15.5% = 15.5 -> rounds to 16
    expect(computeVatAmount(1000, 1500)).toBe(150);
    expect(computeVatAmount(0, 1500)).toBe(0);
  });

  it("formatMinorUnits renders ZAR with two decimal places and thousands separators", () => {
    expect(formatMinorUnits(648_400)).toBe("R6,484.00");
    expect(formatMinorUnits(0)).toBe("R0.00");
    expect(formatMinorUnits(199_900)).toBe("R1,999.00");
    expect(formatMinorUnits(50)).toBe("R0.50");
  });
});

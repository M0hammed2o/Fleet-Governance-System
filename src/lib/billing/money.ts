/**
 * Pure integer money math for Phase 10 billing (P10A — "use integer minor
 * currency units... never JavaScript floating-point arithmetic for
 * financial calculations"). Every amount in this codebase's billing models
 * is an integer count of minor currency units (e.g. ZAR cents): R1,999.00
 * is stored/computed as 199900, never as the float 1999.00. No function in
 * this file ever divides money by money and keeps a fractional result —
 * only integer multiplication, addition, and a single explicit
 * round-half-up division for VAT (rounding to the nearest minor unit, which
 * a monetary amount must always end at).
 */

export interface BillableFeeCalculation {
  baseFeeMinorUnits: number;
  vehicleFeeMinorUnits: number;
  subtotalMinorUnits: number;
  vatAmountMinorUnits: number;
  totalMinorUnits: number;
}

/**
 * Computes the base + per-vehicle charge and, when a VAT rate is supplied,
 * the VAT amount and total — the exact calculation P10D's worked example
 * specifies (15 vehicles, R1,999 base, R299/vehicle -> R6,484 subtotal
 * before VAT).
 */
export function calculateBillableFees(input: {
  baseFeeMinorUnits: number;
  perVehicleFeeMinorUnits: number;
  vehicleCount: number;
  vatRateBasisPoints?: number | null;
}): BillableFeeCalculation {
  const vehicleFeeMinorUnits = input.perVehicleFeeMinorUnits * input.vehicleCount;
  const subtotalMinorUnits = input.baseFeeMinorUnits + vehicleFeeMinorUnits;
  const vatAmountMinorUnits = input.vatRateBasisPoints ? computeVatAmount(subtotalMinorUnits, input.vatRateBasisPoints) : 0;
  const totalMinorUnits = subtotalMinorUnits + vatAmountMinorUnits;
  return { baseFeeMinorUnits: input.baseFeeMinorUnits, vehicleFeeMinorUnits, subtotalMinorUnits, vatAmountMinorUnits, totalMinorUnits };
}

/**
 * VAT amount on a subtotal, given an integer basis-point rate (1500 =
 * 15.00%) — round-half-up to the nearest minor unit, the only rounding
 * this module ever performs, and always on a whole-minor-unit boundary.
 */
export function computeVatAmount(subtotalMinorUnits: number, vatRateBasisPoints: number): number {
  const scaled = subtotalMinorUnits * vatRateBasisPoints;
  return Math.floor(scaled / 10_000 + 0.5);
}

/**
 * "R1,999.00" style formatting for display only — never used for a
 * stored/compared amount. Deliberately hand-formats (comma thousands
 * separator, period decimal point) rather than `toLocaleString`, so the
 * output is identical across every environment regardless of the Node
 * build's installed ICU data.
 */
export function formatMinorUnits(minorUnits: number, currency: string = "ZAR"): string {
  const negative = minorUnits < 0;
  const abs = Math.abs(minorUnits);
  const majorPart = Math.floor(abs / 100);
  const centsPart = String(abs % 100).padStart(2, "0");
  const withThousands = majorPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const symbol = currency === "ZAR" ? "R" : `${currency} `;
  return `${negative ? "-" : ""}${symbol}${withThousands}.${centsPart}`;
}

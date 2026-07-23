/**
 * Pure comparison engine — no DB, fully unit-testable (same pattern as
 * lib/gate-events/state-machine.ts and lib/documents/expiry-rules.ts).
 * Takes the departure and return GateEvent's recorded inspection answers and
 * produces a flat list of structured discrepancy drafts, never a verdict —
 * see PRODUCT_REQUIREMENTS.md RECON-001/002 and DECISIONS.md: this never
 * concludes fraud, theft or criminal conduct, only states what changed.
 *
 * Categorisation deliberately reads off the existing, already
 * tenant-configurable InspectionSection/unit taxonomy rather than hardcoding
 * item labels, so a tenant's own custom inspection items (extra
 * LOAD_VERIFICATION checks for tools/equipment/passengers, additional
 * TYRES_WHEELS readings, ...) are compared automatically without any engine
 * change — "where configured" in RECON-001.
 */

export type DiscrepancyCategory = "ODOMETER" | "FUEL" | "VEHICLE_CONDITION" | "TYRE_CONDITION" | "CARGO_AND_LOAD";
export type DiscrepancySeverity = "LOW" | "MEDIUM" | "HIGH";

export interface InspectionReadingLike {
  inspectionItemId: string;
  section: string;
  label: string;
  responseType: string;
  unit: string | null;
  outcome: string;
  readingValue: string | null;
}

export interface DiscrepancyDraft {
  category: DiscrepancyCategory;
  severity: DiscrepancySeverity;
  description: string;
  departureValue: string | null;
  returnValue: string | null;
  deltaValue: number | null;
  inspectionItemId: string | null;
}

export interface ComputeDiscrepanciesInput {
  departureItems: InspectionReadingLike[];
  returnItems: InspectionReadingLike[];
  // Planned/estimated trip distance (MovementAuthorisation.expectedDistanceKm).
  // Null skips the "excess mileage" check entirely rather than treating it as 0.
  expectedDistanceKm: number | null;
}

export interface ComputeDiscrepanciesResult {
  departureOdometer: number | null;
  returnOdometer: number | null;
  kmTravelled: number | null;
  departureFuelPercent: number | null;
  returnFuelPercent: number | null;
  fuelDeltaPercent: number | null;
  discrepancies: DiscrepancyDraft[];
}

// A tyre-tread (or similar) reading dropping by at least this much between
// departure and return is flagged — small measurement variance is expected
// and shouldn't generate noise.
const TYRE_READING_DROP_THRESHOLD = 2;
// A fuel-level drop this large in one trip is unusual enough to flag for
// review (not an accusation — could be a long trip, a top-up not logged, etc).
const FUEL_DROP_THRESHOLD_PERCENT = 75;
// Tolerance applied to expectedDistanceKm before "excess mileage" fires.
const EXCESS_MILEAGE_TOLERANCE = 1.15;

function parseNumeric(value: string | null | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function indexById(items: InspectionReadingLike[]): Map<string, InspectionReadingLike> {
  return new Map(items.map((item) => [item.inspectionItemId, item]));
}

export function computeReconciliationDiscrepancies(input: ComputeDiscrepanciesInput): ComputeDiscrepanciesResult {
  const departureById = indexById(input.departureItems);
  const returnById = indexById(input.returnItems);
  const discrepancies: DiscrepancyDraft[] = [];

  // --- Odometer (OPERATIONAL_INFO, unit "km") --------------------------------
  let departureOdometer: number | null = null;
  let returnOdometer: number | null = null;
  for (const item of input.departureItems) {
    if (item.section !== "OPERATIONAL_INFO" || item.unit !== "km") continue;
    const match = returnById.get(item.inspectionItemId);
    if (!match) continue;
    departureOdometer = parseNumeric(item.readingValue);
    returnOdometer = parseNumeric(match.readingValue);
    break;
  }

  let kmTravelled: number | null = null;
  if (departureOdometer != null && returnOdometer != null) {
    if (returnOdometer < departureOdometer) {
      discrepancies.push({
        category: "ODOMETER",
        severity: "HIGH",
        description: "Return odometer reading is lower than the departure reading — requires review.",
        departureValue: String(departureOdometer),
        returnValue: String(returnOdometer),
        deltaValue: returnOdometer - departureOdometer,
        inspectionItemId: null,
      });
    } else {
      kmTravelled = returnOdometer - departureOdometer;
      if (input.expectedDistanceKm != null && kmTravelled > input.expectedDistanceKm * EXCESS_MILEAGE_TOLERANCE) {
        discrepancies.push({
          category: "ODOMETER",
          severity: "MEDIUM",
          description: `Distance travelled (${kmTravelled} km) exceeds the expected trip distance (${input.expectedDistanceKm} km).`,
          departureValue: String(departureOdometer),
          returnValue: String(returnOdometer),
          deltaValue: kmTravelled,
          inspectionItemId: null,
        });
      }
    }
  }

  // --- Fuel (OPERATIONAL_INFO, unit "%") --------------------------------------
  let departureFuelPercent: number | null = null;
  let returnFuelPercent: number | null = null;
  for (const item of input.departureItems) {
    if (item.section !== "OPERATIONAL_INFO" || item.unit !== "%") continue;
    const match = returnById.get(item.inspectionItemId);
    if (!match) continue;
    departureFuelPercent = parseNumeric(item.readingValue);
    returnFuelPercent = parseNumeric(match.readingValue);
    break;
  }

  let fuelDeltaPercent: number | null = null;
  if (departureFuelPercent != null && returnFuelPercent != null) {
    fuelDeltaPercent = returnFuelPercent - departureFuelPercent;
    if (fuelDeltaPercent > 0) {
      discrepancies.push({
        category: "FUEL",
        severity: "MEDIUM",
        description: "Fuel level increased during the movement with no recorded refuelling.",
        departureValue: String(departureFuelPercent),
        returnValue: String(returnFuelPercent),
        deltaValue: fuelDeltaPercent,
        inspectionItemId: null,
      });
    } else if (Math.abs(fuelDeltaPercent) >= FUEL_DROP_THRESHOLD_PERCENT) {
      discrepancies.push({
        category: "FUEL",
        severity: "HIGH",
        description: "Fuel level dropped by an unusually large amount during the movement.",
        departureValue: String(departureFuelPercent),
        returnValue: String(returnFuelPercent),
        deltaValue: fuelDeltaPercent,
        inspectionItemId: null,
      });
    }
  }

  // --- Condition / tyres / cargo — generic per-item comparison ---------------
  for (const [itemId, departureItem] of departureById) {
    const returnItem = returnById.get(itemId);
    if (!returnItem) continue;

    if (departureItem.section === "EXTERIOR_CONDITION" && departureItem.responseType === "CHECK") {
      if (departureItem.outcome === "PASS" && returnItem.outcome === "FAIL") {
        discrepancies.push({
          category: "VEHICLE_CONDITION",
          severity: "HIGH",
          description: `New issue found on return that was not present at departure: "${departureItem.label}".`,
          departureValue: departureItem.outcome,
          returnValue: returnItem.outcome,
          deltaValue: null,
          inspectionItemId: itemId,
        });
      }
      continue;
    }

    if (departureItem.section === "TYRES_WHEELS") {
      if (departureItem.responseType === "CHECK") {
        if (departureItem.outcome === "PASS" && returnItem.outcome === "FAIL") {
          discrepancies.push({
            category: "TYRE_CONDITION",
            severity: "HIGH",
            description: `New tyre issue found on return that was not present at departure: "${departureItem.label}".`,
            departureValue: departureItem.outcome,
            returnValue: returnItem.outcome,
            deltaValue: null,
            inspectionItemId: itemId,
          });
        }
      } else if (departureItem.responseType === "READING") {
        const departureReading = parseNumeric(departureItem.readingValue);
        const returnReading = parseNumeric(returnItem.readingValue);
        if (departureReading != null && returnReading != null) {
          const delta = returnReading - departureReading;
          if (delta <= -TYRE_READING_DROP_THRESHOLD) {
            discrepancies.push({
              category: "TYRE_CONDITION",
              severity: "MEDIUM",
              description: `"${departureItem.label}" dropped significantly between departure and return — verify no tyre swap or damage occurred.`,
              departureValue: String(departureReading),
              returnValue: String(returnReading),
              deltaValue: delta,
              inspectionItemId: itemId,
            });
          }
        }
      }
      continue;
    }

    if (departureItem.section === "LOAD_VERIFICATION" && departureItem.responseType === "CHECK") {
      if (departureItem.outcome === "PASS" && returnItem.outcome === "FAIL") {
        discrepancies.push({
          category: "CARGO_AND_LOAD",
          severity: "HIGH",
          description: `Cargo/load verification changed between departure and return: "${departureItem.label}".`,
          departureValue: departureItem.outcome,
          returnValue: returnItem.outcome,
          deltaValue: null,
          inspectionItemId: itemId,
        });
      }
    }
  }

  return {
    departureOdometer,
    returnOdometer,
    kmTravelled,
    departureFuelPercent,
    returnFuelPercent,
    fuelDeltaPercent,
    discrepancies,
  };
}

export const DRIVER_RATING_RULE_VERSION = "phase18a-driver-governance-v1";

export type DriverRatingStatus = "GOOD_STANDING" | "REVIEW_REQUIRED" | "SERIOUS_ATTENTION";
export interface DriverRatingFactor {
  code: string;
  label: string;
  impact: number;
  kind: "positive" | "attention";
  action: string | null;
}
export interface DriverRatingInput {
  employeeNumber: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  licenceNumber: string | null;
  licenceExpiry: Date | null;
  pdpStatus: string;
  pdpExpiry: Date | null;
  hasCurrentVehicle: boolean;
  openCriticalExceptions: number;
  openHighExceptions: number;
  failedInspections: number;
  deniedGateEvents: number;
  openDiscrepancies: number;
  seriousGovernanceIndicators: number;
}

function daysUntil(date: Date, now: Date): number {
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}

export function calculateDriverGovernanceRating(input: DriverRatingInput, now = new Date()) {
  const factors: DriverRatingFactor[] = [];
  const attention = (code: string, label: string, impact: number, action: string) => factors.push({ code, label, impact: -Math.abs(impact), kind: "attention", action });
  const positive = (code: string, label: string) => factors.push({ code, label, impact: 0, kind: "positive", action: null });

  if (!input.employeeNumber) attention("PROFILE_EMPLOYEE_NUMBER", "Employee number is missing", 5, "Add the employee number.");
  if (!input.contactPhone && !input.contactEmail) attention("PROFILE_CONTACT", "Contact details are incomplete", 5, "Add an authorised phone number or email address.");
  if (!input.licenceNumber) {
    attention("LICENCE_MISSING", "Driving licence details are missing", 20, "Record and verify the driver's licence.");
  } else if (!input.licenceExpiry) {
    attention("LICENCE_EXPIRY_MISSING", "Driving licence expiry is missing", 15, "Record the licence expiry date.");
  } else {
    const remaining = daysUntil(input.licenceExpiry, now);
    if (remaining < 0) attention("LICENCE_EXPIRED", "Driving licence has expired", 35, "Renew and verify the driving licence before duty.");
    else if (remaining <= 45) attention("LICENCE_EXPIRING", `Driving licence expires in ${remaining} day${remaining === 1 ? "" : "s"}`, 15, "Start the licence renewal process.");
    else positive("LICENCE_VALID", "Driving licence is currently valid");
  }

  if (input.pdpStatus !== "NOT_REQUIRED") {
    if (input.pdpStatus === "EXPIRED" || (input.pdpExpiry && input.pdpExpiry < now)) attention("PDP_EXPIRED", "Professional Driving Permit has expired", 25, "Renew and verify the professional permit.");
    else if (input.pdpStatus === "PENDING" || input.pdpStatus === "SUSPENDED") attention("PDP_REVIEW", `Professional permit status is ${input.pdpStatus.toLowerCase()}`, 20, "Resolve the professional permit status before applicable duty.");
    else if (!input.pdpExpiry) attention("PDP_EXPIRY_MISSING", "Professional permit expiry is missing", 10, "Record the professional permit expiry date.");
    else if (daysUntil(input.pdpExpiry, now) <= 45) attention("PDP_EXPIRING", "Professional permit is approaching expiry", 10, "Start the professional permit renewal process.");
    else positive("PDP_VALID", "Professional permit is currently valid");
  }

  if (!input.hasCurrentVehicle) attention("UNASSIGNED", "No current vehicle assignment", 5, "Assign a vehicle if this driver is expected to be on duty.");
  else positive("ASSIGNMENT_ACTIVE", "Current vehicle assignment is active");
  if (input.openCriticalExceptions) attention("CRITICAL_EXCEPTIONS", `${input.openCriticalExceptions} open critical exception${input.openCriticalExceptions === 1 ? "" : "s"}`, Math.min(40, input.openCriticalExceptions * 30), "Resolve or formally escalate the critical exception(s).");
  if (input.openHighExceptions) attention("HIGH_EXCEPTIONS", `${input.openHighExceptions} open high exception${input.openHighExceptions === 1 ? "" : "s"}`, Math.min(30, input.openHighExceptions * 15), "Review and resolve the high exception(s).");
  if (input.failedInspections) attention("FAILED_INSPECTIONS", `${input.failedInspections} failed inspection item${input.failedInspections === 1 ? "" : "s"}`, Math.min(20, input.failedInspections * 10), "Review inspection failures and corrective actions.");
  if (input.deniedGateEvents) attention("DENIED_GATE_EVENTS", `${input.deniedGateEvents} denied gate decision${input.deniedGateEvents === 1 ? "" : "s"}`, Math.min(30, input.deniedGateEvents * 15), "Review the recorded gate decision reasons.");
  if (input.openDiscrepancies) attention("OPEN_DISCREPANCIES", `${input.openDiscrepancies} unresolved departure/return discrepancy`, Math.min(20, input.openDiscrepancies * 10), "Review and resolve the factual reconciliation discrepancy.");
  if (input.seriousGovernanceIndicators) attention("GOVERNANCE_INDICATORS", `${input.seriousGovernanceIndicators} verified high-priority governance indicator`, Math.min(20, input.seriousGovernanceIndicators * 10), "Review the explainable governance indicator and source records.");

  const score = Math.max(0, Math.min(100, 100 + factors.reduce((sum, factor) => sum + factor.impact, 0)));
  const status: DriverRatingStatus = score >= 80 ? "GOOD_STANDING" : score >= 50 ? "REVIEW_REQUIRED" : "SERIOUS_ATTENTION";
  return {
    score,
    status,
    label: status === "GOOD_STANDING" ? "Good standing" : status === "REVIEW_REQUIRED" ? "Review required" : "Serious attention required",
    ruleVersion: DRIVER_RATING_RULE_VERSION,
    calculatedAt: now,
    factors,
    actionsRequired: factors.filter((factor) => factor.action).map((factor) => factor.action as string),
    disclaimer: "Operational review indicator only. It is not a finding of fraud, dishonesty or misconduct.",
  };
}

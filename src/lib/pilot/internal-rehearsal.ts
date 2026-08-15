export const INTERNAL_REHEARSAL_EXECUTION_CLASSES = [
  "AUTOMATED",
  "BROWSER_SIMULATED",
  "EMULATOR",
  "PHYSICAL_DEVICE",
  "HUMAN",
  "CUSTOMER",
] as const;

export interface InternalRehearsalCase {
  id: string;
  title: string;
  executionClass: (typeof INTERNAL_REHEARSAL_EXECUTION_CLASSES)[number];
  automatedEvidence: string[];
  deviceRequirement: "NONE" | "BROWSER" | "PHYSICAL_ANDROID" | "BROWSER_AND_PHYSICAL_ANDROID";
  status: "NOT_RUN";
}

const REQUIRED_TITLES = [
  "Driver enrolment",
  "Successful synthetic facial verification",
  "Non-match",
  "Facial-liveness failure",
  "Provider unavailable",
  "Manual identity fallback",
  "Authorized override",
  "Unauthorized override",
  "Revoked enrolment",
  "Cross-tenant biometric reference",
  "Biometric deletion",
  "Android camera permission",
  "Android disconnected behavior",
  "Android session restoration",
  "Complete departure and return lifecycle",
] as const;

export function validatePhase17aRehearsalCases(input: unknown): {
  valid: boolean;
  errors: string[];
  cases: InternalRehearsalCase[];
} {
  if (!Array.isArray(input)) return { valid: false, errors: ["Phase 17A rehearsal cases must be an array."], cases: [] };
  const errors: string[] = [];
  const ids = new Set<string>();
  const titles = new Set<string>();
  for (const [index, value] of input.entries()) {
    if (!value || typeof value !== "object") {
      errors.push(`Case ${index + 1} must be an object.`);
      continue;
    }
    const entry = value as Record<string, unknown>;
    if (typeof entry.id !== "string" || !/^UAT-[A-Z0-9]+-\d{3}$/.test(entry.id)) errors.push(`Case ${index + 1} has an invalid id.`);
    else if (ids.has(entry.id)) errors.push(`Duplicate case id ${entry.id}.`);
    else ids.add(entry.id);
    if (typeof entry.title !== "string" || entry.title.trim() === "") errors.push(`${String(entry.id)} requires a title.`);
    else titles.add(entry.title);
    if (!INTERNAL_REHEARSAL_EXECUTION_CLASSES.includes(entry.executionClass as never)) errors.push(`${String(entry.id)} has an invalid execution class.`);
    if (!Array.isArray(entry.automatedEvidence) || entry.automatedEvidence.length === 0 || entry.automatedEvidence.some((item) => typeof item !== "string" || !item.trim())) errors.push(`${String(entry.id)} requires automated evidence references.`);
    if (entry.status !== "NOT_RUN") errors.push(`${String(entry.id)} must start NOT_RUN; machine rehearsal cannot fabricate execution.`);
  }
  if (input.length !== REQUIRED_TITLES.length) errors.push(`Expected ${REQUIRED_TITLES.length} Phase 17A cases, found ${input.length}.`);
  for (const title of REQUIRED_TITLES) if (!titles.has(title)) errors.push(`Missing required rehearsal case: ${title}.`);
  return { valid: errors.length === 0, errors, cases: errors.length === 0 ? input as InternalRehearsalCase[] : [] };
}

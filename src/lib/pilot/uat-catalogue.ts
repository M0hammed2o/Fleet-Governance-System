export const UAT_REQUIRED_FIELDS = ["id", "module", "objective", "role", "preconditions", "testData", "steps", "expectedResult", "actualResult", "passFail", "evidence", "defectReference", "tester", "date", "retestStatus", "approvalStatus"] as const;

export interface UatCase {
  id: string;
  module: string;
  objective: string;
  role: string;
  preconditions: string;
  testData: string;
  steps: string[];
  expectedResult: string;
  actualResult: string | null;
  passFail: "NOT_RUN" | "PASS" | "FAIL" | "BLOCKED";
  evidence: string | null;
  defectReference: string | null;
  tester: string | null;
  date: string | null;
  retestStatus: "NOT_REQUIRED" | "PENDING" | "PASS" | "FAIL";
  approvalStatus: "PENDING" | "ACCEPTED" | "CONDITIONALLY_ACCEPTED" | "REJECTED";
}

export function validateUatCatalogue(input: unknown): { valid: boolean; errors: string[]; cases: UatCase[] } {
  if (!Array.isArray(input)) return { valid: false, errors: ["Catalogue must be an array."], cases: [] };
  const errors: string[] = [];
  const ids = new Set<string>();
  input.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") { errors.push(`Entry ${index + 1} must be an object.`); return; }
    const record = entry as Record<string, unknown>;
    for (const field of UAT_REQUIRED_FIELDS) if (!(field in record)) errors.push(`Entry ${index + 1} is missing ${field}.`);
    if (typeof record.id !== "string" || !/^UAT-[A-Z0-9]+-\d{3}$/.test(record.id)) errors.push(`Entry ${index + 1} has an invalid id.`);
    else if (ids.has(record.id)) errors.push(`Duplicate id ${record.id}.`); else ids.add(record.id);
    if (!Array.isArray(record.steps) || record.steps.length === 0 || record.steps.some((step) => typeof step !== "string" || step.length === 0)) errors.push(`${String(record.id)} requires non-empty steps.`);
    for (const field of ["module", "objective", "role", "preconditions", "testData", "expectedResult"]) if (typeof record[field] !== "string" || (record[field] as string).trim() === "") errors.push(`${String(record.id)} requires ${field}.`);
  });
  return { valid: errors.length === 0, errors, cases: errors.length === 0 ? input as UatCase[] : [] };
}

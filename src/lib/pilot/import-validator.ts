import { PILOT_TENANT_SLUG, assertNonDeliverablePilotEmail } from "./pilot-safety";

export const PILOT_IMPORT_TYPES = ["sites", "gates", "vehicles", "drivers", "users", "role_assignments", "departments", "tracker_mappings", "operating_hours", "analytics_thresholds"] as const;
export type PilotImportType = (typeof PILOT_IMPORT_TYPES)[number];

const REQUIRED_FIELDS: Record<PilotImportType, readonly string[]> = {
  sites: ["tenant_slug", "site_code", "name", "address"],
  gates: ["tenant_slug", "gate_code", "site_code", "name", "direction"],
  vehicles: ["tenant_slug", "fleet_number", "registration_number", "vin", "category"],
  drivers: ["tenant_slug", "employee_number", "name", "email", "licence_class"],
  users: ["tenant_slug", "email", "name"],
  role_assignments: ["tenant_slug", "email", "role_name"],
  departments: ["tenant_slug", "department_code", "name"],
  tracker_mappings: ["tenant_slug", "registration_number", "provider", "provider_asset_reference"],
  operating_hours: ["tenant_slug", "site_code", "day_of_week", "opens_at", "closes_at"],
  analytics_thresholds: ["tenant_slug", "rule_code", "minimum_occurrence_count", "evaluation_period_days"],
};

const UNIQUE_FIELDS: Record<PilotImportType, readonly string[]> = {
  sites: ["site_code"], gates: ["gate_code"], vehicles: ["fleet_number", "registration_number", "vin"],
  drivers: ["employee_number", "email"], users: ["email"], role_assignments: ["email", "role_name"],
  departments: ["department_code"], tracker_mappings: ["registration_number", "provider"],
  operating_hours: ["site_code", "day_of_week"], analytics_thresholds: ["rule_code"],
};

export interface ImportError { row: number; field: string; code: string; message: string }
export interface ImportResult { type: PilotImportType; actor: string; dryRun: true; rows: number; valid: boolean; errors: ImportError[]; records: Record<string, string>[] }

export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') { field += '"'; index += 1; } else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error("Malformed CSV: unclosed quoted field.");
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function formulaUnsafe(value: string): boolean { return /^[=+\-@]/.test(value.trimStart()); }

export function validatePilotImport(type: PilotImportType, csv: string, actor = "administrator@pilot.example.test"): ImportResult {
  assertNonDeliverablePilotEmail(actor);
  const parsed = parseCsv(csv);
  if (parsed.length === 0) return { type, actor, dryRun: true, rows: 0, valid: false, errors: [{ row: 1, field: "file", code: "EMPTY", message: "CSV is empty." }], records: [] };
  const headers = parsed[0].map((header) => header.trim());
  const errors: ImportError[] = [];
  for (const required of REQUIRED_FIELDS[type]) if (!headers.includes(required)) errors.push({ row: 1, field: required, code: "MISSING_HEADER", message: `Required header ${required} is missing.` });
  const records = parsed.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])));
  const seen = new Map<string, number>();
  records.forEach((record, rowIndex) => {
    const row = rowIndex + 2;
    for (const required of REQUIRED_FIELDS[type]) if (!record[required]) errors.push({ row, field: required, code: "REQUIRED", message: `${required} is required.` });
    if (record.tenant_slug !== PILOT_TENANT_SLUG) errors.push({ row, field: "tenant_slug", code: "TENANT_BOUNDARY", message: `Only ${PILOT_TENANT_SLUG} may be dry-run through pilot tooling.` });
    for (const [fieldName, value] of Object.entries(record)) if (formulaUnsafe(value)) errors.push({ row, field: fieldName, code: "FORMULA_INJECTION", message: "Spreadsheet formula prefixes are rejected." });
    if ((type === "users" || type === "drivers") && record.email) {
      try { assertNonDeliverablePilotEmail(record.email); } catch { errors.push({ row, field: "email", code: "DELIVERABLE_ADDRESS", message: "Only pilot.example.test addresses are allowed." }); }
    }
    if (Object.keys(record).some((fieldName) => /biometric|facial_template|descriptor/i.test(fieldName))) errors.push({ row, field: "file", code: "BIOMETRIC_FORBIDDEN", message: "Biometric templates cannot be imported through CSV." });
    const key = UNIQUE_FIELDS[type].map((fieldName) => record[fieldName]?.toLowerCase()).join("|");
    if (seen.has(key)) errors.push({ row, field: UNIQUE_FIELDS[type].join(","), code: "DUPLICATE", message: `Duplicates row ${seen.get(key)}.` }); else seen.set(key, row);
  });
  return { type, actor, dryRun: true, rows: records.length, valid: errors.length === 0, errors, records };
}

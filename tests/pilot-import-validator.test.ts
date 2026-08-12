import { describe, expect, it } from "vitest";
import { validatePilotImport } from "@/lib/pilot/import-validator";

const tenant = "genbridge-synthetic-fleet-pilot";

describe("pilot CSV dry-run validation", () => {
  it("accepts a valid synthetic site without mutating data", () => {
    const result = validatePilotImport("sites", `tenant_slug,site_code,name,address\n${tenant},SYN-NORTH,Synthetic North,1 Example Test Avenue`);
    expect(result).toMatchObject({ valid: true, dryRun: true, rows: 1 });
  });

  it("returns row-specific malformed and duplicate errors", () => {
    const result = validatePilotImport("vehicles", `tenant_slug,fleet_number,registration_number,vin,category\n${tenant},SYN-1,SYN001GP,SYNVIN1,LIGHT_COMMERCIAL\n${tenant},SYN-1,SYN001GP,SYNVIN1,LIGHT_COMMERCIAL`);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ row: 3, code: "DUPLICATE" })]));
  });

  it("rejects cross-tenant rows and deliverable addresses", () => {
    const result = validatePilotImport("users", "tenant_slug,email,name\ncustomer,real@example.com,Real Person");
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining(["TENANT_BOUNDARY", "DELIVERABLE_ADDRESS"]));
  });

  it("rejects spreadsheet formulas and any biometric column", () => {
    const result = validatePilotImport("drivers", `tenant_slug,employee_number,name,email,licence_class,biometric_template\n${tenant},SYN-1,=HYPERLINK(""x""),driver@pilot.example.test,C1,descriptor`);
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining(["FORMULA_INJECTION", "BIOMETRIC_FORBIDDEN"]));
  });
});

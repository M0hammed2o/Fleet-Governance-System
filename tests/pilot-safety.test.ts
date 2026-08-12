import { describe, expect, it } from "vitest";
import { PILOT_TENANT_ID, PILOT_TENANT_NAME, PILOT_TENANT_SLUG, assertNonDeliverablePilotEmail, assertPilotDatabaseSafety, assertPilotTenantIdentity } from "@/lib/pilot/pilot-safety";

describe("synthetic pilot safety boundary", () => {
  it("allows only the named loopback development and test databases", () => {
    expect(() => assertPilotDatabaseSafety("postgresql://u:p@localhost:5432/gate_fleet_governance", { APP_ENV: "development" })).not.toThrow();
    expect(() => assertPilotDatabaseSafety("postgresql://u:p@127.0.0.1:5432/gate_fleet_governance_test", { APP_ENV: "test" })).not.toThrow();
    expect(() => assertPilotDatabaseSafety("postgresql://u:p@db.example.test:5432/gate_fleet_governance", { APP_ENV: "test" })).toThrow(/loopback/i);
    expect(() => assertPilotDatabaseSafety("postgresql://u:p@localhost:5432/customer", { APP_ENV: "development" })).toThrow(/approved/i);
  });

  it("refuses production regardless of a loopback-looking URL", () => {
    expect(() => assertPilotDatabaseSafety("postgresql://u:p@localhost:5432/gate_fleet_governance", { APP_ENV: "production" })).toThrow(/production/i);
    expect(() => assertPilotDatabaseSafety("postgresql://u:p@localhost:5432/gate_fleet_governance", { NODE_ENV: "production" })).toThrow(/production/i);
  });

  it("can reset only the exact fixed synthetic tenant identity", () => {
    expect(() => assertPilotTenantIdentity({ id: PILOT_TENANT_ID, slug: PILOT_TENANT_SLUG, name: PILOT_TENANT_NAME })).not.toThrow();
    expect(() => assertPilotTenantIdentity({ id: "customer", slug: PILOT_TENANT_SLUG, name: PILOT_TENANT_NAME })).toThrow(/fixed synthetic/i);
  });

  it("accepts only reserved non-deliverable pilot addresses", () => {
    expect(() => assertNonDeliverablePilotEmail("operator@pilot.example.test")).not.toThrow();
    expect(() => assertNonDeliverablePilotEmail("person@example.com")).toThrow(/non-deliverable/i);
  });
});

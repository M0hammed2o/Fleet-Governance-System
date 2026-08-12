export const PILOT_TENANT_ID = "pilot-genbridge-synthetic-v1";
export const PILOT_TENANT_SLUG = "genbridge-synthetic-fleet-pilot";
export const PILOT_TENANT_NAME = "Genbridge Synthetic Fleet Pilot";
export const PILOT_EMAIL_DOMAIN = "pilot.example.test";

export interface PilotEnvironment {
  APP_ENV?: string;
  NODE_ENV?: string;
}

export function assertPilotDatabaseSafety(databaseUrl: string, env: PilotEnvironment = process.env): URL {
  if (env.APP_ENV === "production" || env.NODE_ENV === "production") {
    throw new Error("Refusing pilot operation: production environments are never allowed.");
  }

  const parsed = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("Refusing pilot operation: DATABASE_URL must use a loopback PostgreSQL host.");
  }
  if (!/^(gate_fleet_governance|gate_fleet_governance_test)$/.test(parsed.pathname.slice(1))) {
    throw new Error("Refusing pilot operation: database name is not an approved local development/test target.");
  }
  return parsed;
}

export function assertPilotTenantIdentity(tenant: { id: string; slug: string; name: string }): void {
  if (tenant.id !== PILOT_TENANT_ID || tenant.slug !== PILOT_TENANT_SLUG || tenant.name !== PILOT_TENANT_NAME) {
    throw new Error("Refusing pilot reset: the target does not match the fixed synthetic pilot identity.");
  }
}

export function assertNonDeliverablePilotEmail(email: string): void {
  if (!email.toLowerCase().endsWith(`@${PILOT_EMAIL_DOMAIN}`)) {
    throw new Error(`Pilot addresses must use the non-deliverable ${PILOT_EMAIL_DOMAIN} domain.`);
  }
}

export const PILOT_EXPECTED_COUNTS = {
  sites: 2,
  gates: 4,
  users: 10,
  drivers: 15,
  vehicles: 15,
  complianceDocuments: 30,
  movements: 9,
  gateEvents: 14,
  reconciliations: 5,
  exceptions: 4,
  investigations: 2,
  analyticsIndicators: 4,
  telematicsEvents: 2,
  manualGpsConfirmations: 1,
} as const;

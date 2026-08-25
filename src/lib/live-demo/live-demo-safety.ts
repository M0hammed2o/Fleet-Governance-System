/**
 * Safety boundary for scripts/provision-live-demo.ts — the OPPOSITE posture
 * from src/lib/pilot/pilot-safety.ts and src/lib/db/seed-guard.ts, both of
 * which refuse to run anywhere but a local loopback database. This module
 * exists specifically to create one narrowly-scoped synthetic demonstration
 * tenant in the live production database, on explicit operator
 * confirmation — see DEMO_TOMORROW_RUNBOOK.md and WORKLOG.md 2026-08-25.
 */

export const LIVE_DEMO_TENANT_ID = "live-demo-genbridge-2026-08";
export const LIVE_DEMO_TENANT_SLUG = "genbridge-demo-logistics";
export const LIVE_DEMO_TENANT_NAME = "Genbridge Demonstration Logistics";
export const LIVE_DEMO_EMAIL_DOMAIN = "genbridge.co.za";
export const LIVE_DEMO_EMAIL_LOCAL_PREFIX = "demo.";

export const LIVE_DEMO_CREATE_CONFIRMATION_VALUE = "CREATE_GENBRIDGE_SYNTHETIC_DEMO";
export const LIVE_DEMO_CLEANUP_CONFIRMATION_VALUE = "DELETE_GENBRIDGE_SYNTHETIC_DEMO";
export const LIVE_DEMO_CREDENTIAL_ROTATION_CONFIRMATION_VALUE = "ROTATE_GENBRIDGE_SYNTHETIC_DEMO_CREDENTIALS";

export interface LiveDemoEnvironment {
  LIVE_SYNTHETIC_DEMO_CONFIRMATION?: string;
  LIVE_SYNTHETIC_DEMO_CLEANUP_CONFIRMATION?: string;
  LIVE_SYNTHETIC_DEMO_CREDENTIAL_ROTATION_CONFIRMATION?: string;
  [key: string]: string | undefined;
}

export function assertLiveDemoCreateConfirmed(env: LiveDemoEnvironment = process.env): void {
  if (env.LIVE_SYNTHETIC_DEMO_CONFIRMATION !== LIVE_DEMO_CREATE_CONFIRMATION_VALUE) {
    throw new Error(
      `Refusing to provision the live demo tenant: set LIVE_SYNTHETIC_DEMO_CONFIRMATION=${LIVE_DEMO_CREATE_CONFIRMATION_VALUE} ` +
        "to confirm this creates records in the live database.",
    );
  }
}

export function assertLiveDemoCleanupConfirmed(env: LiveDemoEnvironment = process.env): void {
  if (env.LIVE_SYNTHETIC_DEMO_CLEANUP_CONFIRMATION !== LIVE_DEMO_CLEANUP_CONFIRMATION_VALUE) {
    throw new Error(
      `Refusing to delete the live demo tenant: set LIVE_SYNTHETIC_DEMO_CLEANUP_CONFIRMATION=${LIVE_DEMO_CLEANUP_CONFIRMATION_VALUE} ` +
        "to confirm this permanently deletes the synthetic demo tenant and everything under it.",
    );
  }
}

export function assertLiveDemoCredentialRotationConfirmed(env: LiveDemoEnvironment = process.env): void {
  if (env.LIVE_SYNTHETIC_DEMO_CREDENTIAL_ROTATION_CONFIRMATION !== LIVE_DEMO_CREDENTIAL_ROTATION_CONFIRMATION_VALUE) {
    throw new Error(
      "Refusing to rotate live demo credentials: set " +
        `LIVE_SYNTHETIC_DEMO_CREDENTIAL_ROTATION_CONFIRMATION=${LIVE_DEMO_CREDENTIAL_ROTATION_CONFIRMATION_VALUE} ` +
        "to confirm this revokes sessions and changes passwords only for the fixed synthetic demo tenant.",
    );
  }
}

/** Refuses an accidental run against a database whose name is obviously a local test artifact. Does not restrict hostname — the operator supplies DATABASE_URL and is responsible for pointing it at the intended target. */
export function assertNotTestDatabase(databaseUrl: string): URL {
  const parsed = new URL(databaseUrl);
  if (/(^|[_-])test([_-]|$)/i.test(parsed.pathname.replace(/^\//, ""))) {
    throw new Error(`Refusing to run: database "${parsed.pathname.slice(1)}" looks like a local test database, not the live demo target.`);
  }
  return parsed;
}

export function assertLiveDemoTenantIdentity(tenant: { id: string; slug: string; name: string }): void {
  if (tenant.id !== LIVE_DEMO_TENANT_ID || tenant.slug !== LIVE_DEMO_TENANT_SLUG || tenant.name !== LIVE_DEMO_TENANT_NAME) {
    throw new Error("Refusing to operate: the target does not match the fixed live-demo tenant identity. This script only ever touches its own dedicated demo tenant.");
  }
}

export function liveDemoEmail(localPart: string): string {
  const email = `${LIVE_DEMO_EMAIL_LOCAL_PREFIX}${localPart}@${LIVE_DEMO_EMAIL_DOMAIN}`;
  if (!email.toLowerCase().startsWith(LIVE_DEMO_EMAIL_LOCAL_PREFIX)) {
    throw new Error(`Live demo addresses must start with the "${LIVE_DEMO_EMAIL_LOCAL_PREFIX}" prefix so they read as obviously synthetic in any list.`);
  }
  return email;
}

import { makeSession, makeSessionForTenant } from "./billing-session";
import type { Tenant } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createUser, grantPermission } from "./fixtures";
import type { AuthenticatedSession } from "@/lib/auth/session";

/** Full permission set an Investigation Manager persona needs across the investigation surface (mirrors Security Supervisor / Approving Manager's Phase 11 grants in prisma/seed.ts). */
export const MANAGER_PERMISSIONS: Array<[string, string]> = [
  ["investigationCase", "VIEW"],
  ["investigationCase", "CREATE"],
  ["investigationCase", "EDIT"],
  ["investigationConfidentialAccess", "VIEW"],
  ["investigationSubject", "EDIT"],
  ["investigationEvidence", "VIEW"],
  ["investigationEvidence", "CREATE"],
  ["investigationEvidence", "EXPORT"],
  ["investigationNote", "CREATE"],
  ["investigationNote", "VIEW"],
  ["investigationTask", "CREATE"],
  ["investigationTask", "EDIT"],
  ["investigationFinding", "APPROVE"],
  ["investigationFinding", "REJECT"],
  ["investigationHold", "CONFIGURE"],
  ["investigationReport", "CREATE"],
  ["investigationReport", "EXPORT"],
  ["investigationCaseClosure", "APPROVE"],
  ["investigationCaseClosure", "REJECT"],
  ["externalAuditorAccess", "VIEW"],
  ["externalAuditorAccess", "CREATE"],
  ["externalAuditorAccess", "DELETE"],
];

/** Mirrors Internal Investigator / Auditor's Phase 11 grants — can create/edit/record findings but not approve/close/grant-external. */
export const INVESTIGATOR_PERMISSIONS: Array<[string, string]> = [
  ["investigationCase", "VIEW"],
  ["investigationCase", "CREATE"],
  ["investigationCase", "EDIT"],
  ["investigationConfidentialAccess", "VIEW"],
  ["investigationSubject", "EDIT"],
  ["investigationEvidence", "VIEW"],
  ["investigationEvidence", "CREATE"],
  ["investigationEvidence", "EXPORT"],
  ["investigationNote", "CREATE"],
  ["investigationNote", "VIEW"],
  ["investigationTask", "CREATE"],
  ["investigationTask", "EDIT"],
  ["investigationFinding", "CREATE"],
  ["investigationFinding", "EDIT"],
  ["investigationReport", "CREATE"],
  ["investigationReport", "EXPORT"],
];

/** Mirrors Gate Security Officer/Dispatch's Phase 11 grant — referral-only, nothing else. */
export const REFERRER_PERMISSIONS: Array<[string, string]> = [["investigationReferral", "CREATE"]];

/** Mirrors Company Administrator's Phase 11 grant — settings/oversight/holds/external-access-management. */
export const ADMIN_PERMISSIONS: Array<[string, string]> = [
  ["investigationCase", "VIEW"],
  ["investigationCase", "CONFIGURE"],
  ["investigationConfidentialAccess", "VIEW"],
  ["investigationHold", "CONFIGURE"],
  ["externalAuditorAccess", "VIEW"],
  ["externalAuditorAccess", "CREATE"],
  ["externalAuditorAccess", "DELETE"],
];

/** Mirrors External Auditor (Case-Scoped)'s Phase 11 grant — nothing beyond the portal permission itself; every real boundary is the ExternalAuditorAccessGrant. */
export const EXTERNAL_AUDITOR_PERMISSIONS: Array<[string, string]> = [
  ["externalAuditorPortal", "VIEW"],
  ["externalAuditorPortal", "EXPORT"],
];

export async function makeManagerSession() {
  return makeSession("Investigation Manager", MANAGER_PERMISSIONS);
}

export async function makeInvestigatorSessionForTenant(tenant: Tenant) {
  return makeSessionForTenant(tenant, "Internal Investigator", INVESTIGATOR_PERMISSIONS);
}

export async function makeManagerSessionForTenant(tenant: Tenant) {
  return makeSessionForTenant(tenant, "Investigation Manager", MANAGER_PERMISSIONS);
}

export async function makeReferrerSessionForTenant(tenant: Tenant) {
  return makeSessionForTenant(tenant, "Referrer", REFERRER_PERMISSIONS);
}

export async function makeAdminSessionForTenant(tenant: Tenant) {
  return makeSessionForTenant(tenant, "Company Administrator", ADMIN_PERMISSIONS);
}

export async function makeExternalAuditorSessionForTenant(tenant: Tenant) {
  const roleName = "External Auditor (Case-Scoped)";
  const role = await prisma.role.create({ data: { tenantId: tenant.id, name: roleName } });
  for (const [resource, action] of EXTERNAL_AUDITOR_PERMISSIONS) await grantPermission(role.id, resource, action);
  const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  const session: AuthenticatedSession = {
    sessionId: "n/a",
    tenantId: tenant.id,
    userId: user.id,
    roleId: role.id,
    roleName,
    userStatus: "ACTIVE",
    tenantStatus: "ACTIVE",
  };
  return { role, user, session };
}

export async function makeNoPermissionSessionForTenant(tenant: Tenant) {
  return makeSessionForTenant(tenant, "No Permissions", []);
}

export interface LoginCandidate {
  status: string;
  tenant: { status: string };
}

/**
 * Pure gate for "may this user start a new session at all", separate from
 * password correctness. Centralised so login and accept-invitation can't
 * independently forget one of the checks — a real bug found in manual
 * testing: login originally checked only user.status, letting a user of a
 * SUSPENDED tenant start a brand-new session even though getSession() would
 * already reject an *existing* one for the same tenant.
 */
export function isEligibleToAuthenticate(candidate: LoginCandidate): boolean {
  return candidate.status === "ACTIVE" && candidate.tenant.status === "ACTIVE";
}

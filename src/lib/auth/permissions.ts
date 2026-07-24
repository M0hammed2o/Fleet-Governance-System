/**
 * Central catalogue of (resource, action) pairs. This is the single source of
 * truth for both the seed script (which creates matching Permission rows) and
 * any code that references a permission by name — so a typo can't silently
 * create an unenforceable permission string.
 *
 * Only resources that exist as of the current phase are listed. Later phases
 * (driver, vehicle, movement, gateEvent, evidence, risk, control, ...) add
 * their own entries here alongside the migration that introduces the entity —
 * see TODO.md for the phase plan.
 */

export const PERMISSION_ACTIONS = [
  "VIEW",
  "CREATE",
  "EDIT",
  "DELETE",
  "APPROVE",
  "REJECT",
  "EXPORT",
  "AUDIT",
  "CONFIGURE",
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

// Cross-tenant resource, only ever granted within the system "platform" tenant.
// Ordinary tenant-scoped roles must never be granted platformTenant permissions.
const PLATFORM_TENANT_ACTIONS = ["VIEW", "CREATE", "EDIT", "CONFIGURE"] as const;

const TENANT_ACTIONS = ["VIEW", "CONFIGURE"] as const;
const SITE_ACTIONS = ["VIEW", "CREATE", "EDIT", "DELETE", "CONFIGURE"] as const;
const GATE_ACTIONS = ["VIEW", "CREATE", "EDIT", "DELETE", "CONFIGURE"] as const;
const USER_ACTIONS = ["VIEW", "CREATE", "EDIT", "DELETE", "CONFIGURE"] as const;
const ROLE_ACTIONS = ["VIEW", "CREATE", "EDIT", "DELETE", "CONFIGURE"] as const;
const AUDIT_LOG_ACTIONS = ["VIEW", "EXPORT"] as const;

// Phase 2 — master data (PRODUCT_REQUIREMENTS.md MD-001..006)
const DRIVER_ACTIONS = ["VIEW", "CREATE", "EDIT", "DELETE", "EXPORT"] as const;
const VEHICLE_ACTIONS = ["VIEW", "CREATE", "EDIT", "DELETE", "EXPORT"] as const;
const COMPLIANCE_DOCUMENT_ACTIONS = ["VIEW", "CREATE", "EDIT", "DELETE", "AUDIT"] as const;
const TYRE_CONFIG_ACTIONS = ["VIEW", "CREATE", "EDIT", "DELETE", "CONFIGURE"] as const;
// EDIT covers draft/submit/cancel by the requester; APPROVE/REJECT are the
// distinct approval-workflow actions, deliberately not folded into EDIT so
// "can edit a movement" and "can approve a movement" stay separately grantable.
const MOVEMENT_ACTIONS = ["VIEW", "CREATE", "EDIT", "DELETE", "APPROVE", "REJECT"] as const;
// Separate from "driver" so a Gate Security Officer can request a fallback
// (CREATE) without needing driver:EDIT, and a supervisor can resolve one
// (APPROVE/REJECT) without needing broader driver-management rights.
const FACIAL_VERIFICATION_FALLBACK_ACTIONS = ["VIEW", "CREATE", "APPROVE", "REJECT"] as const;

// Phase 3 — gate operations (PRODUCT_REQUIREMENTS.md GATE-001..006)
// gateEvent covers the officer's own normal flow end-to-end (start, identity
// verification, guided inspection, clear/deny, cancel) — EDIT deliberately
// stays broad here the same way movement:EDIT covers draft/submit/cancel,
// because every state transition is independently guarded by the state
// machine and self-approval rules live one level down on `exception`, not
// here. There is no gateEvent:APPROVE — the meaningful approval boundary for
// gate operations is resolving a *serious* exception, not the gate event
// itself, see `exception` below.
const GATE_EVENT_ACTIONS = ["VIEW", "CREATE", "EDIT"] as const;
// Company Administrator / Security Supervisor manage the checklist itself.
const INSPECTION_TEMPLATE_ACTIONS = ["VIEW", "CREATE", "EDIT", "DELETE", "CONFIGURE"] as const;
// CREATE = an officer raising an exception during inspection; APPROVE =
// resolving one, in particular the supervisor-approval path — deliberately
// not granted to the same role as CREATE (see seed.ts "Gate Security
// Officer" vs "Security Supervisor / Approving Manager") so the
// self-approval rule (gate-event-repository.ts, hard rule, not
// tenant-configurable — see DECISIONS.md) is meaningfully testable, not
// vacuous. CONFIGURE manages the tenant's ExceptionType catalogue (the
// DocumentExpiryRule-equivalent tenant-configurable rule set for exceptions).
const EXCEPTION_ACTIONS = ["VIEW", "CREATE", "APPROVE", "CONFIGURE"] as const;

// Phase 4 — evidence/media (PRODUCT_REQUIREMENTS.md EVID-001..004). VIEW here
// governs minting a signed read URL for a specific MediaAsset (permission
// checked, then tenant-matched — see mintSignedUrlForMediaAsset()); CREATE
// governs uploading. Deliberately no EDIT — evidence is immutable once
// uploaded, same append-only spirit as AuditLog. No DELETE yet either
// (hard-delete is reserved for a future POPIA-erasure mechanism, see
// DATA_MODEL.md "Record lifecycle notes" — out of scope this phase).
const MEDIA_ASSET_ACTIONS = ["VIEW", "CREATE"] as const;

// Phase 5B — reconciliation (PRODUCT_REQUIREMENTS.md RECON-001..003). CREATE
// covers manually (re)triggering the pairing/build step — the common path is
// automatic (completeGateEvent), this is only for a manual retry. EDIT covers
// adding an explanation/corrective-action note; APPROVE covers resolving a
// discrepancy — kept as two separate grantable actions the same way
// exception:CREATE vs exception:APPROVE are, so "who reviews" and "who signs
// off" can be different roles.
const RECONCILIATION_ACTIONS = ["VIEW", "CREATE", "EDIT", "APPROVE"] as const;

// Phase 6 — telematics foundation (PRODUCT_REQUIREMENTS.md GPS-001..006).
// VIEW covers reading vehicle position/status/events; CREATE covers
// triggering a manual provider sync and requesting a manual GPS confirmation
// (mirrors facialVerificationFallback:CREATE); APPROVE covers resolving a
// manual GPS confirmation or a telematics-raised Exception (mirrors
// facialVerificationFallback:APPROVE / exception:APPROVE); CONFIGURE manages
// the tenant's Geofence catalogue.
const TELEMATICS_ACTIONS = ["VIEW", "CREATE", "APPROVE", "CONFIGURE"] as const;
// Phase 6 — vehicle-use policies (POLICY-001/002). CREATE/EDIT is drafting;
// APPROVE is the named approving manager moving DRAFT -> ACTIVE.
const VEHICLE_USE_POLICY_ACTIONS = ["VIEW", "CREATE", "EDIT", "APPROVE"] as const;

// Phase 7 — platform support-access view (PRODUCT_REQUIREMENTS.md
// SUPPORT-001..004). Only ever granted within the system "platform" tenant
// (same rule as `platformTenant`, D-005) — an ordinary customer-tenant role
// must never receive this. VIEW covers the customer health-summary list and
// a session's own audit history; CREATE covers starting a support-access
// session and adding a support note; CONFIGURE covers the explicit elevation
// workflow (SUPPORT-003) — deliberately separate from CREATE so "can look"
// and "can request elevated access" are independently grantable.
const SUPPORT_ACCESS_SESSION_ACTIONS = ["VIEW", "CREATE", "CONFIGURE"] as const;

export const PERMISSION_CATALOGUE = {
  platformTenant: PLATFORM_TENANT_ACTIONS,
  tenant: TENANT_ACTIONS,
  site: SITE_ACTIONS,
  gate: GATE_ACTIONS,
  user: USER_ACTIONS,
  role: ROLE_ACTIONS,
  auditLog: AUDIT_LOG_ACTIONS,
  driver: DRIVER_ACTIONS,
  vehicle: VEHICLE_ACTIONS,
  complianceDocument: COMPLIANCE_DOCUMENT_ACTIONS,
  tyrePositionConfig: TYRE_CONFIG_ACTIONS,
  movement: MOVEMENT_ACTIONS,
  facialVerificationFallback: FACIAL_VERIFICATION_FALLBACK_ACTIONS,
  gateEvent: GATE_EVENT_ACTIONS,
  inspectionTemplate: INSPECTION_TEMPLATE_ACTIONS,
  exception: EXCEPTION_ACTIONS,
  mediaAsset: MEDIA_ASSET_ACTIONS,
  reconciliation: RECONCILIATION_ACTIONS,
  telematics: TELEMATICS_ACTIONS,
  vehicleUsePolicy: VEHICLE_USE_POLICY_ACTIONS,
  supportAccessSession: SUPPORT_ACCESS_SESSION_ACTIONS,
} as const;

export type PermissionResource = keyof typeof PERMISSION_CATALOGUE;

export function permissionKey(resource: string, action: string): string {
  return `${resource}:${action}`;
}

/** Flat list of every valid (resource, action) pair, for seeding. */
export function listAllPermissions(): Array<{ resource: PermissionResource; action: PermissionAction }> {
  const result: Array<{ resource: PermissionResource; action: PermissionAction }> = [];
  for (const resource of Object.keys(PERMISSION_CATALOGUE) as PermissionResource[]) {
    for (const action of PERMISSION_CATALOGUE[resource]) {
      result.push({ resource, action: action as PermissionAction });
    }
  }
  return result;
}

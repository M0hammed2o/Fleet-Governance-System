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
// uploaded. DELETE is narrowly authorized for the Phase 18A replace/remove
// workflow; the repository preserves structured chronology and audit history.
const MEDIA_ASSET_ACTIONS = ["VIEW", "CREATE", "DELETE"] as const;

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

// Phase 8C — retention, archive and deletion (PRODUCT_REQUIREMENTS.md
// RETAIN-001..010). CONFIGURE manages RetentionPolicy rules and
// legal-hold/investigation-hold flags and retention extensions; CREATE
// covers a Company Administrator initiating a deletion or export request;
// APPROVE is the deliberately separate second-authorised-user action that
// approves/rejects a deletion request — split from CREATE the same way
// movement/exception/reconciliation CREATE-vs-APPROVE already are, so
// "who asked" and "who signed off" can never be the same permission grant
// alone (the actual dual-control enforcement is a hard, user-id-based rule
// in the repository layer, same as D-008 — this permission split makes the
// boundary meaningfully testable, not the guarantee itself). EXPORT covers
// viewing/downloading a ready export manifest.
const RETENTION_ACTIONS = ["VIEW", "CREATE", "APPROVE", "CONFIGURE", "EXPORT"] as const;

// Phase 9C — driver biometric enrolment (PRODUCT_REQUIREMENTS.md FACE-001..009).
// Deliberately a separate resource from `driver`, not folded into
// driver:EDIT — enrolling a biometric template is a materially more
// sensitive action than editing ordinary driver master data, and this
// codebase's convention is that sensitive actions get their own,
// separately-grantable permission (see `retention`'s own split from
// `mediaAsset`, and `facialVerificationFallback`'s split from `driver`).
// CREATE covers enrol/re-enrol; VIEW covers seeing enrolment *status* only
// (never the template itself — no route ever returns template bytes, see
// SECURITY_AND_POPIA.md); DELETE covers revocation. A "restricted role" per
// the build brief means only Company Administrator holds this in the seed
// data (prisma/seed.ts) — every other role has none of these three.
const FACIAL_TEMPLATE_ACTIONS = ["VIEW", "CREATE", "DELETE"] as const;

// Phase 9D/9E — one-to-one facial verification attempts at the gate
// (PRODUCT_REQUIREMENTS.md FACE-001..009). VIEW covers seeing the audit
// trail of past attempts; CREATE covers a Gate Security Officer running a
// new verification attempt during check-in/check-out.
const FACIAL_VERIFICATION_ATTEMPT_ACTIONS = ["VIEW", "CREATE"] as const;

// Phase 10 — subscriptions, billing and invoicing (PRODUCT_REQUIREMENTS.md
// P10A..P10P). Deliberately split into narrow resources (the same
// "who asked vs who signed off" / "least privilege" convention as
// `retention`/`exception`/`movement` above) rather than one broad `billing`
// resource, so a role like Accountant can hold exactly the tenant-side
// slice it needs without also getting platform-wide or pricing-negotiation
// rights, and Security Guard/Dispatch roles can hold none of it at all
// (P10J "should not receive unnecessary billing permissions").
//
// tenantBilling: the tenant's own billing profile/contacts (P10C). VIEW =
// see it; EDIT = update contact/registration details (not pricing, which is
// its own resource below and platform-controlled).
const TENANT_BILLING_ACTIONS = ["VIEW", "EDIT"] as const;
// pricingAgreement: tenant-specific negotiated pricing (P10B/I) — platform
// Administrator only in the seed data; never granted to a customer-tenant
// role, since pricing negotiation is a platform-commercial decision.
const PRICING_AGREEMENT_ACTIONS = ["VIEW", "EDIT"] as const;
// invoice: VIEW covers seeing/downloading an invoice (mirrors mediaAsset:
// VIEW covering signed-URL mint, D-014); CREATE covers generating a new
// invoice (the recurring job, or a platform admin's manual
// generate/void/reissue); EDIT covers void/reissue/correction actions
// distinct from ordinary generation.
const INVOICE_ACTIONS = ["VIEW", "CREATE", "EDIT"] as const;
// payment: VIEW covers seeing payment/payment-attempt history; CREATE
// covers both a customer Accountant initiating a self-service
// provider/mock payment AND an authorised platform finance user recording
// a manual payment (two different call sites, same permission key — the
// business logic, not the permission grant, is what distinguishes a
// MANUAL-method payment's extra requirements, same pattern as
// reconciliation:APPROVE being held by a different role than
// reconciliation:CREATE for a different purpose).
const PAYMENT_ACTIONS = ["VIEW", "CREATE"] as const;
// billingEmail: VIEW covers seeing delivery history; CREATE covers
// requesting an authorised resend.
const BILLING_EMAIL_ACTIONS = ["VIEW", "CREATE"] as const;
// tenantSubscription: VIEW covers seeing subscription/access status;
// CONFIGURE covers suspending/restoring access — deliberately separate from
// tenantBilling so "can see my subscription" (Accountant/Company
// Administrator) and "can suspend/restore a tenant" (Platform Administrator
// only) are independently grantable.
const TENANT_SUBSCRIPTION_ACTIONS = ["VIEW", "CONFIGURE"] as const;
// platformBilling: platform-wide billing dashboard/configuration
// (P10B/P10I) — Platform Administrator only, never Platform Support Analyst
// (billing operations are a first-class platform-admin function, not a
// support-access-session concern — mirrors platformTenant, D-005).
const PLATFORM_BILLING_ACTIONS = ["VIEW", "CONFIGURE"] as const;

// Phase 11 — investigation, internal review and external audit case
// management (PRODUCT_REQUIREMENTS.md P11A..P11T). Split into narrow
// resources (the same convention as Phase 10's billing split) so a broad
// referring role (Gate Security Officer/Dispatch) can hold exactly
// `investigationReferral:CREATE` and nothing else, and an investigator vs. an
// approving manager can hold genuinely different slices — see
// prisma/seed.ts for the actual per-role grants and the reasoning behind
// which role gets which resource.
//
// investigationCase: VIEW covers seeing non-confidential case list/detail;
// CREATE covers manually opening a case; EDIT covers triage/assign/
// reassign/severity/link-records/status transitions short of closing or
// reopening (those are their own resource below so separation-of-duties is
// meaningfully testable, not vacuous); CONFIGURE manages
// TenantInvestigationSettings (case-number prefix, separation-of-duties
// policy toggle).
const INVESTIGATION_CASE_ACTIONS = ["VIEW", "CREATE", "EDIT", "CONFIGURE"] as const;
// investigationReferral: the narrow permission a wide, low-privilege role
// (Gate Security Officer/Dispatch) can hold to raise a case referral from an
// exception/inspection-failure/discrepancy they encounter, without any
// other investigation visibility (P11K "may refer but not automatically get
// confidential access").
const INVESTIGATION_REFERRAL_ACTIONS = ["CREATE"] as const;
// investigationConfidentialAccess: a second gate on top of
// investigationCase:VIEW — without this, a case's confidential content
// (RESTRICTED/HIGHLY_RESTRICTED notes, subject explanation/response) is
// withheld even from a role that can otherwise see the case (P11E).
const INVESTIGATION_CONFIDENTIAL_ACCESS_ACTIONS = ["VIEW"] as const;
// investigationSubject: linking/updating subjects (add/link a subject,
// record a subject's explanation/response) — a distinct grantable action
// from ordinary case editing, since subject handling carries the fairness
// requirements in P11E.
const INVESTIGATION_SUBJECT_ACTIONS = ["EDIT"] as const;
// investigationEvidence: VIEW = see the evidence manifest; CREATE = link/
// upload evidence and mark an item entered-in-error; EXPORT = download an
// evidence file's signed URL (mirrors mediaAsset:VIEW's role for signed-URL
// minting, kept separate here so evidence access is independently
// auditable from ordinary case evidence-listing).
const INVESTIGATION_EVIDENCE_ACTIONS = ["VIEW", "CREATE", "EXPORT"] as const;
// investigationNote: CREATE = add a note or an amendment/correction record;
// VIEW = see RESTRICTED/HIGHLY_RESTRICTED notes specifically (STANDARD
// notes are visible with investigationCase:VIEW alone).
const INVESTIGATION_NOTE_ACTIONS = ["CREATE", "VIEW"] as const;
// investigationTask: CREATE = create/assign a task; EDIT = update status/
// completion note as the assignee or case owner.
const INVESTIGATION_TASK_ACTIONS = ["CREATE", "EDIT"] as const;
// investigationFinding: CREATE = record findings/recommendations/corrective
// actions and submit for approval; EDIT = amend a returned finding into a
// new version; APPROVE/REJECT = the separate sign-off actions — kept apart
// from CREATE the same way exception/reconciliation/retention already
// split "who asked" from "who signed off", and enforced further by the
// hard same-actor check in investigation-approval-repository.ts (not by
// this permission split alone).
const INVESTIGATION_FINDING_ACTIONS = ["CREATE", "EDIT", "APPROVE", "REJECT"] as const;
// investigationHold: CONFIGURE = place/release the case-level evidence hold
// — deliberately its own resource (not folded into investigationCase:EDIT)
// since releasing a hold is the one action that can weaken a retention
// safeguard, so it must be independently grantable/auditable (P11G).
const INVESTIGATION_HOLD_ACTIONS = ["CONFIGURE"] as const;
// investigationReport: CREATE = generate a new report PDF version; EXPORT =
// download an existing report's signed URL.
const INVESTIGATION_REPORT_ACTIONS = ["CREATE", "EXPORT"] as const;
// investigationCaseClosure: APPROVE = close a case (the authorised closing
// action, separate from investigationCase:EDIT so "who investigates/edits"
// and "who closes" can be different roles — P11D separation of duties);
// REJECT = reopen a closed case (reuses REJECT as "reverse a finalised
// decision", the same semantic direction REJECT already has for
// deletion-request/movement approvals elsewhere in this codebase).
const INVESTIGATION_CASE_CLOSURE_ACTIONS = ["APPROVE", "REJECT"] as const;
// externalAuditorAccess: the internal-facing management of a grant — CREATE
// = grant access; DELETE = revoke; VIEW = list/see grants and their audit
// history. Only ever held by a role authorised to manage external access
// (P11L), never by the External Auditor themselves.
const EXTERNAL_AUDITOR_ACCESS_ACTIONS = ["VIEW", "CREATE", "DELETE"] as const;
// externalAuditorPortal: the restricted, case-scoped read surface an
// External Auditor role itself holds — VIEW = see a case they have an
// active grant for; EXPORT = download its report/evidence if the specific
// grant allows it. Holding this permission is necessary but not
// sufficient: every route also re-checks a live, non-expired, non-revoked
// ExternalAuditorAccessGrant naming the exact case ID (P11L, P11O).
const EXTERNAL_AUDITOR_PORTAL_ACTIONS = ["VIEW", "EXPORT"] as const;

// Phase 12 — deterministic governance analytics. VIEW is deliberately
// separate from indicator review/configuration/export so executive oversight
// does not imply the ability to change rules or dispose of review items.
const GOVERNANCE_ANALYTICS_ACTIONS = ["VIEW"] as const;
const ANALYTICS_INDICATOR_ACTIONS = ["VIEW", "EDIT", "CREATE"] as const;
const ANALYTICS_RULE_ACTIONS = ["VIEW", "CONFIGURE"] as const;
const ANALYTICS_EXPORT_ACTIONS = ["EXPORT"] as const;

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
  retention: RETENTION_ACTIONS,
  facialTemplate: FACIAL_TEMPLATE_ACTIONS,
  facialVerificationAttempt: FACIAL_VERIFICATION_ATTEMPT_ACTIONS,
  tenantBilling: TENANT_BILLING_ACTIONS,
  pricingAgreement: PRICING_AGREEMENT_ACTIONS,
  invoice: INVOICE_ACTIONS,
  payment: PAYMENT_ACTIONS,
  billingEmail: BILLING_EMAIL_ACTIONS,
  tenantSubscription: TENANT_SUBSCRIPTION_ACTIONS,
  platformBilling: PLATFORM_BILLING_ACTIONS,
  investigationCase: INVESTIGATION_CASE_ACTIONS,
  investigationReferral: INVESTIGATION_REFERRAL_ACTIONS,
  investigationConfidentialAccess: INVESTIGATION_CONFIDENTIAL_ACCESS_ACTIONS,
  investigationSubject: INVESTIGATION_SUBJECT_ACTIONS,
  investigationEvidence: INVESTIGATION_EVIDENCE_ACTIONS,
  investigationNote: INVESTIGATION_NOTE_ACTIONS,
  investigationTask: INVESTIGATION_TASK_ACTIONS,
  investigationFinding: INVESTIGATION_FINDING_ACTIONS,
  investigationHold: INVESTIGATION_HOLD_ACTIONS,
  investigationReport: INVESTIGATION_REPORT_ACTIONS,
  investigationCaseClosure: INVESTIGATION_CASE_CLOSURE_ACTIONS,
  externalAuditorAccess: EXTERNAL_AUDITOR_ACCESS_ACTIONS,
  externalAuditorPortal: EXTERNAL_AUDITOR_PORTAL_ACTIONS,
  governanceAnalytics: GOVERNANCE_ANALYTICS_ACTIONS,
  analyticsIndicator: ANALYTICS_INDICATOR_ACTIONS,
  analyticsRule: ANALYTICS_RULE_ACTIONS,
  analyticsExport: ANALYTICS_EXPORT_ACTIONS,
} as const;

export type PermissionResource = keyof typeof PERMISSION_CATALOGUE;
export type PermissionKey = `${PermissionResource}:${PermissionAction}`;

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

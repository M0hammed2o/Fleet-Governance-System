import type { PermissionAction, PermissionResource } from "./permissions";

export type RolePermissionSpec = { resource: PermissionResource; action: PermissionAction }[];

// Tenant-scoped roles. As of 2026-07-23 this maps onto the six primary
// customer roles + three additional non-daily profiles specified by the
// user (see DECISIONS.md D-015 and WORKLOG.md Session 6/7 for the full
// mapping rationale from the original 8-role set). Resources introduced in
// later phases (telematics, vehicleUsePolicy, supportAccessSession, ...)
// will extend these mappings as each module lands — see TODO.md.
//
// Extracted out of prisma/seed.ts (2026-08-25) so any script that needs the
// canonical per-role permission grants — not just the dev/demo seed — can
// import this data without triggering that script's own top-level side
// effects (it creates a PrismaClient and calls main() unconditionally on
// import).
export const TENANT_ROLE_DEFINITIONS: Record<string, { description: string; permissions: RolePermissionSpec }> = {
  // --- Primary role 1/6 ---
  "Company Administrator": {
    description: "Configures the company, sites, gates, users and operational policy. Full oversight visibility. Cannot silently alter immutable gate evidence (view-only on media).",
    permissions: [
      { resource: "site", action: "VIEW" }, { resource: "site", action: "CREATE" }, { resource: "site", action: "EDIT" }, { resource: "site", action: "DELETE" }, { resource: "site", action: "CONFIGURE" },
      { resource: "gate", action: "VIEW" }, { resource: "gate", action: "CREATE" }, { resource: "gate", action: "EDIT" }, { resource: "gate", action: "DELETE" }, { resource: "gate", action: "CONFIGURE" },
      { resource: "user", action: "VIEW" }, { resource: "user", action: "CREATE" }, { resource: "user", action: "EDIT" }, { resource: "user", action: "DELETE" }, { resource: "user", action: "CONFIGURE" },
      { resource: "role", action: "VIEW" }, { resource: "role", action: "CREATE" }, { resource: "role", action: "EDIT" }, { resource: "role", action: "DELETE" }, { resource: "role", action: "CONFIGURE" },
      { resource: "tenant", action: "VIEW" }, { resource: "tenant", action: "CONFIGURE" },
      { resource: "auditLog", action: "VIEW" },
      { resource: "driver", action: "VIEW" }, { resource: "driver", action: "CREATE" }, { resource: "driver", action: "EDIT" }, { resource: "driver", action: "DELETE" }, { resource: "driver", action: "EXPORT" },
      { resource: "vehicle", action: "VIEW" }, { resource: "vehicle", action: "CREATE" }, { resource: "vehicle", action: "EDIT" }, { resource: "vehicle", action: "DELETE" }, { resource: "vehicle", action: "EXPORT" },
      { resource: "movement", action: "VIEW" },
      { resource: "complianceDocument", action: "VIEW" }, { resource: "complianceDocument", action: "CREATE" }, { resource: "complianceDocument", action: "EDIT" }, { resource: "complianceDocument", action: "DELETE" }, { resource: "complianceDocument", action: "AUDIT" },
      { resource: "tyrePositionConfig", action: "VIEW" }, { resource: "tyrePositionConfig", action: "CREATE" }, { resource: "tyrePositionConfig", action: "EDIT" }, { resource: "tyrePositionConfig", action: "DELETE" }, { resource: "tyrePositionConfig", action: "CONFIGURE" },
      { resource: "facialVerificationFallback", action: "VIEW" }, { resource: "facialVerificationFallback", action: "APPROVE" }, { resource: "facialVerificationFallback", action: "REJECT" },
      { resource: "gateEvent", action: "VIEW" },
      { resource: "inspectionTemplate", action: "VIEW" }, { resource: "inspectionTemplate", action: "CREATE" }, { resource: "inspectionTemplate", action: "EDIT" }, { resource: "inspectionTemplate", action: "DELETE" }, { resource: "inspectionTemplate", action: "CONFIGURE" },
      { resource: "exception", action: "VIEW" }, { resource: "exception", action: "CONFIGURE" },
      // Oversight visibility only — Company Administrator doesn't personally
      // capture gate/driver/document evidence.
      { resource: "mediaAsset", action: "VIEW" }, { resource: "mediaAsset", action: "CREATE" }, { resource: "mediaAsset", action: "DELETE" },
      { resource: "reconciliation", action: "VIEW" },
      { resource: "telematics", action: "VIEW" },
      { resource: "vehicleUsePolicy", action: "VIEW" },
      // Company Administrator configures retention policy/holds and
      // initiates deletion/export requests, but never APPROVEs its own
      // deletion request — that's the deliberately separate second
      // authorised user (Security Supervisor / Approving Manager, below).
      { resource: "retention", action: "VIEW" }, { resource: "retention", action: "CREATE" }, { resource: "retention", action: "CONFIGURE" }, { resource: "retention", action: "EXPORT" },
      // Phase 9C — the one "restricted role" that may enrol/re-enrol/revoke
      // a driver's biometric template; no other role in this seed holds any
      // facialTemplate permission at all. Oversight-only VIEW on the
      // verification-attempt audit trail (does not personally run
      // verification attempts at the gate — that's Gate Security Officer).
      { resource: "facialTemplate", action: "VIEW" }, { resource: "facialTemplate", action: "CREATE" }, { resource: "facialTemplate", action: "DELETE" },
      { resource: "facialVerificationAttempt", action: "VIEW" },
      // Phase 10 — oversight visibility only, same posture as mediaAsset
      // above: sees the company's own billing/subscription/invoice status
      // but does not manage negotiated pricing or record payments (that's
      // Accountant / Finance and Compliance Officer, below).
      { resource: "tenantBilling", action: "VIEW" },
      { resource: "invoice", action: "VIEW" },
      { resource: "tenantSubscription", action: "VIEW" },
      // Phase 11 (P11M) — "Company Administrator manages config/authorised
      // access": configures TenantInvestigationSettings and manages who has
      // external-auditor access, plus oversight VIEW/confidential VIEW; can
      // release an investigation hold (paired with Security Supervisor /
      // Approving Manager below so dual-authorisation is possible for
      // high-severity holds, P11G). Deliberately no CREATE/EDIT on cases day
      // to day, and no finding APPROVE/closure — that is the Internal
      // Investigator / Auditor + Security Supervisor split below.
      { resource: "investigationCase", action: "VIEW" }, { resource: "investigationCase", action: "CONFIGURE" },
      { resource: "investigationConfidentialAccess", action: "VIEW" },
      { resource: "investigationHold", action: "CONFIGURE" },
      { resource: "externalAuditorAccess", action: "VIEW" }, { resource: "externalAuditorAccess", action: "CREATE" }, { resource: "externalAuditorAccess", action: "DELETE" },
      // Phase 12 — company-wide governance oversight and configuration.
      { resource: "governanceAnalytics", action: "VIEW" },
      { resource: "analyticsIndicator", action: "VIEW" }, { resource: "analyticsIndicator", action: "EDIT" }, { resource: "analyticsIndicator", action: "CREATE" },
      { resource: "analyticsRule", action: "VIEW" }, { resource: "analyticsRule", action: "CONFIGURE" },
      { resource: "analyticsExport", action: "EXPORT" },
    ],
  },
  // --- Primary role 2/6 — new, carved out of the old "Fleet Manager"'s
  // movement duties. Plans/creates/submits movements; never approves its own
  // (no movement:APPROVE/REJECT at all — segregation of duties is structural,
  // not just a runtime self-approval check). ---
  "Dispatch and Logistics Officer": {
    description: "Plans deliveries, collections and other movements: assigns driver/vehicle, records destination/customer/purpose/sender/recipient/references, uploads delivery notes, submits for approval. Cannot approve movements.",
    permissions: [
      { resource: "site", action: "VIEW" }, { resource: "gate", action: "VIEW" },
      { resource: "driver", action: "VIEW" }, { resource: "vehicle", action: "VIEW" },
      { resource: "movement", action: "VIEW" }, { resource: "movement", action: "CREATE" }, { resource: "movement", action: "EDIT" },
      { resource: "gateEvent", action: "VIEW" },
      // Uploads delivery notes / supporting movement documents directly
      // (Phase 5C — MediaAsset-backed, not a public URL).
      { resource: "mediaAsset", action: "VIEW" }, { resource: "mediaAsset", action: "CREATE" },
      { resource: "reconciliation", action: "VIEW" },
      { resource: "telematics", action: "VIEW" },
      { resource: "vehicleUsePolicy", action: "VIEW" },
      // Phase 11 (P11K/M) — "Security Guard/Dispatch may refer but not
      // automatically get confidential access": the one narrow permission
      // this role holds for investigations, nothing else.
      { resource: "investigationReferral", action: "CREATE" },
    ],
  },
  // --- Primary role 3/6 — unchanged from the original 8-role set. ---
  "Gate Security Officer": {
    description: "Retrieves approved movements, verifies the driver, performs entry/exit inspections, captures readings/photographs/video, raises exceptions. Cannot approve its own serious exception; cannot edit financial data (no complianceDocument/movement write access at all).",
    permissions: [
      { resource: "site", action: "VIEW" },
      { resource: "gate", action: "VIEW" },
      // Read-only against master data — gate security confirms against the
      // already-approved record, never edits driver/vehicle/movement data.
      { resource: "driver", action: "VIEW" }, { resource: "vehicle", action: "VIEW" }, { resource: "movement", action: "VIEW" },
      { resource: "facialVerificationFallback", action: "VIEW" }, { resource: "facialVerificationFallback", action: "CREATE" },
      // Runs one-to-one facial verification attempts at the gate (Phase
      // 9D) — deliberately no facialTemplate grant at all: this role can
      // run a match against the one driver's existing template, never
      // enrol/re-enrol/revoke one (that's Company Administrator only).
      { resource: "facialVerificationAttempt", action: "VIEW" }, { resource: "facialVerificationAttempt", action: "CREATE" },
      // Runs the gate check-in/check-out flow end-to-end (start, inspect,
      // clear/deny normal cases) but cannot resolve a serious exception —
      // no exception:APPROVE. See "Security Supervisor / Approving Manager".
      { resource: "gateEvent", action: "VIEW" }, { resource: "gateEvent", action: "CREATE" }, { resource: "gateEvent", action: "EDIT" },
      { resource: "inspectionTemplate", action: "VIEW" },
      { resource: "exception", action: "VIEW" }, { resource: "exception", action: "CREATE" },
      // Captures walk-around/inspection-item evidence during their own gate
      // event (build brief EVID item 3).
      { resource: "mediaAsset", action: "VIEW" }, { resource: "mediaAsset", action: "CREATE" },
      // Can manually retry pairing (reconciliation:CREATE) if the automatic
      // completeGateEvent build didn't fire yet; resolution is the
      // supervisor's job (see "Security Supervisor / Approving Manager").
      { resource: "reconciliation", action: "VIEW" }, { resource: "reconciliation", action: "CREATE" },
      // Requests manual GPS confirmation when the (mock) provider is offline
      // (GPS-002) — resolution is the supervisor's job.
      { resource: "telematics", action: "VIEW" }, { resource: "telematics", action: "CREATE" },
      { resource: "vehicleUsePolicy", action: "VIEW" },
      // Phase 11 (P11K/M) — same narrow referral-only grant as Dispatch and
      // Logistics Officer, nothing more.
      { resource: "investigationReferral", action: "CREATE" },
    ],
  },
  // --- Primary role 4/6 — merge of the old "Security Manager" (gate
  // exception/checklist oversight) and "Approving Manager" (movement
  // approval), per the user's explicit role spec. Gate CONFIGURE moved to
  // Company Administrator (see DECISIONS.md D-015) rather than staying here. ---
  "Security Supervisor / Approving Manager": {
    description: "Approves/rejects submitted movements, reviews and resolves gate exceptions, approves manual facial-verification fallback, reviews security dashboards. Cannot rewrite original evidence (view-only on media).",
    permissions: [
      { resource: "site", action: "VIEW" }, { resource: "gate", action: "VIEW" },
      { resource: "user", action: "VIEW" },
      { resource: "driver", action: "VIEW" }, { resource: "vehicle", action: "VIEW" },
      { resource: "movement", action: "VIEW" }, { resource: "movement", action: "APPROVE" }, { resource: "movement", action: "REJECT" },
      { resource: "facialVerificationFallback", action: "VIEW" }, { resource: "facialVerificationFallback", action: "APPROVE" }, { resource: "facialVerificationFallback", action: "REJECT" },
      { resource: "gateEvent", action: "VIEW" },
      // Owns the inspection checklist and exception-type catalogue, and is
      // the intended supervisor who resolves serious exceptions raised by a
      // Gate Security Officer — deliberately not the same role that has
      // exception:CREATE, so the self-approval rule and the
      // unauthorised-approval boundary are both meaningfully testable.
      { resource: "inspectionTemplate", action: "VIEW" }, { resource: "inspectionTemplate", action: "CREATE" }, { resource: "inspectionTemplate", action: "EDIT" }, { resource: "inspectionTemplate", action: "CONFIGURE" },
      { resource: "exception", action: "VIEW" }, { resource: "exception", action: "APPROVE" }, { resource: "exception", action: "CONFIGURE" },
      { resource: "mediaAsset", action: "VIEW" },
      // Primary owner of reconciliation review/resolution (RECON-002),
      // mirroring their exception:APPROVE ownership.
      { resource: "reconciliation", action: "VIEW" }, { resource: "reconciliation", action: "EDIT" }, { resource: "reconciliation", action: "APPROVE" },
      // Resolves manual GPS confirmations and telematics/policy exceptions
      // (GPS-002/GPS-005), and is the default named approving manager for
      // vehicle-use policies (POLICY-001).
      { resource: "telematics", action: "VIEW" }, { resource: "telematics", action: "APPROVE" },
      { resource: "vehicleUsePolicy", action: "VIEW" }, { resource: "vehicleUsePolicy", action: "APPROVE" },
      // The second authorised user for deletion requests (dual-control) —
      // deliberately not also granted retention:CREATE, so approving a
      // deletion request can never be the same role that initiated it.
      { resource: "retention", action: "VIEW" }, { resource: "retention", action: "APPROVE" },
      // Phase 11 (P11M) — this is the seed's "Investigation Manager" persona:
      // already the designated approving-manager role elsewhere (movement/
      // exception/reconciliation/retention), so approving findings, closing/
      // reopening cases, releasing holds and granting/revoking external
      // access sit here too — deliberately NOT the same role as "Internal
      // Investigator / Auditor" below, so "who investigates/records
      // findings" and "who approves/closes/grants external access" are
      // structurally different roles, not just a same-actor runtime check
      // (P11D separation of duties).
      { resource: "investigationCase", action: "VIEW" }, { resource: "investigationCase", action: "CREATE" }, { resource: "investigationCase", action: "EDIT" },
      { resource: "investigationConfidentialAccess", action: "VIEW" },
      { resource: "investigationSubject", action: "EDIT" },
      { resource: "investigationEvidence", action: "VIEW" }, { resource: "investigationEvidence", action: "CREATE" }, { resource: "investigationEvidence", action: "EXPORT" },
      { resource: "investigationNote", action: "CREATE" }, { resource: "investigationNote", action: "VIEW" },
      { resource: "investigationTask", action: "CREATE" }, { resource: "investigationTask", action: "EDIT" },
      { resource: "investigationFinding", action: "APPROVE" }, { resource: "investigationFinding", action: "REJECT" },
      { resource: "investigationHold", action: "CONFIGURE" },
      { resource: "investigationReport", action: "CREATE" }, { resource: "investigationReport", action: "EXPORT" },
      { resource: "investigationCaseClosure", action: "APPROVE" }, { resource: "investigationCaseClosure", action: "REJECT" },
      { resource: "externalAuditorAccess", action: "VIEW" }, { resource: "externalAuditorAccess", action: "CREATE" }, { resource: "externalAuditorAccess", action: "DELETE" },
      // Phase 12 — primary operational reviewer; may review/escalate but not
      // alter the tenant's rule thresholds.
      { resource: "governanceAnalytics", action: "VIEW" },
      { resource: "analyticsIndicator", action: "VIEW" }, { resource: "analyticsIndicator", action: "EDIT" }, { resource: "analyticsIndicator", action: "CREATE" },
      { resource: "analyticsRule", action: "VIEW" },
      { resource: "analyticsExport", action: "EXPORT" },
    ],
  },
  // --- Primary role 5/6 — renamed/refocused "Fleet Manager": keeps
  // driver/vehicle master-data ownership, loses movement CREATE/EDIT (that's
  // Dispatch and Logistics Officer's job now). Telematics/GPS permissions
  // are added here once that resource exists (Phase 6). ---
  "Fleet and GPS Manager": {
    description: "Maintains driver/vehicle master data, vehicle-to-tracker mappings, GPS provider connections and geofences/vehicle-use policies (Phase 6), reviews utilisation and trip history.",
    permissions: [
      { resource: "site", action: "VIEW" },
      { resource: "gate", action: "VIEW" },
      { resource: "driver", action: "VIEW" }, { resource: "driver", action: "CREATE" }, { resource: "driver", action: "EDIT" }, { resource: "driver", action: "DELETE" }, { resource: "driver", action: "EXPORT" },
      { resource: "vehicle", action: "VIEW" }, { resource: "vehicle", action: "CREATE" }, { resource: "vehicle", action: "EDIT" }, { resource: "vehicle", action: "DELETE" }, { resource: "vehicle", action: "EXPORT" },
      { resource: "complianceDocument", action: "VIEW" }, { resource: "complianceDocument", action: "CREATE" }, { resource: "complianceDocument", action: "EDIT" }, { resource: "complianceDocument", action: "DELETE" },
      { resource: "tyrePositionConfig", action: "VIEW" },
      // View-only on movements — reviews dispatch/utilisation but doesn't
      // create dispatch requests (see "Dispatch and Logistics Officer").
      { resource: "movement", action: "VIEW" },
      { resource: "gateEvent", action: "VIEW" },
      // Owns driver/vehicle master data, including portraits and compliance
      // document attachments — needs upload rights for those, not just
      // gate-side evidence (build brief EVID item 3).
      { resource: "mediaAsset", action: "VIEW" }, { resource: "mediaAsset", action: "CREATE" }, { resource: "mediaAsset", action: "DELETE" },
      // Reviews vehicle-condition-related discrepancies from a master-data
      // perspective (e.g. confirming pre-existing damage on file); final
      // sign-off stays with the supervisor (no reconciliation:APPROVE here).
      { resource: "reconciliation", action: "VIEW" }, { resource: "reconciliation", action: "EDIT" },
      // Owns GPS/tracker connections and the geofence/vehicle-use-policy
      // catalogue (role description above), per this role's Phase 6 scope.
      { resource: "telematics", action: "VIEW" }, { resource: "telematics", action: "CREATE" }, { resource: "telematics", action: "CONFIGURE" },
      { resource: "vehicleUsePolicy", action: "VIEW" }, { resource: "vehicleUsePolicy", action: "CREATE" }, { resource: "vehicleUsePolicy", action: "EDIT" },
      // Phase 12 — operational/fleet trend visibility and indicator review;
      // no configuration or export by default.
      { resource: "governanceAnalytics", action: "VIEW" },
      { resource: "analyticsIndicator", action: "VIEW" }, { resource: "analyticsIndicator", action: "EDIT" },
      { resource: "analyticsRule", action: "VIEW" },
    ],
  },
  // --- Primary role 6/6 — renamed/refocused "Risk/Compliance Manager".
  // Review-only across the board per the explicit "must not edit original
  // inspections, GPS history, photographs, videos or audit events" rule —
  // no resource below grants anything beyond VIEW/AUDIT(verify). ---
  "Accountant / Finance and Compliance Officer": {
    description: "Reviews fuel/odometer information, maintains licence/renewal/compliance dates, reviews customer-side financial/compliance reporting. Never edits original inspections, GPS history, photographs, videos or audit events.",
    permissions: [
      { resource: "site", action: "VIEW" },
      { resource: "gate", action: "VIEW" },
      { resource: "auditLog", action: "VIEW" },
      { resource: "driver", action: "VIEW" }, { resource: "vehicle", action: "VIEW" }, { resource: "movement", action: "VIEW" },
      { resource: "complianceDocument", action: "VIEW" }, { resource: "complianceDocument", action: "AUDIT" },
      { resource: "gateEvent", action: "VIEW" },
      { resource: "inspectionTemplate", action: "VIEW" },
      { resource: "exception", action: "VIEW" },
      { resource: "mediaAsset", action: "VIEW" },
      // Reviews fuel/odometer information directly — reconciliation is
      // exactly that comparison, view-only per this role's review-only remit.
      { resource: "reconciliation", action: "VIEW" },
      { resource: "telematics", action: "VIEW" },
      { resource: "vehicleUsePolicy", action: "VIEW" },
      // Compliance visibility into retention status and can view/download a
      // ready export manifest, but never initiates or approves deletion.
      { resource: "retention", action: "VIEW" }, { resource: "retention", action: "EXPORT" },
      // Phase 10 (P10J) — the operational owner of this tenant's own billing:
      // views/downloads invoices, views payment history, initiates a
      // mock/configured-provider payment, updates authorised billing-contact
      // info, and requests an authorised invoice-email resend. Deliberately
      // no invoice:CREATE/EDIT (generation/void/reissue is a platform-admin
      // function, P10I) and no pricingAgreement/platformBilling/
      // tenantSubscription:CONFIGURE — this role can see its own
      // subscription status but cannot suspend/restore access or negotiate
      // pricing.
      { resource: "tenantBilling", action: "VIEW" }, { resource: "tenantBilling", action: "EDIT" },
      { resource: "invoice", action: "VIEW" },
      { resource: "payment", action: "VIEW" }, { resource: "payment", action: "CREATE" },
      { resource: "billingEmail", action: "VIEW" }, { resource: "billingEmail", action: "CREATE" },
      { resource: "tenantSubscription", action: "VIEW" },
      // Phase 11 (P11M) — "Accountant only where financially relevant": no
      // standing investigation grant at all by default (least privilege);
      // a per-user permission override is the intended path if this role
      // ever needs case visibility for a specific financial-fraud case.
    ],
  },
  // --- Additional non-daily profile 1/3 — renamed "Internal Auditor". ---
  "Internal Investigator / Auditor": {
    description: "Read-only access to evidence, reports and audit history, for internal investigations. Can record control-test results and findings where authorised (Phase 6 Governance). Investigates and records Phase 11 case findings but cannot approve its own findings, close/reopen a case or grant external-auditor access (Security Supervisor / Approving Manager).",
    permissions: [
      { resource: "site", action: "VIEW" },
      { resource: "gate", action: "VIEW" },
      { resource: "user", action: "VIEW" },
      { resource: "auditLog", action: "VIEW" }, { resource: "auditLog", action: "EXPORT" },
      { resource: "driver", action: "VIEW" }, { resource: "vehicle", action: "VIEW" }, { resource: "movement", action: "VIEW" },
      { resource: "complianceDocument", action: "VIEW" },
      { resource: "gateEvent", action: "VIEW" },
      { resource: "inspectionTemplate", action: "VIEW" },
      { resource: "exception", action: "VIEW" },
      // Views evidence for audit purposes but never creates it — see
      // SECURITY_AND_POPIA.md / TESTING.md "unauthorised roles cannot view
      // facial or video evidence" (this role is deliberately authorised,
      // exercising the allowed side of that boundary).
      { resource: "mediaAsset", action: "VIEW" },
      { resource: "reconciliation", action: "VIEW" },
      { resource: "telematics", action: "VIEW" },
      { resource: "vehicleUsePolicy", action: "VIEW" },
      { resource: "retention", action: "VIEW" },
      // Phase 10 — full internal read-only visibility, consistent with this
      // role's remit; never CREATE/EDIT/CONFIGURE anything billing-related.
      { resource: "tenantBilling", action: "VIEW" },
      { resource: "invoice", action: "VIEW" },
      { resource: "payment", action: "VIEW" },
      { resource: "tenantSubscription", action: "VIEW" },
      // Phase 11 (P11M) — the working-investigator slice: create/edit cases,
      // manage subjects/evidence/notes/tasks, record findings and generate
      // reports. Deliberately no investigationFinding:APPROVE/REJECT, no
      // investigationCaseClosure, no investigationHold:CONFIGURE and no
      // externalAuditorAccess — those stay with Security Supervisor /
      // Approving Manager above (P11D separation of duties).
      { resource: "investigationCase", action: "VIEW" }, { resource: "investigationCase", action: "CREATE" }, { resource: "investigationCase", action: "EDIT" },
      { resource: "investigationConfidentialAccess", action: "VIEW" },
      { resource: "investigationSubject", action: "EDIT" },
      { resource: "investigationEvidence", action: "VIEW" }, { resource: "investigationEvidence", action: "CREATE" }, { resource: "investigationEvidence", action: "EXPORT" },
      { resource: "investigationNote", action: "CREATE" }, { resource: "investigationNote", action: "VIEW" },
      { resource: "investigationTask", action: "CREATE" }, { resource: "investigationTask", action: "EDIT" },
      { resource: "investigationFinding", action: "CREATE" }, { resource: "investigationFinding", action: "EDIT" },
      { resource: "investigationReport", action: "CREATE" }, { resource: "investigationReport", action: "EXPORT" },
      // Phase 12 — working governance analyst/investigator.
      { resource: "governanceAnalytics", action: "VIEW" },
      { resource: "analyticsIndicator", action: "VIEW" }, { resource: "analyticsIndicator", action: "EDIT" }, { resource: "analyticsIndicator", action: "CREATE" },
      { resource: "analyticsRule", action: "VIEW" },
      { resource: "analyticsExport", action: "EXPORT" },
    ],
  },
  // --- Additional non-daily profile 2/3 — new. More restricted than the
  // internal profile: no visibility into internal staff (no user:VIEW), no
  // audit export, no inspection-template/checklist-config visibility. An
  // external party (e.g. insurance/compliance reviewer) sees case-relevant
  // evidence and records, not internal operational configuration. ---
  "External Reviewer": {
    description: "Restricted read-only access for an external reviewer (e.g. insurer, external compliance auditor) — evidence and records only, no internal staff/configuration visibility, no export. Distinct from the Phase 11 'External Auditor (Case-Scoped)' role below — this role has standing tenant-wide read access under a broader existing mandate; it deliberately receives no Phase 11 investigation permissions.",
    permissions: [
      { resource: "site", action: "VIEW" },
      { resource: "gate", action: "VIEW" },
      { resource: "auditLog", action: "VIEW" },
      { resource: "driver", action: "VIEW" }, { resource: "vehicle", action: "VIEW" }, { resource: "movement", action: "VIEW" },
      { resource: "complianceDocument", action: "VIEW" },
      { resource: "gateEvent", action: "VIEW" },
      { resource: "exception", action: "VIEW" },
      { resource: "mediaAsset", action: "VIEW" },
      { resource: "reconciliation", action: "VIEW" },
      { resource: "telematics", action: "VIEW" },
      { resource: "vehicleUsePolicy", action: "VIEW" },
    ],
  },
  // --- Additional non-daily profile 3/3 — renamed "Executive Viewer". ---
  "Executive Read-Only Viewer": {
    description: "Read-only dashboards and reports for executive oversight. Deliberately no media/evidence access — aggregate reporting only.",
    permissions: [
      { resource: "site", action: "VIEW" },
      { resource: "gate", action: "VIEW" },
      { resource: "driver", action: "VIEW" }, { resource: "vehicle", action: "VIEW" }, { resource: "movement", action: "VIEW" },
      { resource: "gateEvent", action: "VIEW" },
      { resource: "reconciliation", action: "VIEW" },
      { resource: "telematics", action: "VIEW" },
      { resource: "vehicleUsePolicy", action: "VIEW" },
      // Deliberately no mediaAsset permission at all — dashboards/aggregate
      // reporting only (SECURITY_AND_POPIA.md "Internal" classification),
      // never raw evidence, mirroring their existing lack of
      // complianceDocument access.
      // Phase 10 — high-level financial/subscription visibility for
      // executive reporting; view-only, same posture as everything else
      // this role holds.
      { resource: "tenantBilling", action: "VIEW" },
      { resource: "invoice", action: "VIEW" },
      { resource: "tenantSubscription", action: "VIEW" },
      // Phase 11 (P11K) — aggregate case-count oversight only, no
      // confidential/evidence/subject access, matching this role's existing
      // "no media/evidence access" posture.
      { resource: "investigationCase", action: "VIEW" },
      // Phase 12 — aggregate/read-only executive intelligence. Export and
      // review/configuration are intentionally independent and not granted.
      { resource: "governanceAnalytics", action: "VIEW" },
      { resource: "analyticsIndicator", action: "VIEW" },
    ],
  },
  // --- Phase 11 addition, deliberately outside the six-primary +
  // three-additional structure (D-015): the P11L hard requirement is a role
  // with NO general tenant-wide visibility at all, gated entirely by a
  // live, case-scoped ExternalAuditorAccessGrant. Reusing "External
  // Reviewer" (which already holds standing tenant-wide VIEW across most
  // resources, see above) would violate that requirement outright, so this
  // is a new, minimal, additive role rather than a reinterpretation of an
  // existing one — see DECISIONS.md.
  "External Auditor (Case-Scoped)": {
    description: "Phase 11 restricted, time-limited, case-scoped external auditor access. Holds no general tenant-wide permission — every case/report/evidence view is additionally gated by a live, non-expired, non-revoked ExternalAuditorAccessGrant naming the exact case.",
    permissions: [
      { resource: "externalAuditorPortal", action: "VIEW" },
      { resource: "externalAuditorPortal", action: "EXPORT" },
    ],
  },
};

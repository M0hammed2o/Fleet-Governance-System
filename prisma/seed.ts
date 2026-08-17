/**
 * Dev/demo seed data only. Names, emails and passwords below are fictional —
 * see DATA_AND_DEMO_RULES in the build brief / MVP_SCOPE.md. Never point this
 * script at a production database.
 */
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { listAllPermissions, permissionKey, type PermissionResource, type PermissionAction } from "../src/lib/auth/permissions";
import { assertSafeToSeed } from "../src/lib/db/seed-guard";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
assertSafeToSeed(connectionString);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const DEV_PASSWORD = "GateFleet!Dev1"; // fictional dev-only password, same for every seeded user
const STORAGE_LOCAL_PATH = process.env.STORAGE_LOCAL_PATH || "./.data/media";

/**
 * Writes a small fictional placeholder file straight into the same directory
 * LocalFilesystemStorageProvider uses, and creates the matching MediaAsset
 * row directly via Prisma — same "seed writes the target state directly, not
 * through the repository layer" convention already used for GateEvent
 * (repository files, and lib/storage/local-filesystem-provider.ts, are
 * `import "server-only"` tagged and throw if imported into this plain tsx
 * script — see WORKLOG.md 2026-07-21). No real image/video binary content is
 * stored in the repo — a tiny fictional text blob on disk is enough to
 * exercise the upload/serve/checksum path end-to-end for the demo.
 */
async function seedMediaAsset(params: {
  tenantId: string;
  ownerType: "GATE_EVENT" | "GATE_EVENT_INSPECTION_ITEM" | "MANUAL_FACIAL_VERIFICATION_FALLBACK" | "DRIVER_PORTRAIT" | "COMPLIANCE_DOCUMENT";
  ownerId: string;
  capturedByUserId: string;
  fileName: string;
  contentType: string;
  contents: string;
  idempotencyKey: string;
}) {
  const existing = await prisma.mediaAsset.findUnique({
    where: { tenantId_idempotencyKey: { tenantId: params.tenantId, idempotencyKey: params.idempotencyKey } },
  });
  if (existing) return existing;

  const data = Buffer.from(params.contents, "utf8");
  const checksumSha256 = crypto.createHash("sha256").update(data).digest("hex");
  const storageKey = `${params.tenantId}/${crypto.randomUUID()}-${params.fileName}`;
  const fullPath = path.resolve(process.cwd(), STORAGE_LOCAL_PATH, storageKey);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, data);
  fs.writeFileSync(`${fullPath}.meta.json`, JSON.stringify({ contentType: params.contentType }), "utf8");

  return prisma.mediaAsset.create({
    data: {
      tenantId: params.tenantId,
      ownerType: params.ownerType,
      ownerId: params.ownerId,
      capturedByUserId: params.capturedByUserId,
      fileName: params.fileName,
      contentType: params.contentType,
      fileSizeBytes: data.byteLength,
      storageKey,
      checksumSha256,
      idempotencyKey: params.idempotencyKey,
    },
  });
}

type RolePermissionSpec = { resource: PermissionResource; action: PermissionAction }[];

// Tenant-scoped roles. As of 2026-07-23 this maps onto the six primary
// customer roles + three additional non-daily profiles specified by the
// user (see DECISIONS.md D-015 and WORKLOG.md Session 6/7 for the full
// mapping rationale from the original 8-role set). Resources introduced in
// later phases (telematics, vehicleUsePolicy, supportAccessSession, ...)
// will extend these mappings as each module lands — see TODO.md.
const TENANT_ROLE_DEFINITIONS: Record<string, { description: string; permissions: RolePermissionSpec }> = {
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

async function main() {
  console.log("Seeding permission catalogue...");
  const permissionRows = await Promise.all(
    listAllPermissions().map(({ resource, action }) =>
      prisma.permission.upsert({
        where: { resource_action: { resource, action } },
        update: {},
        create: { resource, action },
      }),
    ),
  );
  const permissionIdByKey = new Map(permissionRows.map((p) => [permissionKey(p.resource, p.action), p.id]));

  // --- Platform tenant + Platform Administrator -----------------------------
  console.log("Seeding platform tenant...");
  const platformTenant = await prisma.tenant.upsert({
    where: { slug: "platform" },
    update: {},
    create: { name: "Gate Fleet Governance — Platform", slug: "platform" },
  });

  const platformAdminRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: platformTenant.id, name: "Platform Administrator" } },
    update: {},
    create: {
      tenantId: platformTenant.id,
      name: "Platform Administrator",
      description: "Manages tenant organisations. Restricted support access — cannot silently access tenant evidence.",
      isSystem: true,
    },
  });
  for (const action of ["VIEW", "CREATE", "EDIT", "CONFIGURE"] as const) {
    const permissionId = permissionIdByKey.get(permissionKey("platformTenant", action));
    if (!permissionId) continue;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: platformAdminRole.id, permissionId } },
      update: {},
      create: { roleId: platformAdminRole.id, permissionId },
    });
  }
  // Phase 7 (SUPPORT-002/003) — full support-access rights, including the
  // explicit elevation workflow (CONFIGURE) that Platform Support Analyst
  // below deliberately does not get.
  for (const action of ["VIEW", "CREATE", "CONFIGURE"] as const) {
    const permissionId = permissionIdByKey.get(permissionKey("supportAccessSession", action));
    if (!permissionId) continue;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: platformAdminRole.id, permissionId } },
      update: {},
      create: { roleId: platformAdminRole.id, permissionId },
    });
  }

  // Phase 10 (P10I/P10M) — full platform-wide billing management: pricing
  // negotiation, invoice generation/void/reissue, manual payment recording,
  // billing-email resend, subscription suspend/restore, platform billing
  // configuration, and editing a customer's billing profile on its behalf.
  // Never granted to Platform Support Analyst below — billing operations
  // are a first-class platform-admin function, not a support-access-session
  // concern (mirrors platformTenant itself, D-005).
  const platformAdminBillingGrants: Array<[string, readonly string[]]> = [
    ["tenantBilling", ["VIEW", "EDIT"]],
    ["pricingAgreement", ["VIEW", "EDIT"]],
    ["invoice", ["VIEW", "CREATE", "EDIT"]],
    ["payment", ["VIEW", "CREATE"]],
    ["billingEmail", ["VIEW", "CREATE"]],
    ["tenantSubscription", ["VIEW", "CONFIGURE"]],
    ["platformBilling", ["VIEW", "CONFIGURE"]],
  ];
  for (const [resource, actions] of platformAdminBillingGrants) {
    for (const action of actions) {
      const permissionId = permissionIdByKey.get(permissionKey(resource, action));
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: platformAdminRole.id, permissionId } },
        update: {},
        create: { roleId: platformAdminRole.id, permissionId },
      });
    }
  }

  const platformAdminUser = await upsertUser({
    tenantId: platformTenant.id,
    roleId: platformAdminRole.id,
    email: "platform.admin@example.test",
    name: "Priya Naidoo",
  });

  // --- Platform Support Analyst (Phase 7, D-016) -----------------------------
  // Second platform-side role, distinguished from Platform Administrator by a
  // narrower permission set: can see the customer list and start/use support
  // sessions, but cannot create/edit/suspend tenants and cannot elevate a
  // support session to authorised-change access — that stays with the
  // Administrator role only.
  const platformSupportAnalystRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: platformTenant.id, name: "Platform Support Analyst" } },
    update: {},
    create: {
      tenantId: platformTenant.id,
      name: "Platform Support Analyst",
      description: "Views the customer health-summary list and runs time-limited, audited support-access sessions. Cannot manage tenants or elevate a session's access.",
      isSystem: true,
    },
  });
  {
    const platformTenantViewId = permissionIdByKey.get(permissionKey("platformTenant", "VIEW"));
    if (platformTenantViewId) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: platformSupportAnalystRole.id, permissionId: platformTenantViewId } },
        update: {},
        create: { roleId: platformSupportAnalystRole.id, permissionId: platformTenantViewId },
      });
    }
  }
  for (const action of ["VIEW", "CREATE"] as const) {
    const permissionId = permissionIdByKey.get(permissionKey("supportAccessSession", action));
    if (!permissionId) continue;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: platformSupportAnalystRole.id, permissionId } },
      update: {},
      create: { roleId: platformSupportAnalystRole.id, permissionId },
    });
  }
  const platformSupportAnalystUser = await upsertUser({
    tenantId: platformTenant.id,
    roleId: platformSupportAnalystRole.id,
    email: "platform.support.analyst@example.test",
    name: "Thabo Mahlangu",
  });

  // --- Demo tenant ------------------------------------------------------------
  console.log("Seeding demo tenant...");
  const demoTenant = await prisma.tenant.upsert({
    where: { slug: "acme-logistics" },
    update: {},
    create: {
      name: "Acme Logistics (Pty) Ltd",
      slug: "acme-logistics",
      timezone: "Africa/Johannesburg",
      currency: "ZAR",
    },
  });

  const siteName = "Johannesburg Distribution Centre";
  const site =
    (await prisma.site.findFirst({ where: { tenantId: demoTenant.id, name: siteName } })) ??
    (await prisma.site.create({
      data: { tenantId: demoTenant.id, name: siteName, address: "1 Fictional Way, Johannesburg" },
    }));

  const gateNames = ["Main Gate", "Yard Gate"] as const;
  for (const name of gateNames) {
    const existing = await prisma.gate.findFirst({ where: { tenantId: demoTenant.id, siteId: site.id, name } });
    if (!existing) {
      await prisma.gate.create({ data: { tenantId: demoTenant.id, siteId: site.id, name, direction: "BOTH" } });
    }
  }

  const createdUsers: { role: string; email: string }[] = [
    { role: "Platform Administrator", email: platformAdminUser.email },
    { role: "Platform Support Analyst", email: platformSupportAnalystUser.email },
  ];
  const usersByRole = new Map<string, { id: string; email: string }>();

  for (const [roleName, def] of Object.entries(TENANT_ROLE_DEFINITIONS)) {
    const role = await prisma.role.upsert({
      where: { tenantId_name: { tenantId: demoTenant.id, name: roleName } },
      update: {},
      create: { tenantId: demoTenant.id, name: roleName, description: def.description, isSystem: true },
    });

    for (const { resource, action } of def.permissions) {
      const permissionId = permissionIdByKey.get(permissionKey(resource, action));
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }

    const slug = roleName.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
    const user = await upsertUser({
      tenantId: demoTenant.id,
      roleId: role.id,
      email: `${slug}@example.test`,
      name: fictionalNameFor(roleName),
    });
    createdUsers.push({ role: roleName, email: user.email });
    usersByRole.set(roleName, { id: user.id, email: user.email });
  }

  await seedMasterData(demoTenant.id, site.id, usersByRole);
  await seedBilling(demoTenant.id);
  await prisma.tenantInvestigationSettings.upsert({
    where: { tenantId: demoTenant.id },
    update: {},
    create: { tenantId: demoTenant.id },
  });

  if (process.env.SEED_SUPPRESS_CREDENTIAL_OUTPUT === "true") {
    console.log("\nSeed complete. Fictional local accounts created; credential output suppressed.");
  } else {
    console.log("\nSeed complete. Dev-only fictional accounts (all share the same dev password):");
    console.log(`  Password: ${DEV_PASSWORD}`);
    console.log(`  Platform tenant slug: ${platformTenant.slug}`);
    console.log(`  Demo tenant slug:     ${demoTenant.slug}`);
    for (const u of createdUsers) {
      console.log(`  - ${u.role.padEnd(24)} ${u.email}`);
    }
  }
}

async function upsertUser(input: { tenantId: string; roleId: string; email: string; name: string }) {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);
  return prisma.user.upsert({
    where: { tenantId_email: { tenantId: input.tenantId, email: input.email } },
    update: {},
    create: {
      tenantId: input.tenantId,
      roleId: input.roleId,
      email: input.email,
      name: input.name,
      passwordHash,
      status: "ACTIVE",
    },
  });
}

function fictionalNameFor(roleName: string): string {
  const names: Record<string, string> = {
    "Company Administrator": "Thandiwe Mokoena",
    "Dispatch and Logistics Officer": "Refilwe Sekgobela",
    "Gate Security Officer": "Sipho Dlamini",
    "Security Supervisor / Approving Manager": "Johan van der Merwe",
    "Fleet and GPS Manager": "Fatima Patel",
    "Accountant / Finance and Compliance Officer": "Nomvula Khumalo",
    "Internal Investigator / Auditor": "Andries Pretorius",
    "External Reviewer": "Michael O'Sullivan",
    "Executive Read-Only Viewer": "Lindiwe Zulu",
    // Phase 11 — deterministic local test user for the restricted,
    // case-scoped external-auditor mechanism (P11L: "deterministic local
    // test users, honest no-op invitation provider — do not send a real
    // external invitation").
    "External Auditor (Case-Scoped)": "Priya Naidoo",
  };
  return names[roleName] ?? roleName;
}

const TYRE_LAYOUTS: { name: string; category: "PASSENGER" | "LIGHT_COMMERCIAL" | "TRUCK" | "TRUCK_DUAL_REAR_WHEEL" | "TRAILER"; positions: { code: string; label: string }[] }[] = [
  {
    name: "Standard Passenger (4-wheel)",
    category: "PASSENGER",
    positions: [
      { code: "FL", label: "Front Left" },
      { code: "FR", label: "Front Right" },
      { code: "RL", label: "Rear Left" },
      { code: "RR", label: "Rear Right" },
    ],
  },
  {
    name: "Standard Light Commercial (4-wheel)",
    category: "LIGHT_COMMERCIAL",
    positions: [
      { code: "FL", label: "Front Left" },
      { code: "FR", label: "Front Right" },
      { code: "RL", label: "Rear Left" },
      { code: "RR", label: "Rear Right" },
    ],
  },
  {
    name: "Standard Truck (single rear wheels)",
    category: "TRUCK",
    positions: [
      { code: "FL", label: "Front Left" },
      { code: "FR", label: "Front Right" },
      { code: "RL", label: "Rear Left" },
      { code: "RR", label: "Rear Right" },
    ],
  },
  {
    name: "Truck (dual rear wheels)",
    category: "TRUCK_DUAL_REAR_WHEEL",
    positions: [
      { code: "FL", label: "Front Left" },
      { code: "FR", label: "Front Right" },
      { code: "RL_OUTER", label: "Rear Left Outer" },
      { code: "RL_INNER", label: "Rear Left Inner" },
      { code: "RR_OUTER", label: "Rear Right Outer" },
      { code: "RR_INNER", label: "Rear Right Inner" },
    ],
  },
  {
    name: "Standard Trailer (tandem axle)",
    category: "TRAILER",
    positions: [
      { code: "AXLE1_LEFT", label: "Axle 1 Left" },
      { code: "AXLE1_RIGHT", label: "Axle 1 Right" },
      { code: "AXLE2_LEFT", label: "Axle 2 Left" },
      { code: "AXLE2_RIGHT", label: "Axle 2 Right" },
    ],
  },
];

const DEFAULT_EXPIRY_RULES: { documentType: "DRIVER_LICENCE" | "PDP" | "VEHICLE_LICENCE" | "ROADWORTHY_CERTIFICATE" | "INSURANCE" | "OTHER"; action: "WARN" | "REQUIRE_SUPERVISOR_APPROVAL" | "BLOCK_CLEARANCE" }[] = [
  { documentType: "DRIVER_LICENCE", action: "BLOCK_CLEARANCE" },
  { documentType: "PDP", action: "BLOCK_CLEARANCE" },
  { documentType: "VEHICLE_LICENCE", action: "BLOCK_CLEARANCE" },
  { documentType: "ROADWORTHY_CERTIFICATE", action: "BLOCK_CLEARANCE" },
  { documentType: "INSURANCE", action: "REQUIRE_SUPERVISOR_APPROVAL" },
  { documentType: "OTHER", action: "WARN" },
];

/**
 * Phase 10 — platform billing configuration + the demo tenant's own
 * subscription/billing profile. Deliberately does not fabricate any
 * Invoice/Payment rows directly (unlike the static master-data fixtures
 * above) — those are generated for real via the actual billing repository
 * functions (the recurring job, or the platform-admin dashboard), so a
 * demo invoice is never out of sync with the real generation logic's
 * invariants (sequential numbering, PDF attachment, line-item shape).
 */
async function seedBilling(tenantId: string) {
  console.log("Seeding billing configuration...");

  await prisma.platformBillingSettings.upsert({
    where: { id: "platform" },
    update: {},
    create: {
      id: "platform",
      legalName: "Gate Fleet Governance (Pty) Ltd",
      tradingName: "Gate Fleet Governance",
      registrationNumber: "2026/123456/07",
      vatEnabled: false, // no VAT registration number configured yet — see BILLING_AND_SUBSCRIPTIONS.md "still-blocked"
      addressLine1: "1 Fictional Way",
      city: "Johannesburg",
      postalCode: "2000",
      country: "South Africa",
      billingEmail: "billing@example.test",
      invoicePrefix: "INV",
      currency: "ZAR",
      defaultPaymentTermsDays: 30,
      defaultGracePeriodDays: 14,
      defaultBaseFeeMinorUnits: 199_900, // R1,999.00 — approved commercial-model default
      defaultPerVehicleFeeMinorUnits: 29_900, // R299.00 — approved commercial-model default
    },
  });

  const plan = await prisma.subscriptionPlan.upsert({
    where: { name: "Standard" },
    update: {},
    create: { name: "Standard", description: "The platform's single V1 commercial plan — base fee plus per-active-vehicle fee." },
  });

  await prisma.tenantSubscription.upsert({
    where: { tenantId },
    update: {},
    create: { tenantId, planId: plan.id, status: "ACTIVE", startedAt: new Date() },
  });

  await prisma.tenantBillingProfile.upsert({
    where: { tenantId },
    update: {},
    create: {
      tenantId,
      registeredBusinessName: "Acme Logistics (Pty) Ltd",
      tradingName: "Acme Logistics",
      registrationNumber: "2019/987654/07",
      billingAddressLine1: "1 Fictional Way",
      billingCity: "Johannesburg",
      billingPostalCode: "2000",
      billingCountry: "South Africa",
      billingEmail: "accounts@acme-logistics.example.test",
      accountsContactName: "Nomvula Khumalo",
      accountsContactEmail: "accounts@acme-logistics.example.test",
      paymentTermsDays: 30,
      gracePeriodDays: 14,
      subscriptionStartDate: new Date(),
    },
  });

  const existingContact = await prisma.customerBillingContact.findFirst({ where: { tenantId, email: "finance@acme-logistics.example.test" } });
  if (!existingContact) {
    await prisma.customerBillingContact.create({
      data: { tenantId, name: "Nomvula Khumalo", email: "finance@acme-logistics.example.test" },
    });
  }
}

async function seedMasterData(tenantId: string, siteId: string, usersByRole: Map<string, { id: string; email: string }>) {
  console.log("Seeding tyre-position configs, expiry rules, drivers, vehicles, movements...");

  const tyreConfigByCategory = new Map<string, string>();
  for (const layout of TYRE_LAYOUTS) {
    const config = await prisma.tyrePositionConfig.upsert({
      where: { tenantId_name: { tenantId, name: layout.name } },
      update: {},
      create: { tenantId, name: layout.name, category: layout.category, isSystem: true },
    });
    tyreConfigByCategory.set(layout.category, config.id);
    for (const [index, pos] of layout.positions.entries()) {
      await prisma.tyrePositionDefinition.upsert({
        where: { configId_code: { configId: config.id, code: pos.code } },
        update: {},
        create: { configId: config.id, code: pos.code, label: pos.label, sortOrder: index },
      });
    }
  }

  for (const rule of DEFAULT_EXPIRY_RULES) {
    await prisma.documentExpiryRule.upsert({
      where: { tenantId_documentType: { tenantId, documentType: rule.documentType } },
      update: {},
      create: { tenantId, documentType: rule.documentType, action: rule.action },
    });
  }

  const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const driver1 = await upsertDriver(tenantId, {
    employeeNumber: "EMP-1001",
    name: "Kagiso Ndlovu",
    licenceNumber: "GP1234567",
    licenceClass: "C1",
    licenceExpiry: oneYearFromNow,
    authorisedVehicleClasses: ["C1", "EC1"],
  });
  const driver2 = await upsertDriver(tenantId, {
    employeeNumber: "EMP-1002",
    name: "Palesa Mokoena",
    licenceNumber: "GP7654321",
    licenceClass: "EC",
    licenceExpiry: thirtyDaysAgo, // deliberately expired — exercises the expiry-rule display path
    pdpNumber: "PDP-99201",
    pdpExpiry: oneYearFromNow,
    authorisedVehicleClasses: ["C1", "EC", "EC1"],
  });

  const truck = await upsertVehicle(tenantId, {
    fleetNumber: "FL-100",
    registrationNumber: "JHB100GP",
    vin: "VIN0000000000TRUCK1",
    make: "Isuzu",
    model: "FTR 850",
    year: 2022,
    colour: "White",
    category: "TRUCK",
    assignedDriverId: driver1.id,
    tyrePositionConfigId: tyreConfigByCategory.get("TRUCK") ?? null,
    licenceDiscExpiry: oneYearFromNow,
    roadworthyExpiry: oneYearFromNow,
    insuranceExpiry: oneYearFromNow,
    operationalStatus: "OPERATIONAL",
  });
  const trailer = await upsertVehicle(tenantId, {
    fleetNumber: "TR-200",
    registrationNumber: "JHB200GP",
    vin: "VIN0000000TRAILER01",
    make: "SA Trailers",
    model: "Flatbed",
    year: 2020,
    colour: "Grey",
    category: "TRAILER",
    tyrePositionConfigId: tyreConfigByCategory.get("TRAILER") ?? null,
    operationalStatus: "OPERATIONAL",
  });
  await prisma.vehicle.update({ where: { id: trailer.id }, data: { attachedToVehicleId: truck.id } });

  const bakkie = await upsertVehicle(tenantId, {
    fleetNumber: "LC-300",
    registrationNumber: "JHB300GP",
    vin: "VIN0000000BAKKIE001",
    make: "Toyota",
    model: "Hilux",
    year: 2023,
    colour: "Silver",
    category: "LIGHT_COMMERCIAL",
    assignedDriverId: driver2.id,
    tyrePositionConfigId: tyreConfigByCategory.get("LIGHT_COMMERCIAL") ?? null,
    licenceDiscExpiry: oneYearFromNow,
    roadworthyExpiry: oneYearFromNow,
    insuranceExpiry: thirtyDaysAgo, // deliberately expired
    operationalStatus: "WORKSHOP_LOCKOUT", // exercises the lockout-prevents-clearance path
  });

  // Sample current tyre reference data for the truck.
  const truckPositions = await prisma.tyrePositionDefinition.findMany({
    where: { configId: tyreConfigByCategory.get("TRUCK") },
  });
  for (const pos of truckPositions) {
    await prisma.vehicleTyre.upsert({
      where: { vehicleId_positionDefinitionId: { vehicleId: truck.id, positionDefinitionId: pos.id } },
      update: {},
      create: { tenantId, vehicleId: truck.id, positionDefinitionId: pos.id, brand: "Bridgestone", size: "295/80R22.5" },
    });
  }

  const dispatchOfficer = usersByRole.get("Dispatch and Logistics Officer");
  const fleetManager = usersByRole.get("Fleet and GPS Manager");
  const securitySupervisor = usersByRole.get("Security Supervisor / Approving Manager");
  if (dispatchOfficer && fleetManager && securitySupervisor) {
    // Demo MediaAsset — driver portrait (Phase 4, real upload replaces the
    // old dev-mode Driver.portraitUrl placeholder, see DECISIONS.md D-012).
    // Captured by Fleet and GPS Manager, who owns driver master data — not
    // Dispatch and Logistics Officer, who only plans movements.
    if (!driver1.portraitMediaAssetId) {
      const portrait = await seedMediaAsset({
        tenantId,
        ownerType: "DRIVER_PORTRAIT",
        ownerId: driver1.id,
        capturedByUserId: fleetManager.id,
        fileName: "kagiso-ndlovu-portrait.jpg",
        contentType: "image/jpeg",
        contents: "Fictional demo portrait placeholder for Kagiso Ndlovu (EMP-1001) — no real image binary is committed to the repo.",
        idempotencyKey: `seed-driver-portrait-${driver1.id}`,
      });
      await prisma.driver.update({ where: { id: driver1.id }, data: { portraitMediaAssetId: portrait.id } });
    }

    await upsertMovement(tenantId, {
      siteId,
      vehicleId: truck.id,
      driverId: driver1.id,
      trailerVehicleId: trailer.id,
      movementType: "DELIVERY",
      purpose: "Scheduled stock delivery",
      destination: "Customer DC — Midrand",
      customerProjectJobReference: "JOB-4471",
      deliveryOrCollectionReference: "DN-88213",
      approvedCargoSummary: "12 pallets packaged goods, sealed",
      sealOrContainerReference: "SEAL-55291",
      requesterUserId: dispatchOfficer.id,
      approverUserId: securitySupervisor.id,
      status: "APPROVED",
      referenceCode: "MV-DEMO1",
    });
    await upsertMovement(tenantId, {
      siteId,
      vehicleId: bakkie.id,
      driverId: driver2.id,
      movementType: "COLLECTION",
      purpose: "Collect returned equipment",
      destination: "Supplier — Boksburg",
      purchaseOrderReference: "PO-33012",
      requesterUserId: dispatchOfficer.id,
      status: "SUBMITTED",
      referenceCode: "MV-DEMO2",
    });

    const driver3 = await upsertDriver(tenantId, {
      employeeNumber: "EMP-1003",
      name: "Bongani Sithole",
      licenceNumber: "GP5551234",
      licenceClass: "C1",
      licenceExpiry: oneYearFromNow,
      authorisedVehicleClasses: ["C1"],
    });
    const lightTruck = await upsertVehicle(tenantId, {
      fleetNumber: "FL-400",
      registrationNumber: "JHB400GP",
      vin: "VIN0000000LTRUCK01",
      make: "Isuzu",
      model: "NPR 400",
      year: 2021,
      colour: "White",
      category: "TRUCK",
      assignedDriverId: driver3.id,
      tyrePositionConfigId: tyreConfigByCategory.get("TRUCK") ?? null,
      licenceDiscExpiry: oneYearFromNow,
      roadworthyExpiry: oneYearFromNow,
      insuranceExpiry: oneYearFromNow,
      operationalStatus: "OPERATIONAL",
    });
    const movement3 = await upsertMovement(tenantId, {
      siteId,
      vehicleId: lightTruck.id,
      driverId: driver3.id,
      movementType: "ENTRY",
      purpose: "Site delivery — building materials",
      destination: "Main warehouse",
      deliveryOrCollectionReference: "DN-99120",
      approvedCargoSummary: "8 pallets cement, sealed",
      requesterUserId: dispatchOfficer.id,
      approverUserId: securitySupervisor.id,
      status: "APPROVED",
      referenceCode: "MV-DEMO3",
    });

    await seedGateOperations(tenantId, siteId, usersByRole, {
      exceptionMovementId: movement3.id,
      exceptionVehicleId: lightTruck.id,
      exceptionDriverId: driver3.id,
    });
  }
}

/**
 * Seeds a default configurable inspection template (build brief GATE-006),
 * a small tenant-configurable exception-type catalogue (GATE item 3), and two
 * demoable GateEvents in different states — a cleared happy-path event and an
 * event sitting in SUPERVISOR_REVIEW with an open high-severity exception —
 * so the security dashboard and gate workflow are demoable end-to-end without
 * manual setup. Writes GateEvent/Exception rows directly via Prisma (not the
 * repository layer) the same way upsertMovement already does for
 * MovementAuthorisation — seed data intentionally sets a specific target
 * state rather than replaying every intermediate transition.
 */
async function seedGateOperations(
  tenantId: string,
  siteId: string,
  usersByRole: Map<string, { id: string; email: string }>,
  refs: { exceptionMovementId: string; exceptionVehicleId: string; exceptionDriverId: string },
) {
  console.log("Seeding inspection template, exception types, and demo gate events...");

  const officer = usersByRole.get("Gate Security Officer");
  const securitySupervisor = usersByRole.get("Security Supervisor / Approving Manager");
  if (!officer || !securitySupervisor) return;

  const mainGate = await prisma.gate.findFirst({ where: { tenantId, siteId, name: "Main Gate" } });
  const yardGate = await prisma.gate.findFirst({ where: { tenantId, siteId, name: "Yard Gate" } });
  if (!mainGate || !yardGate) return;

  // --- Default configurable inspection template (generic — applies to every category) ---
  const templateName = "Standard Gate Inspection";
  let template = await prisma.inspectionTemplate.findFirst({
    where: { tenantId, name: templateName, version: 1 },
    include: { items: true },
  });
  if (!template) {
    // P11-000 (DECISIONS.md D-038): items created via a separate createMany()
    // rather than a nested `items: { create: [...] }` write — same fix
    // applied throughout src/lib/repositories/ for the pg deprecation
    // warning this pattern was traced to under real load.
    const createdTemplate = await prisma.inspectionTemplate.create({
      data: {
        tenantId,
        name: templateName,
        description: "Default guided walk-around inspection covering driver, vehicle, condition and load checks.",
        vehicleCategory: null,
        version: 1,
        isActive: true,
        isSystem: true,
      },
    });
    await prisma.inspectionItem.createMany({
      data: [
        { templateId: createdTemplate.id, section: "DRIVER_AUTHORISATION", label: "Driver licence matches movement authorisation", sortOrder: 0, responseType: "CHECK", defaultExceptionSeverity: "HIGH", requiresSupervisorApprovalOnFail: true },
        { templateId: createdTemplate.id, section: "DRIVER_AUTHORISATION", label: "PDP valid for this vehicle class (where required)", sortOrder: 1, responseType: "CHECK" },
        { templateId: createdTemplate.id, section: "VEHICLE_IDENTITY", label: "Registration number matches approved movement", sortOrder: 0, responseType: "CHECK", defaultExceptionSeverity: "HIGH", requiresSupervisorApprovalOnFail: true },
        { templateId: createdTemplate.id, section: "VEHICLE_IDENTITY", label: "VIN/chassis number visible and matches", sortOrder: 1, responseType: "CHECK" },
        { templateId: createdTemplate.id, section: "EXTERIOR_CONDITION", label: "No new visible body damage", sortOrder: 0, responseType: "CHECK", defaultExceptionSeverity: "MEDIUM" },
        { templateId: createdTemplate.id, section: "EXTERIOR_CONDITION", label: "Windscreen and mirrors intact", sortOrder: 1, responseType: "CHECK" },
        { templateId: createdTemplate.id, section: "LIGHTS", label: "Headlights operational", sortOrder: 0, responseType: "CHECK" },
        { templateId: createdTemplate.id, section: "LIGHTS", label: "Indicators and brake lights operational", sortOrder: 1, responseType: "CHECK" },
        { templateId: createdTemplate.id, section: "TYRES_WHEELS", label: "Tyre tread depth (all positions)", sortOrder: 0, responseType: "READING", unit: "mm", defaultExceptionSeverity: "HIGH", requiresSupervisorApprovalOnFail: true },
        { templateId: createdTemplate.id, section: "TYRES_WHEELS", label: "Tyre condition — no visible damage", sortOrder: 1, responseType: "CHECK" },
        { templateId: createdTemplate.id, section: "OPERATIONAL_INFO", label: "Odometer reading recorded", sortOrder: 0, responseType: "READING", unit: "km" },
        { templateId: createdTemplate.id, section: "OPERATIONAL_INFO", label: "Fuel level recorded", sortOrder: 1, responseType: "READING", unit: "%" },
        { templateId: createdTemplate.id, section: "LOAD_VERIFICATION", label: "Cargo matches approved cargo summary", sortOrder: 0, responseType: "CHECK", defaultExceptionSeverity: "HIGH", requiresSupervisorApprovalOnFail: true },
        { templateId: createdTemplate.id, section: "LOAD_VERIFICATION", label: "Seal/container reference matches", sortOrder: 1, responseType: "CHECK" },
      ],
    });
    template = await prisma.inspectionTemplate.findUniqueOrThrow({ where: { id: createdTemplate.id }, include: { items: true } });
  }

  // --- Tenant-configurable exception-type catalogue (DocumentExpiryRule-equivalent for exceptions) ---
  const exceptionTypeSpecs = [
    { code: "TYRE_CONDITION", label: "Tyre condition/tread below threshold", defaultSeverity: "HIGH" as const, defaultOutcomeAction: "SUPERVISOR_APPROVAL" as const, requiresSupervisorApproval: true },
    { code: "DAMAGE_FOUND", label: "Unexplained vehicle damage found", defaultSeverity: "HIGH" as const, defaultOutcomeAction: "WORKSHOP_LOCKOUT" as const, requiresSupervisorApproval: true },
    { code: "DOCUMENT_ISSUE", label: "Supporting document issue (not yet expired)", defaultSeverity: "MEDIUM" as const, defaultOutcomeAction: "MANUAL_REVIEW" as const, requiresSupervisorApproval: false },
    { code: "MISSING_PPE", label: "Driver missing required PPE", defaultSeverity: "LOW" as const, defaultOutcomeAction: "WARNING" as const, requiresSupervisorApproval: false },
  ];
  const exceptionTypeByCode = new Map<string, string>();
  for (const spec of exceptionTypeSpecs) {
    const row = await prisma.exceptionType.upsert({
      where: { tenantId_code: { tenantId, code: spec.code } },
      update: {},
      create: { tenantId, isSystem: true, ...spec },
    });
    exceptionTypeByCode.set(spec.code, row.id);
  }

  // --- Demo GateEvent A: cleared happy path against MV-DEMO1 (truck + trailer) ---
  const clearedMovement = await prisma.movementAuthorisation.findUnique({ where: { referenceCode: "MV-DEMO1" } });
  if (clearedMovement && clearedMovement.status === "APPROVED") {
    let gateEventA = await prisma.gateEvent.findFirst({ where: { tenantId, movementAuthorisationId: clearedMovement.id } });
    if (!gateEventA) {
      const startedAt = new Date(Date.now() - 45 * 60 * 1000);
      gateEventA = await prisma.gateEvent.create({
        data: {
          tenantId,
          siteId,
          gateId: mainGate.id,
          direction: "ENTRY",
          vehicleId: clearedMovement.vehicleId,
          trailerVehicleId: clearedMovement.trailerVehicleId,
          driverId: clearedMovement.driverId,
          movementAuthorisationId: clearedMovement.id,
          securityOfficerUserId: officer.id,
          inspectionTemplateId: template.id,
          status: "CLEARED",
          identityVerificationResult: "VERIFIED",
          identityVerificationRef: `mock-${clearedMovement.driverId}-seed`,
          identityVerifiedAt: startedAt,
          startedAt,
          decision: "CLEARED",
          decisionReason: "All checks passed.",
          decisionByUserId: officer.id,
          decisionAt: new Date(Date.now() - 20 * 60 * 1000),
        },
      });

      const readingValueByUnit: Record<string, string> = { mm: "8", km: "84213", "%": "62" };
      for (const item of template.items) {
        await prisma.gateEventInspectionItem.create({
          data: {
            tenantId,
            gateEventId: gateEventA.id,
            inspectionItemId: item.id,
            outcome: "PASS",
            readingValue: item.responseType === "READING" ? (readingValueByUnit[item.unit ?? ""] ?? "OK") : null,
            readingUnit: item.unit ?? null,
            recordedByUserId: officer.id,
          },
        });
      }

      await prisma.movementAuthorisation.update({ where: { id: clearedMovement.id }, data: { status: "IN_PROGRESS" } });
    }
  }

  // --- Demo GateEvent B: open high-severity exception awaiting supervisor review against MV-DEMO3 ---
  let gateEventB = await prisma.gateEvent.findFirst({ where: { tenantId, movementAuthorisationId: refs.exceptionMovementId } });
  if (!gateEventB) {
    const startedAt = new Date(Date.now() - 15 * 60 * 1000);
    gateEventB = await prisma.gateEvent.create({
      data: {
        tenantId,
        siteId,
        gateId: yardGate.id,
        direction: "ENTRY",
        vehicleId: refs.exceptionVehicleId,
        driverId: refs.exceptionDriverId,
        movementAuthorisationId: refs.exceptionMovementId,
        securityOfficerUserId: officer.id,
        inspectionTemplateId: template.id,
        status: "SUPERVISOR_REVIEW",
        identityVerificationResult: "VERIFIED",
        identityVerificationRef: `mock-${refs.exceptionDriverId}-seed`,
        identityVerifiedAt: startedAt,
        startedAt,
      },
    });

    const tyreItem = template.items.find((i) => i.label.startsWith("Tyre tread depth"));
    if (tyreItem) {
      const inspectionResult = await prisma.gateEventInspectionItem.create({
        data: {
          tenantId,
          gateEventId: gateEventB.id,
          inspectionItemId: tyreItem.id,
          outcome: "FAIL",
          readingValue: "1.2",
          readingUnit: "mm",
          comment: "Rear-left tyre below minimum legal tread depth.",
          exceptionSeverity: "HIGH",
          supervisorApprovalRequired: true,
          recordedByUserId: officer.id,
        },
      });

      await prisma.exception.create({
        data: {
          tenantId,
          gateEventId: gateEventB.id,
          inspectionResultId: inspectionResult.id,
          exceptionTypeId: exceptionTypeByCode.get("TYRE_CONDITION"),
          description: "Rear-left tyre tread depth (1.2mm) is below the legal/safety minimum.",
          severity: "HIGH",
          requiresSupervisorApproval: true,
          raisedByUserId: officer.id,
        },
      });
    }
  }

  // Demo MediaAsset — evidence photo for the failed tyre-tread inspection
  // item on gateEventB (Phase 4, real upload replaces the old dev-mode
  // GateEventInspectionItem.evidenceRef placeholder — see DECISIONS.md
  // D-012). Kept outside the `if (!gateEventB)` block above so it still
  // backfills onto an already-seeded gateEventB from a prior session, not
  // just a freshly created one — same idempotent-by-lookup approach as the
  // rest of this seed script.
  const tyreItemForEvidence = template.items.find((i) => i.label.startsWith("Tyre tread depth"));
  if (tyreItemForEvidence) {
    const inspectionResultForEvidence = await prisma.gateEventInspectionItem.findUnique({
      where: { gateEventId_inspectionItemId: { gateEventId: gateEventB.id, inspectionItemId: tyreItemForEvidence.id } },
    });
    if (inspectionResultForEvidence && !inspectionResultForEvidence.evidenceMediaAssetId) {
      const tyreEvidence = await seedMediaAsset({
        tenantId,
        ownerType: "GATE_EVENT_INSPECTION_ITEM",
        ownerId: gateEventB.id,
        capturedByUserId: officer.id,
        fileName: "rear-left-tyre-tread.jpg",
        contentType: "image/jpeg",
        contents: "Fictional demo evidence placeholder — rear-left tyre tread depth photo for the seeded SUPERVISOR_REVIEW gate event.",
        idempotencyKey: `seed-gate-event-evidence-${gateEventB.id}`,
      });
      await prisma.gateEventInspectionItem.update({
        where: { id: inspectionResultForEvidence.id },
        data: { evidenceMediaAssetId: tyreEvidence.id },
      });
    }
  }
}

async function upsertDriver(
  tenantId: string,
  data: {
    employeeNumber: string;
    name: string;
    licenceNumber: string;
    licenceClass: string;
    licenceExpiry: Date;
    pdpNumber?: string;
    pdpExpiry?: Date;
    authorisedVehicleClasses: string[];
  },
) {
  const existing = await prisma.driver.findFirst({ where: { tenantId, employeeNumber: data.employeeNumber } });
  if (existing) return existing;
  return prisma.driver.create({ data: { tenantId, status: "ACTIVE", ...data } });
}

async function upsertVehicle(
  tenantId: string,
  data: {
    fleetNumber: string;
    registrationNumber: string;
    vin: string;
    make: string;
    model: string;
    year: number;
    colour: string;
    category: "PASSENGER" | "LIGHT_COMMERCIAL" | "TRUCK" | "TRUCK_DUAL_REAR_WHEEL" | "TRAILER" | "CUSTOM";
    assignedDriverId?: string;
    tyrePositionConfigId: string | null;
    licenceDiscExpiry?: Date;
    roadworthyExpiry?: Date;
    insuranceExpiry?: Date;
    operationalStatus: "OPERATIONAL" | "WORKSHOP_LOCKOUT" | "SECURITY_LOCKOUT" | "DECOMMISSIONED";
  },
) {
  const existing = await prisma.vehicle.findFirst({ where: { tenantId, registrationNumber: data.registrationNumber } });
  if (existing) return existing;
  return prisma.vehicle.create({ data: { tenantId, ...data } });
}

async function upsertMovement(
  tenantId: string,
  data: {
    siteId: string;
    vehicleId: string;
    driverId: string;
    trailerVehicleId?: string;
    movementType: "ENTRY" | "EXIT" | "DELIVERY" | "COLLECTION" | "RETURN" | "SITE_TRANSFER" | "MAINTENANCE" | "OTHER";
    purpose?: string;
    destination?: string;
    customerProjectJobReference?: string;
    deliveryOrCollectionReference?: string;
    purchaseOrderReference?: string;
    approvedCargoSummary?: string;
    sealOrContainerReference?: string;
    requesterUserId: string;
    approverUserId?: string;
    status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED" | "IN_PROGRESS" | "COMPLETED";
    referenceCode: string;
  },
) {
  const existing = await prisma.movementAuthorisation.findUnique({ where: { referenceCode: data.referenceCode } });
  if (existing) return existing;
  return prisma.movementAuthorisation.create({ data: { tenantId, ...data } });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

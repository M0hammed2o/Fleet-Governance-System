# CHANGELOG.md

## 2026-07-27 (Phase 9) — on-device one-to-one facial verification and basic liveness
### Added
- Phase 9 — a real, working, commercially-licensed on-device facial-recognition and basic-liveness
  pipeline (FACE-001..009), extending (not replacing) the existing FacialVerificationProvider adapter and
  manual-fallback workflow: driver biometric enrolment (3-5 guided captures, quality-checked, encrypted
  AES-256-GCM template, restricted-role gated, re-enrolment/revocation, full audit history); real
  one-to-one matching against exactly the driver assigned to a gate event's own approved movement (never a
  global search), recording a full audit trail for every attempt; a basic active liveness challenge
  (blink/turn/move-closer) that a single still photo can never complete; a cloud-liveness-fallback
  interface with an honest no-op provider and per-tenant usage tracking for future billing; server-side
  rate limiting on verification attempts; a gate-tablet interface with large, simple states and no raw
  confidence score shown; a full Playwright workflow test exercising every result outcome across six real
  role logins using only synthetic (non-biometric) descriptor data. Commercial licensing for the
  recognition/liveness models was independently verified against primary sources before any model was
  added (FACIAL_VERIFICATION_LICENSING.md) — one candidate model and one alternative library were
  evaluated and explicitly not used because their licensing could not be confirmed as commercially clear.

### Fixed
- A real high-severity bug found via live browser verification: the facial-verification pages crashed on
  every request because a browser-only face-recognition library was evaluated during Next.js's
  server-side render pass (a `"use client"` component still renders once on the server before hydrating).
  Fixed by converting the browser-only model loaders to dynamic `import()`, resolved only after hydration.

## 2026-07-27 (Phase 8E) — completes Phase 8
### Added
- Phase 8E — retention operationalisation and corrections (8E-001..007): automatic `scheduledDeletionAt`
  assignment on every new evidence upload, plus a safe forward-only backfill for pre-existing records; an
  explicit `retentionExtendedAt` marker so a human's manual extension is never silently overwritten;
  idempotent, deduplicated retention-expiry notifications (`RetentionNotificationRecord`, a hard uniqueness
  constraint per asset/milestone/date) via a provider-neutral dev-console/no-op notification boundary; a
  full background-job architecture (`JobRun` bookkeeping, a hard database-enforced one-running-job-at-a-time
  guarantee, dual service-token/admin-session auth, a local CLI) covering notification generation/delivery,
  due-deletion completion, failed-upload cleanup, export-link expiry, archive-usage reporting, support-
  session expiry, and storage-summary recalculation; a full retention management UI (`/admin/retention`) —
  policies, evidence browsing, legal/investigation holds, retention extension, archive selection, export and
  dual-control deletion requests, recovery-period status, deletion certificates; browser video-capture cost
  controls (native MediaRecorder — 720p/24-30fps target, configurable 30-60s max with countdown/auto-stop,
  configurable bitrate, live size estimate, policy rejection, honestly-reported actual capture metadata);
  deterministic per-test-file database cleanup, ending unbounded fixture-tenant growth across repeated test
  runs. 53 net new tests (539/539 total).

### Fixed
- A tenant with nothing archived was quoted the lowest paid archive tier's price (R149/month) instead of
  R0 — `getArchiveTierForBytes(0)` now returns a dedicated zero-cost tier.
- A tenant with exactly 1TB archived incorrectly fell into the "more than 1TB, custom quotation" tier
  instead of the flat 501GB-1TB price, because that tier's boundary used a decimal-GB assumption (1000)
  against a codebase that computes GB as 1024-based throughout — corrected to 1024.
- `VideoCaptureRecorder`'s camera-acquisition request used a hard minimum frame-rate constraint, which threw
  `OverconstrainedError` and refused to open the camera at all on any device that couldn't guarantee it
  (found live via a real, fake-camera-device Playwright browser test) — changed to a soft/ideal constraint;
  the actually-achieved frame rate is still reported honestly in the captured evidence's metadata.

## 2026-07-26 (Phase 8D)
### Added
- Phase 8D — platform-admin and customer-admin storage dashboards (DASH-001..003): every stat from the
  brief (active vehicles, current storage, storage by category, monthly growth, evidence approaching
  expiry, evidence under hold, export requests, pending deletions, archive plan, estimated storage charge,
  failed uploads, storage warnings), computed via a fixed, batched set of aggregate queries across every
  tenant at once rather than a per-tenant loop. Both dashboards are read-only; no new elevation path for
  platform staff. 8 new tests (486/486 total).

### Fixed
- BUG-005 — the storage dashboards counted a permanently-deleted asset's bytes as "current storage" because
  the aggregate query checked only `uploadStatus`, not `retentionStatus`. Fixed to exclude `DELETED` assets
  entirely and count `ARCHIVED` bytes only in the separate archive total, never both.

## 2026-07-26 (Phase 8C)
### Added
- Phase 8C — retention, archive and deletion (RETAIN-001..010): per-category retention policies (12-month
  rolling default, overridable), replacing the never-enforced single tenant-wide `Tenant.retentionDays`
  (removed); legal-hold and investigation-hold as hard, unconditional deletion blockers; a dual-control
  deletion-request workflow (a Company Administrator initiates, a different authorised user approves,
  eligibility re-checked at every stage) with a configurable 30-day recovery window before anything is
  permanently deleted; an immutable deletion certificate with a checksum manifest, the evidence's structured
  metadata always surviving as the historical record even after its binary is gone; an export-and-then-
  delete workflow producing a signed per-file manifest; retention-extension and paid-archive workflows; a
  storage billing-hook interface (no billing vendor chosen yet) and the specified archive pricing
  configuration (R149-R899/month, R1,500-R9,000/year across four tiers, custom quotation beyond 1TB, all ZAR
  excluding VAT); retention-expiry notification milestones computed for 90/60/30/7 days and expiry (no real
  delivery — no notification provider exists yet). 35 net new tests (478/478 total).

## 2026-07-26 (Phase 8B)
### Added
- Phase 8B — cost-efficient object-storage architecture (MEDIA-001..012): `ObjectStorageProvider` extended
  with presigned upload/download and category-aware storage keys; `R2CompatibleStorageProvider` (a real
  `@aws-sdk/client-s3` client against Cloudflare R2's endpoint shape — blocked, no Cloudflare account
  exists); ten evidence categories (driver portraits, facial audits, vehicle inspection photos/video, damage
  evidence, cargo evidence, delivery documents, investigation evidence, generated reports, other documents)
  each with their own compression profile and original-retention policy; real image compression (WebP,
  ≤1920px, 75-82% quality) with the checksum always computed on the final compressed bytes, never the
  client's original upload; thumbnails; an upload-status lifecycle (PENDING/PROCESSING/READY/FAILED) with
  automated cleanup of abandoned uploads; per-tenant/per-category storage usage accounting. Video
  compression ships as configuration + a documented passthrough (no ffmpeg in this environment) rather than
  an unverified transcoder. 27 net new tests (443/443 total).

## 2026-07-26 (Phase 8A)
### Added
- Phase 8A — engineering hardening (HARD-001..006): an automated clean-database migration verification
  script (`npm run verify:clean-migrations`); tenant-timezone-aware vehicle-use-policy evaluation
  (`Tenant.timezone`, previously unused, now actually drives day/hour/weekend checks); real per-trip/daily/
  weekly/monthly distance accumulation from telematics odometer readings (`lib/telematics/distance-engine.ts`,
  pure and timezone-aware); GPS-exception deduplication with episode tracking, escalation after repeated
  observation, and automatic clearing on a return to compliance; removed the obsolete
  `vite-tsconfig-paths` plugin in favour of Vite's native option. 20 new tests (416/416 total).

### Fixed
- BUG-004 — `getCustomerHealthSummaries()` fired an unbounded ~9-queries-per-tenant fan-out, which
  saturated the database connection pool once enough fixture tenants had accumulated and caused
  intermittent test timeouts (surfacing as a Postgres "client already executing a query" deprecation
  warning). Rewritten to use grouped aggregate queries — 9 total, regardless of tenant count.

## 2026-07-24
### Added
- Phase 7 — platform support-access view (SUPPORT-001..004), the final phase of this build run: a
  real DB-backed customer health-summary list (site/gate/vehicle/user counts, open critical exceptions,
  GPS status, storage usage, onboarding status), a time-limited and fully audited `SupportAccessSession`
  mechanism (mandatory reason, immediate exit, explicit elevation workflow), a bounded read-only "support
  view" of one customer tenant scoped to an active session, and a new "Platform Support Analyst" role
  alongside Platform Administrator. Tenant isolation is enforced live on every request — a session opened
  for one customer grants zero access to another, and an expired session is rejected immediately, same
  pattern as ordinary session validation. 22 new tests (396/396 total). Subscription billing and full
  investigation-case management remain explicitly out of scope, per the user's instruction — this is the
  deliberate stopping point for the current run.
- Phase 6 — telematics foundation, basic geofencing, and vehicle-use policies (GPS-001..006/GPS-BLOCKED,
  POLICY-001/002): a provider-neutral `TelematicsProvider` interface with a deterministic mock (production
  vendor connection explicitly blocked pending the user's decision), a manual GPS confirmation fallback
  mirroring the existing facial-verification pattern, simple circular geofences, and a full
  `VehicleUsePolicy` model (named driver, assigned vehicles, permitted days/hours, approved geofence, km
  limits, after-hours/weekend/private-use flags, named approving manager). Geofence and policy violations
  raise a real Exception through the existing Phase 3 workflow — `Exception.gateEventId` is now nullable
  and a `vehicleId` was added so a violation with no gate event in context can still use the same table,
  never a parallel one. 41 new tests (374/374 total).
- Phase 5C — dispatch workflow enhancements (DISPATCH-001..005): three new `MovementType` values (sales
  visit, service, authorised private use), sender/recipient fields, and an optional (not-yet-FK)
  vehicle-use-policy reference on `MovementAuthorisation`; secure delivery-note/supporting-document upload
  reusing the existing Phase 4 MediaAsset architecture with zero new routes; movements admin UI extended
  with the new fields and an inline document upload/list. 11 new tests (333/333 total).
- Phase 5B — departure/return reconciliation (RECON-001..003): `Reconciliation`/`ReconciliationDiscrepancy`
  models, automatic pairing of a movement's departure and return gate events (by chronological order, not
  a hardcoded direction — works for both a fleet vehicle leaving-then-returning and a visitor
  entering-then-leaving), a pure comparison engine covering odometer/fuel/tyre/condition/cargo discrepancies
  generically off the existing configurable inspection-item taxonomy, mandatory-explanation human
  resolution workflow, and a reconciliation list/detail admin UI. Significant discrepancies raise a real
  Exception through the existing Phase 3 workflow rather than a parallel mechanism.
- 28 new tests (322/322 total) covering valid/duplicate/reversed/mismatched pairing, cross-tenant isolation,
  every discrepancy category, resolution and its audit trail, and role-based authorization; full live curl
  verification of the end-to-end flow including departure/return through two different gates and every
  4xx error path (no raw 500s).

## 2026-07-23
### Added
- First Git checkpoints for the repository (`c5e5d33`, `7e2a455`) — 198 tracked files, previously
  uncommitted despite four completed build phases.
- Remapped the 8 seeded tenant roles onto 9 (six primary customer roles + three additional non-daily
  profiles), per an expanded, more detailed role specification: merged Security Manager + Approving
  Manager into "Security Supervisor / Approving Manager"; split Fleet Manager into "Dispatch and
  Logistics Officer" and "Fleet and GPS Manager"; renamed Risk/Compliance Manager, Internal Auditor, and
  Executive Viewer; added a new "External Reviewer" profile. See DECISIONS.md D-015.
- 8 new segregation-of-duties tests (294/294 total) proving the new role boundaries hold, plus a live
  curl regression check that the renamed "Fleet and GPS Manager" can no longer create movements (that
  capability moved to "Dispatch and Logistics Officer").
- Expanded product requirements transcribed into PRODUCT_REQUIREMENTS.md: departure/return reconciliation
  detail, dispatch-workflow enhancements, a provider-neutral telematics foundation, vehicle-use policies,
  and a controlled platform support-access view — all `todo`, targeting a real-customer pilot by October
  2026.
- A real project README, replacing the unedited `create-next-app` boilerplate.

### Fixed
- Completed a Phase 4 independent-verification step that had been interrupted by an incorrect column
  name in a manual SQL query (`checksum` vs the actual `checksumSha256`) — no application defect, the
  correct query confirmed all 3 seeded MediaAsset checksums match their stored files byte-for-byte.

## 2026-07-22
### Added
- Phase 3 gate operations: GateEvent state machine (11 states), configurable guided-inspection engine
  (versioned InspectionTemplate/InspectionItem), tenant-configurable ExceptionType catalogue with a hard
  (non-tenant-configurable) self-approval rule for serious exceptions, a real DB-backed security
  dashboard, and the full tablet-friendly gate check-in/check-out UI wiring the existing
  FacialVerificationProvider mock and ManualFacialVerificationFallback into the live flow.
- 163 new automated tests (259/259 total) covering the state machine, gate-event business rules,
  tenant isolation, and inspection-template versioning.

### Fixed
- BUG-003: five precondition-violation checks in `gate-event-repository.ts` threw an untyped `Error`,
  surfacing as a generic 500 instead of a proper 409/404. Found via independent live-curl
  re-verification of the Phase 3 work; fixed with typed error classes and 4 regression tests.

## Unreleased
### Added
- Project memory documentation set (PROJECT.md, PRODUCT_REQUIREMENTS.md, MVP_SCOPE.md, ARCHITECTURE.md,
  DATA_MODEL.md, SECURITY_AND_POPIA.md, INTEGRATIONS.md, DECISIONS.md, WORKLOG.md, TODO.md,
  KNOWN_BUGS.md, TESTING.md, DEPLOYMENT.md).
- Dedicated git repository scoped to the project folder.
- Next.js 16 + TypeScript strict + Tailwind app foundation.
- Prisma schema and migrations for Tenant, Site, Gate, User, Role, Permission, RolePermission,
  UserPermissionOverride, Session, ApprovalDelegation, AuditLog; local Postgres via Docker Compose.
- Auth foundation: bcrypt password hashing, DB-backed hashed-token sessions, permission evaluation
  (role → per-user override → approval delegation), append-only audit logging on login/logout.
- Seed script producing a platform tenant and a demo tenant with all 8 build-brief roles and one
  fictional user each.
- Vitest integration test suite against a real Postgres test database, including the mandatory
  tenant-isolation gate; Playwright config wired for future e2e specs.
- User invitation workflow (invite by email, accept via token, dev-mode link since no email provider yet).
- Account suspension/reactivation, with existing sessions revoked on suspend.
- Platform Administrator narrowed to an explicit, permission-checked, audit-logged `platformTenant`
  surface (tenant list/create/status only — no access to any tenant's business data).
- Postgres-level trigger enforcing `audit_logs` append-only, in addition to the existing single-write-path
  application convention.
- Seed script now refuses to run against a non-localhost database or with `NODE_ENV=production`.

### Fixed
- A `ForbiddenError` raised inside a repository function (rather than a route's own permission check)
  was surfacing as a 500 instead of a 403.
- Login and invitation-acceptance only checked the user's own status, not their tenant's — a user of a
  tenant a Platform Administrator had suspended could still start a brand-new session. See KNOWN_BUGS.md
  BUG-002.

## 2026-07-21
### Added
- Organisation admin (sites, gates), driver register, vehicle register with server-side VIN/registration
  uniqueness enforcement, reusable compliance-document model with tenant-configurable expiry rules,
  configurable tyre-position layouts (5 system layouts seeded), and full movement-authorisation workflow
  with a self-approval-blocking approval state machine.
- Read-only gate-facing lookup for finding an approved movement by registration, fleet number, driver
  name, or reference — no mutating route exists anywhere under `/api/gate/`.
- Facial-verification provider interface with a deterministic mock implementation, plus a separate
  audited manual-fallback workflow (request/approve/deny, self-approval blocked).
- 51 new automated tests (96/96 total) covering the state machine, self-approval, driver/vehicle
  movement-eligibility rules, cross-tenant isolation for all new entities, VIN/registration uniqueness,
  document-expiry evaluation, and the gate lookup's read-only/permission boundaries.

# CHANGELOG.md

## 2026-07-24
### Added
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

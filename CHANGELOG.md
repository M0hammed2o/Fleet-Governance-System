# CHANGELOG.md

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

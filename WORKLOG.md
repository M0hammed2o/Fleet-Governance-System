# WORKLOG.md

## 2026-07-19 — Session 1 — Phase 0: repository assessment + project memory
**Objective:** Inspect repository state, establish project memory documentation, begin Phase 1 foundation.

**Findings:**
- Project folder was completely empty (true greenfield).
- Node v24.14.1, npm 11.11.0 available. Docker running with unrelated containers for other projects
  occupying default Postgres ports (5432, 55432).
- Only pre-existing git repo on the machine was rooted at the Windows home directory with zero commits;
  not usable/appropriate for this project. Initialised a dedicated repo at the project root instead
  (Decision D-003). Home-directory repo left untouched.

**Files changed:**
- Created: PROJECT.md, PRODUCT_REQUIREMENTS.md, MVP_SCOPE.md, ARCHITECTURE.md, DATA_MODEL.md,
  SECURITY_AND_POPIA.md, INTEGRATIONS.md, DECISIONS.md, WORKLOG.md (this file), TODO.md, KNOWN_BUGS.md,
  TESTING.md, DEPLOYMENT.md, CHANGELOG.md.
- Created: `docs/workflows/`, `docs/modules/`, `docs/api/`, `docs/decisions/`, `docs/testing/`,
  `docs/security/` (empty, populated as each phase produces content).
- `git init` at project root.

**Database changes:** none yet.

**Tests run:** none yet — no code exists.

**Decisions made:** D-001 (Prisma over raw Supabase SDK), D-002 (custom session auth, not
NextAuth/Supabase Auth), D-003 (dedicated git repo). Full detail in DECISIONS.md.

**Remaining work:** Scaffold Next.js app, Prisma schema + local Postgres, auth foundation, seed data,
test foundation — tracked as FOUND-SCAFFOLD-1..5 in TODO.md "Now".

**Exact recommended next action:** Continue this session with FOUND-SCAFFOLD-1 (Next.js scaffold), then
FOUND-SCAFFOLD-2 (Prisma schema + migration against local Docker Postgres on a non-conflicting port).

---

## 2026-07-19 — Session 1 continued — Phase 1: foundation implemented and verified
**Objective:** Complete FOUND-SCAFFOLD-1..5 — working app shell, DB, auth, seed data, tests.

**Stack notes for future sessions (read before touching Prisma/Next config):**
- Next.js 16.2.10 / React 19.2.4 were installed (npm always resolves latest). API differs from
  Next 14 training-data assumptions in ways that mattered here: `cookies()` is async, `next.config.ts`
  needed `turbopack.root` pinned explicitly because this Downloads folder has unrelated sibling projects
  with their own lockfiles that confuse Next's workspace-root auto-detection.
- Prisma 7.8.0 was installed. Breaking changes from the Prisma 5/6 era that mattered: the `prisma-client`
  generator now emits TypeScript source (not a prebuilt package) to `src/generated/prisma`; `PrismaClient`
  now **requires an explicit driver adapter** (`@prisma/adapter-pg` + `pg`), there is no more
  zero-config binary query engine; config lives in `prisma.config.ts`, not `package.json#prisma`.
- **`prisma migrate dev` does not work in a non-interactive shell** (this Bash tool) — it hard-errors
  "non-interactive environment...not supported" even with piped input. Workflow used instead: hand-author
  `prisma/migrations/<ts>_<name>/migration.sql`, then `prisma migrate deploy` (non-interactive) to apply
  and record it. Do this for all future schema changes in this environment; don't waste time retrying
  `migrate dev` flags.

**Files changed (created unless noted):**
- `docker-compose.yml` — local Postgres 16, host port 55490 (55490 chosen to avoid the other Postgres
  containers already running on this machine on 5432/55432/5434).
- `.env.example`, `.env` (gitignored), `.env.test` (gitignored) — DB/session/storage config.
- `prisma/schema.prisma` — Tenant, Site, Gate, User, Role, Permission, RolePermission,
  UserPermissionOverride, Session (with hashed `tokenHash`, not the raw bearer token), ApprovalDelegation,
  AuditLog.
- `prisma/migrations/20260719193452_init/`, `prisma/migrations/20260719193600_session_token_hash/`.
- `prisma/seed.ts` — seeds a system "platform" tenant (Platform Administrator role, restricted to a new
  `platformTenant` permission resource — see design note below) and a demo tenant "acme-logistics" with
  one site, two gates, all 8 tenant-scoped roles from the build brief, and one fictional user per role,
  all sharing dev password `GateFleet!Dev1`.
- `src/lib/db/prisma.ts` — Prisma client singleton using the pg driver adapter.
- `src/lib/db/tenant-scope.ts` — `tenantWhere()` merge helper convention.
- `src/lib/auth/password.ts`, `session.ts`, `authorize.ts`, `permissions.ts` — bcrypt hashing, DB-backed
  hashed-token sessions, permission evaluation (role → per-user override → approval delegation, with
  REVOKE overrides always winning), the permission catalogue.
- `src/lib/audit/record-audit.ts` — single write path for AuditLog.
- `src/lib/repositories/user-repository.ts` — `findUserForLogin(tenantSlug, email)`.
- `src/lib/validation/auth.ts` — Zod login schema.
- `src/app/api/auth/login/route.ts`, `logout/route.ts` — login/logout route handlers, audit-logged,
  constant-time-ish credential check (dummy bcrypt hash when user not found).
- `src/app/login/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/page.tsx` (rewritten) — minimal UI
  proving the flow end-to-end; role-appropriate dashboards are Phase 3+ work.
- `vitest.config.ts`, `tests/mocks/server-only-noop.ts`, `tests/helpers/fixtures.ts`,
  `tests/tenant-isolation.test.ts`, `tests/authorize.test.ts` — integration tests against a real
  Postgres test database (`gate_fleet_governance_test`, same container, separate DB).
- `playwright.config.ts` — wired for Phase 3+ e2e specs; no specs exist yet.
- `scripts/test-db-setup.mjs` — `pretest` hook applying migrations to the test DB.
- `next.config.ts` — added `turbopack.root` (see stack notes above).
- `package.json` — scripts: `dev/build/start/lint/seed/pretest/test/test:watch/e2e`.

**Design note — Platform Administrator is cross-tenant:** the build brief has this role "manage tenant
organisations," which doesn't fit the tenant-scoped Role/User model everything else uses. Handled by
giving Platform Administrator users their own system "platform" tenant and a new `platformTenant`
permission resource (view/create/edit/configure), scoped to managing `Tenant` rows only — they are **not**
granted any permission over other tenants' business resources by default. Any future "support access to
a customer tenant" capability must be a separate, explicitly audit-logged break-glass mechanism, per the
build brief's "cannot silently access tenant evidence" requirement — not implemented yet, flagged in
TODO.md.

**Database changes:** 2 migrations applied to both dev and test databases (see files above). Seed run
against dev DB only.

**Tests run:**
- `npx tsc --noEmit` — clean, 0 errors.
- `npm run lint` (ESLint via next lint) — clean, 0 warnings/errors.
- `npm run build` (production build, Turbopack) — succeeded, 6 routes compiled.
- `npm test` (Vitest against real Postgres test DB) — **10/10 passed**, including the mandatory
  "Tenant A cannot access Tenant B data" gate (tenant-isolation.test.ts, 4 cases) and full
  `hasPermission()` precedence coverage (authorize.test.ts, 6 cases: role-grant, no-grant, REVOKE-wins,
  GRANT-without-role, active-delegation-grants, expired-delegation-denies).
- Manual end-to-end verification with `npm run dev` + `curl`: login with seeded Company Administrator
  credentials → 200 + session cookie; `/dashboard` with that cookie → 200, correctly shows role "Company
  Administrator"; wrong password → 401; correct password against wrong tenant slug → 401; `/dashboard`
  with no cookie → 307 redirect to `/login`; logout → 200 and revokes the session (subsequent `/dashboard`
  request with the same now-revoked cookie → 307). Confirmed via `docker exec ... psql` that both
  `auth.login` and `auth.logout` produced `audit_logs` rows with `userId` populated.
- Not run: Playwright e2e (no specs exist yet — nothing to run).

**Decisions made:** none new beyond D-001/D-002/D-003 already in DECISIONS.md; the Platform Administrator
cross-tenant handling above is an implementation detail of D-002/tenant-isolation strategy, not a new
top-level decision, but is significant enough that a future session should read this entry before
touching Role/Tenant modeling.

**Remaining work (Phase 1 not yet done):** password reset (FOUND-003), user invitation flow (FOUND-008),
account suspension route/UI (FOUND-009 — status field + login enforcement exist, no admin action to set
it), reauthentication for sensitive actions (FOUND-010), Postgres RLS defense-in-depth (SEC-2, deferred
to Phase 7 per ARCHITECTURE.md). None of these block starting Phase 2 (master data) — they're
foundation-hardening items that can land alongside or after Phase 2 begins.

**Exact recommended next action:** Start Phase 2 (MD-001..006 in PRODUCT_REQUIREMENTS.md): company/site/
gate CRUD UI (data already modeled), then Driver register, Vehicle master register, tyre-position config,
movement authorisation. Alternatively, close out the remaining FOUND items above first if the user wants
Phase 1 fully closed before Phase 2 starts — not yet asked; defaulting to proceeding into Phase 2 per the
"continue until blocker" instruction unless redirected.

---

## 2026-07-20 — Session 2 — Phase 1 security closure (user request), then into Phase 2
**Objective:** User explicitly requested a focused Phase 1 security closure (10 items: invitations,
suspension, session-expiry tests, delegation tests, cross-tenant admin tests, Platform Administrator
review, seed-password guard, audit-log DB protection, documented-not-built password reset/reauth) before
continuing into Phase 2.

**Files changed (created unless noted):**
- `prisma/schema.prisma` (edited) — `User.passwordHash` now nullable; added `UserInvitation`.
- `prisma/migrations/20260720080000_invitations_and_audit_protection/` — schema change above +
  Postgres triggers (`prevent_audit_log_modification`) blocking UPDATE/DELETE on `audit_logs`.
- `src/lib/auth/invitation.ts` — `createInvitation`, `validateInvitationToken` (now also checks tenant
  status — see BUG-002), `markInvitationAccepted`.
- `src/lib/auth/api-guard.ts` — `requireApiPermission`/`requireApiSession`/`apiErrorResponse` shared route
  helper (now also maps `ForbiddenError` → 403, see BUG-001).
- `src/lib/auth/login-eligibility.ts` — `isEligibleToAuthenticate()`, the single source of truth for
  "may this user start a session" (status + tenant status), added specifically to fix BUG-002.
- `src/lib/db/seed-guard.ts` — `assertSafeToSeed()`, refuses to run outside localhost / with
  NODE_ENV=production; wired into `prisma/seed.ts`.
- `src/lib/repositories/site-repository.ts`, `gate-repository.ts` — tenant-scoped CRUD (pulled forward
  from Phase 2 to have something real to write cross-tenant-admin tests against).
- `src/lib/repositories/user-repository.ts` (edited) — added `findUserByIdInTenant`, `listUsersInTenant`,
  `listPendingInvitationsInTenant`.
- `src/lib/repositories/platform-tenant-repository.ts` — the sole cross-tenant access surface for
  Platform Administrator (D-005): `listAllTenantsAsPlatformAdmin`, `createTenantAsPlatformAdmin`,
  `setTenantStatusAsPlatformAdmin`, each permission-checked and audit-logged inline.
- `src/lib/auth/session.ts` (edited) — extracted `evaluateSession()` as a pure, directly-unit-testable
  decision function; `getSession()` now just calls it.
- Routes: `src/app/api/admin/users/route.ts` (list), `.../invite/route.ts`, `.../[id]/suspend/route.ts`,
  `.../[id]/reactivate/route.ts`, `src/app/api/admin/roles/route.ts`, `src/app/api/auth/accept-invitation/route.ts`,
  `src/app/api/platform/tenants/route.ts`, `.../[id]/status/route.ts`.
- Pages: `src/app/admin/users/page.tsx`, `src/app/accept-invitation/page.tsx`, `src/app/platform/tenants/page.tsx`.
- `src/app/api/auth/login/route.ts` (edited) — now uses `isEligibleToAuthenticate()` (BUG-002 fix).
- Tests added: `tests/session.test.ts` (8 unit + 1 integration), `tests/tenant-isolation-admin.test.ts`
  (4 cases), `tests/platform-admin.test.ts` (5 cases), `tests/seed-guard.test.ts` (6 cases),
  `tests/login-eligibility.test.ts` (4 unit + 1 integration), `tests/invitation.test.ts` (6 cases).
- `tests/helpers/fixtures.ts` (edited) — `unique()` switched from a per-module counter to
  `crypto.randomUUID()` after discovering it collided across parallel test-file workers (each file is a
  separate module instance with its own counter starting at 0).

**Database changes:** 1 new migration, applied to both dev and test databases.

**Bugs found and fixed during this session (full detail in KNOWN_BUGS.md):**
- **BUG-001:** a `ForbiddenError` thrown inside a repository function (not the route's own
  `requireApiPermission`) surfaced as a 500 instead of a 403, because `apiErrorResponse()` didn't know
  about that error class. Found via live curl testing of the Platform Administrator tenant-list endpoint.
- **BUG-002 (higher severity):** login and accept-invitation only checked `user.status`, never
  `tenant.status` — so a user of a tenant a Platform Administrator had just suspended could still start a
  **brand-new** session (existing sessions were correctly rejected by `evaluateSession()`, but new logins
  were not). Found via live curl testing (suspend tenant → login still returned 200). Fixed by
  centralising the check in `isEligibleToAuthenticate()`, used by the login route, and adding an
  equivalent tenant-status check inside `validateInvitationToken()`. Both now have regression tests.

**Tests run:**
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean after fixing two `react-hooks/set-state-in-effect` errors in the new
  `admin/users` and `platform/tenants` pages (deferred the initial `load()` call in `useEffect` via
  `queueMicrotask` so the async function's synchronous `setState` calls don't run inside the effect body).
- `npm run build` — clean, 16 routes.
- `npm test` — **45/45 passing** (8 test files) after fixing two test-fixture bugs found on first run:
  a wrong boundary-expiry assertion, and the `unique()` counter collision described above.
- Manual end-to-end verification via `npm run dev` + curl, in order: invite a user → accept invitation
  (replay correctly rejected with "already used") → new user reaches `/dashboard` → suspend the user →
  their existing session is revoked (307 to `/login`) → they cannot log back in (401) → suspending an
  already-suspended user 409s → reactivate → they can log in again (200). Then, as Platform Administrator:
  list tenants (200) → Company Administrator confirmed forbidden (403, after the BUG-001 fix) → suspend
  `acme-logistics` tenant → its Company Administrator's login now correctly rejected (401, after the
  BUG-002 fix) → reactivate tenant (cleanup).

**Decisions made:** D-004 (password reset / reauthentication designed, not built), D-005 (Platform
Administrator scoped to a dedicated `platformTenant` permission, not blanket access). Full detail in
DECISIONS.md.

**Remaining work:** None of the 10 requested closure items are outstanding. FOUND-003 and FOUND-010 are
intentionally design-only per the user's own instruction not to let them block Phase 2.

**Exact recommended next action:** Proceed into Phase 2 (master data + movement authorisation) per the
user's instructions — organisation/site/gate admin UI (site/gate repositories already exist from this
session, need routes+UI), then Driver register, Vehicle register, documents, tyre config, movement
authorisation, approval workflow, gate-facing lookup.

---

## 2026-07-21 — Session 3 — Phase 2: master data and movement authorisation
**Objective:** User instructed to continue directly into Phase 2 after the security closure — organisation/
site/gate admin, driver register, vehicle register, document/compliance records with tenant-configurable
expiry rules, tyre-position configuration, movement authorisation with a full approval state machine, and
a read-only gate-facing lookup — plus tests for a long explicit list of scenarios.

**Schema (2 new migrations, applied to dev + test DB):**
- `20260720140000_phase2_master_data`: Driver, Vehicle (registrationNumber unique-per-tenant required,
  vin unique-per-tenant when present), ComplianceDocument (shared driver/vehicle document model),
  DocumentExpiryRule, TyrePositionConfig/TyrePositionDefinition/VehicleTyre, MovementAuthorisation;
  added `Tenant.allowSelfApproveMovement` (default false).
- `20260720150000_manual_facial_verification_fallback`: ManualFacialVerificationFallback.

**Permission catalogue extended** (`lib/auth/permissions.ts`): `driver`, `vehicle`,
`complianceDocument`, `tyrePositionConfig`, `movement`, `facialVerificationFallback` resources — seed
role-permission matrix updated so each of the 8 tenant-scoped roles gets a deliberately differentiated
slice (e.g. Fleet Manager can create/edit movements but not approve them; Approving Manager can
approve/reject but not create — this separation is what makes the self-approval and
unauthorised-approval tests meaningful rather than vacuous).

**Code landed (by area):**
- Organisation: `site-repository.ts`, `gate-repository.ts` (pulled forward from this session's Phase 1
  closure work), routes under `/api/admin/{sites,gates}`, `/admin/organisation` page.
- Driver register: `driver-repository.ts` (search/filter/pagination, `isDriverAvailableForMovement`),
  `/api/drivers/*`, `/admin/drivers` + `/admin/drivers/[id]` pages.
- Vehicle register: `vehicle-repository.ts` (`isVehicleAvailableForMovement`,
  `DuplicateVehicleIdentifierError` mapping Postgres P2002 to a friendly 409 — server-side enforcement,
  not just the frontend), `/api/vehicles/*`, `/admin/vehicles` + `/admin/vehicles/[id]` pages.
- Compliance documents: `compliance-document-repository.ts`, `document-expiry-rule-repository.ts`,
  `lib/documents/expiry-rules.ts` (`evaluateDocumentExpiry` — pure, DB-free), `/api/compliance-documents/*`,
  `/api/admin/document-expiry-rules`, `/admin/document-rules` page, shared
  `components/compliance-documents-panel.tsx` (used by both driver and vehicle detail pages).
- Tyre configuration: `tyre-config-repository.ts`, `/api/admin/tyre-position-configs`,
  `/api/vehicles/[id]/tyres`, `/admin/tyre-configs` page. 5 system layouts seeded (Passenger, Light
  Commercial, Truck, Truck dual-rear-wheel, Trailer).
- Facial verification: `lib/facial-verification/{provider,mock-provider}.ts`,
  `facial-verification-repository.ts` (manual fallback, self-approval blocked), routes under
  `/api/drivers/[id]/facial-verification/*` and `/api/facial-verification/manual-fallback/[id]/resolve`,
  dev-only test buttons on the driver detail page.
- Movement authorisation: `lib/movements/state-machine.ts` (pure transition table),
  `lib/movements/reference-code.ts`, `movement-repository.ts` (create/submit/approve/reject/cancel/
  expire/start/complete, self-approval rule, driver/vehicle eligibility checks, gate search), routes
  under `/api/movements/*`, `/admin/movements` + `/admin/movements/[id]` pages.
- Gate-facing lookup: `/api/gate/movements/search` (GET only — no mutating handler exists in that route
  file or anywhere under `/api/gate/`), `/gate` page (tablet-sized touch targets, read-only display).

**Design decisions:** D-006 (no dedicated Department entity — `Driver.department` stays a plain string,
scope trim since Phase 2 instructions didn't name it), D-007 (business rules — self-approval,
driver/vehicle eligibility, state-machine validity — live in the repository layer, not the route, so
they're directly unit-testable and apply to every caller). Full detail in DECISIONS.md.

**A design tension worth recording:** Driver.licenceExpiry/pdpExpiry and Vehicle.licenceDiscExpiry/
roadworthyExpiry/insuranceExpiry are stored *both* directly on those models *and* as ComplianceDocument
rows. This is intentional duplication (brief explicitly lists both as direct fields AND wants a reusable
document/compliance structure) but is a real drift risk — noted in DATA_MODEL.md so a future session
doesn't "fix" it into a single source of truth without reading why it's there.

**Tests run:**
- `npx tsc --noEmit` — clean throughout (ran after each module, not just at the end).
- `npm run lint` — clean after fixing two more `react-hooks/set-state-in-effect` errors (organisation
  page) and one `react-hooks/purity` error (Date.now() called during render in
  compliance-documents-panel.tsx — fixed by computing `isExpired` server-side instead of client-side,
  which is also more correct since it avoids client/server clock skew).
- `npm run build` — clean, 60 routes.
- `npm test` — **96/96 passing** across 15 files. New files this session: movement-state-machine.test.ts
  (10 cases — every terminal state × every other state, plus the happy path and specific illegal jumps),
  movement-repository.test.ts (10 cases — driver/vehicle eligibility rejection, self-approval rule both
  ways, audit logging, invalid-transition rejection), phase2-tenant-isolation.test.ts (4 cases —
  driver/vehicle/movement cross-tenant), vehicle-uniqueness.test.ts (5 cases), document-expiry.test.ts
  (8 cases), gate-lookup-and-authorization.test.ts (5 cases), facial-verification.test.ts (9 cases).
- Manual end-to-end verification via `npm run dev` + curl, full chain: Fleet Manager creates a movement
  against a WORKSHOP_LOCKOUT vehicle → 409 rejected; against an OPERATIONAL vehicle → 201 DRAFT; submits
  → SUBMITTED; Fleet Manager attempts to approve their own submission → 403 (no APPROVE permission, so
  this exercises the *authorization* boundary — the *self-approval* rule itself is exercised by the
  automated tests since none of the seeded roles have both CREATE and APPROVE); Approving Manager
  approves → APPROVED; Gate Security Officer searches by reference code, registration number, and driver
  name, all find the approved movement with full detail; Gate Security Officer attempts to approve →
  403; `PATCH /api/gate/movements/search` → 405 (route only exports GET). Also verified facial-verification
  mock-verify (VERIFIED) and compliance-document creation via curl.

**Remaining work:** GateEvent itself (Phase 3) isn't built — several TESTING.md mandatory-gate checkboxes
are satisfied against MovementAuthorisation's equivalent behaviour, not a literal GateEvent, and are
noted as such inline. No dashboard surfaces expiring documents yet (data/logic done, UI pending). Tyre
reference-data editing has no UI affordance yet (API route exists and works). Full detail in TODO.md.

**Exact recommended next action:** Begin Phase 3 (gate operations) — GateEvent state machine, security
dashboard, and configurable inspection templates are the three GATE items not yet covered by the
Phase-2-equivalent work done this session.

---

## 2026-07-21 — Session 4 — Phase 3: gate operations
**Objective:** Build the full Phase 3 gate-operations module per PRODUCT_REQUIREMENTS.md GATE-001..006:
a GateEvent state machine distinct from MovementAuthorisation's, a configurable guided-inspection engine,
tenant-configurable exceptions with a hard self-approval rule, a real DB-backed security dashboard, driver
identity verification wired into the gate flow, and a tablet-friendly gate check-in/check-out UI — following
the exact established patterns (pure DB-free state machines, repository-layer business rules per D-007,
`tenantWhere()` scoping, `recordAudit()` for every sensitive mutation, `queueMicrotask(load)` in client
pages) read from `lib/movements/state-machine.ts`, `movement-repository.ts`, and the Phase 2 session's
WORKLOG entry before writing any code.

**Schema (1 new migration, applied to dev + test DB):**
- `20260721160000_phase3_gate_operations`: `InspectionTemplate`, `InspectionItem`, `GateEvent`,
  `GateEventInspectionItem`, `ExceptionType`, `Exception`, plus back-relations added to `Tenant`, `Site`,
  `Gate`, `Vehicle` (two: primary + trailer), `Driver`, `User` (five named relations: officer, decision-by,
  inspection-result-recorded-by, exception-raised-by, exception-resolved-by), and
  `MovementAuthorisation`. Generated via `npx prisma migrate diff --from-config-datasource --to-schema
  prisma/schema.prisma --script` against the hand-written schema, reviewed, then applied with `prisma
  migrate deploy` — same workflow documented in DATA_MODEL.md/WORKLOG.md since Session 1; still works,
  `migrate dev` still doesn't in this non-interactive shell.

**Permission catalogue extended** (`lib/auth/permissions.ts`): `gateEvent` (VIEW/CREATE/EDIT — no APPROVE;
the meaningful approval boundary lives one level down on `exception`), `inspectionTemplate` (VIEW/CREATE/
EDIT/DELETE/CONFIGURE), `exception` (VIEW/CREATE/APPROVE/CONFIGURE — CREATE and APPROVE deliberately
granted to different roles). Seed role-permission matrix (`prisma/seed.ts`) updated for all 8 tenant roles:
Gate Security Officer gets `gateEvent` VIEW/CREATE/EDIT and `exception` VIEW/CREATE only (raises exceptions,
cannot resolve serious ones); Security Manager gets `exception` VIEW/APPROVE/CONFIGURE and
`inspectionTemplate` VIEW/CREATE/EDIT/CONFIGURE (resolves exceptions, manages the checklist); the remaining
six roles get read-only `gateEvent`/`exception`/`inspectionTemplate` VIEW slices appropriate to their
existing Phase 1/2 responsibilities.

**Code landed (by area):**
- State machine: `lib/gate-events/state-machine.ts` — pure, DB-free transition table for 11 states
  (`EXPECTED → INSPECTION_STARTED → IDENTITY_PENDING → IDENTITY_VERIFIED → VEHICLE_CHECKS_IN_PROGRESS →
  [EXCEPTION_RAISED → SUPERVISOR_REVIEW]* → CLEARED|DENIED → COMPLETED`, `CANCELLED` reachable from every
  non-terminal state), same `isValidGateEventTransition`/`assertValidGateEventTransition` shape as the
  movement state machine.
- Inspection engine: `lib/repositories/inspection-template-repository.ts` (`getActiveTemplateForCategory`,
  `createInspectionTemplate`, `createNewTemplateVersion` — immutable-row versioning, see DECISIONS.md D-009),
  `lib/repositories/exception-type-repository.ts` (tenant-configurable catalogue, same shape as
  `document-expiry-rule-repository.ts`).
- Core gate-event logic: `lib/repositories/gate-event-repository.ts` — `startGateEvent` (idempotent,
  re-checks driver/vehicle eligibility at gate time, auto-picks the active inspection template),
  `verifyIdentityForGateEvent`/`markIdentityVerifiedManually` (wires the existing mock
  `FacialVerificationProvider`/`ManualFacialVerificationFallback`, no new mechanism built),
  `recordInspectionResult` (auto-raises an `Exception` on FAIL per the item's configured severity/
  approval-requirement), `raiseException`/`escalateExceptionToSupervisor`/`resolveException` (hard,
  non-tenant-configurable self-approval rule — see DECISIONS.md D-008), `clearGateEvent` (re-checks vehicle
  lockout immediately before deciding, best-effort `startMovement` side effect on ENTRY),
  `denyGateEvent`/`completeGateEvent`/`cancelGateEvent`, `getSecurityDashboardData`-adjacent list/get reads.
- Dashboard: `lib/repositories/security-dashboard-repository.ts` — real DB aggregate queries only (gate
  events today, cleared/denied today, awaiting approval, open high-severity exceptions, GPS-inactive
  vehicles, failed inspection items today, expiring/expired documents reusing `evaluateDocumentExpiry`,
  recent audit activity).
- Routes: `src/app/api/gate/gate-events/route.ts` + `[id]/{route,identity/pending,identity/verify,
  identity/manual-verified,vehicle-checks/start,inspection-results,exceptions,escalate,clear,deny,complete,
  cancel}/route.ts`, `src/app/api/gate/exceptions/[id]/resolve/route.ts`,
  `src/app/api/admin/inspection-templates/{route,[id]/route,[id]/new-version/route}.ts`,
  `src/app/api/admin/exception-types/route.ts`, `src/app/api/security-dashboard/route.ts`.
- Pages: `src/app/admin/security-dashboard/page.tsx` (stat tiles + GPS/expiring-documents/audit panels,
  all real fetches, `queueMicrotask(load)` pattern), `src/app/gate/events/[id]/page.tsx` (the full guided
  flow — identity verification, section-grouped inspection checklist, exception escalate/resolve, clear/
  deny/complete/cancel — one connected page driven entirely by the GateEvent's current status, per the
  build brief's "don't force disconnected re-entry" instruction), `src/app/gate/page.tsx` extended (not
  rewritten) to start a gate event directly from a found movement without retyping anything.
- Validation: `lib/validation/gate-event.ts` (Zod schemas for every new route's body).
- `prisma/seed.ts` extended: one default `InspectionTemplate` ("Standard Gate Inspection", generic,
  14 items across all 7 sections), 4 `ExceptionType` rows, a third demo driver/vehicle/movement
  (`MV-DEMO3`), and two demo `GateEvent`s in different states — one `CLEARED` happy-path event against
  `MV-DEMO1` (also advances that movement to `IN_PROGRESS`, matching the real side effect), one
  `SUPERVISOR_REVIEW` event against `MV-DEMO3` with an open HIGH-severity tyre-condition exception awaiting
  approval — written via direct Prisma calls setting the target state, same convention `upsertMovement`
  already used, not via the repository's own state machine (repository files are `import "server-only"`
  tagged and threw immediately when imported into the plain `tsx` seed script — confirmed by inspecting
  `node_modules/server-only/index.js` before attempting it, not discovered by trial and error).

**Database changes:** 1 new migration, applied to both dev and test databases; seed re-run against dev DB
(idempotent — all seed functions were already upsert/find-or-create style).

**Design decisions:** D-008 (exception self-approval is a hard rule, not tenant-configurable, unlike
`Tenant.allowSelfApproveMovement`), D-009 (InspectionTemplate versioning is immutable-row, not in-place
edit — a GateEvent keeps pointing at the exact template version it was actually run against), D-010
(GateEvent↔MovementAuthorisation linkage: one open event per movement enforced at the repository call site,
not a DB constraint; minimal best-effort movement-lifecycle wiring on clear/complete, explicitly not the
real Phase 5 reconciliation design). Full detail in DECISIONS.md.

**Tests run:**
- `npx tsc --noEmit` — clean throughout (ran after the schema change, after the repository layer, after
  the routes, and after the UI).
- `npm run lint` — clean, no new violations.
- `npm run build` — clean, 76 routes (was 60 after Phase 2).
- `npm test` — **255/255 passing** across 22 files (was 96/15). New files this session:
  `gate-event-state-machine.test.ts` (134 cases — an independently-declared expectation table swept
  against every one of the 11×11 state pairs, plus explicit happy-path/denial/escalation/cancellation
  cases, so the sweep isn't a tautology against the implementation's own table),
  `gate-event-repository.test.ts` (19 cases — eligibility re-check at gate time for both driver and
  vehicle, idempotent duplicate-start, identity verification VERIFIED/NOT_VERIFIED paths, automatic
  exception raising on a FAIL inspection outcome, the full self-approval-rule suite — same-user rejected,
  un-escalated rejected, different-user-after-escalation succeeds, already-resolved rejected — clearance
  with the vehicle-lockout defense-in-depth re-check, invalid-transition rejection, cancellation),
  `gate-event-tenant-isolation.test.ts` (2 cases), `inspection-template-repository.test.ts` (4 cases —
  versioning deactivates the previous version, old GateEvents keep their original version's items intact,
  category-specific-over-generic template selection, no-template-configured returns null cleanly). One
  test-authoring bug found and fixed before these numbers: the two "gate event start re-checks eligibility"
  tests originally tried to suspend a driver / lock a vehicle *before* calling `createMovement` — but
  `createMovement` itself already rejects that (Phase 2 behaviour), so the tests never reached
  `startGateEvent` at all. Fixed by creating+approving the movement first, then suspending/locking
  afterward — which is also the more realistic and more valuable scenario (eligibility changing between
  movement approval and physical gate arrival), not just a test-mechanics fix.
- Manual end-to-end verification via `npm run dev` + curl, logged in simultaneously as 5 different seeded
  roles (Fleet Manager, Approving Manager, Gate Security Officer, Security Manager, Company Administrator):
  created → submitted → approved a fresh movement; confirmed Fleet Manager is 403'd attempting to start a
  gate event (no `gateEvent:CREATE`); Gate Security Officer started one successfully (landed directly in
  `INSPECTION_STARTED`, correct default inspection template attached); walked it through
  identity-pending → identity-verify (mock provider returned `VERIFIED`) → begin vehicle checks; recorded a
  PASS and a FAIL (tyre tread depth, `1.1mm`) — the FAIL auto-raised a HIGH-severity exception and moved
  the event to `EXCEPTION_RAISED`; confirmed the officer gets 403 attempting to resolve their own exception
  (permission boundary — no `exception:APPROVE`) and confirmed Security Manager gets 409
  (`ExceptionNotEscalatedError`) attempting to resolve it *before* escalation; officer escalated to
  `SUPERVISOR_REVIEW`; Security Manager (different user) resolved it with `CLEARED_WITH_OBSERVATION`,
  correctly returning the event to `VEHICLE_CHECKS_IN_PROGRESS`; officer cleared the vehicle (confirmed the
  linked movement flipped `APPROVED → IN_PROGRESS` as a side effect) and completed the gate event; confirmed
  completing it a second time correctly 409s (`InvalidGateEventTransitionError`); confirmed a duplicate
  `POST /api/gate/gate-events` against the still-open seeded `SUPERVISOR_REVIEW` demo event returned the
  *same* gate event id, not a new row; fetched the security dashboard as Security Manager and confirmed
  real, consistent counts (3 gate events today, 2 cleared, 1 awaiting approval, 1 open high-severity
  exception, 2 failed inspection items today) with a full, correctly-ordered audit trail underneath.

**Remaining work:** Inspection-template/exception-type admin UI doesn't exist yet (API routes are built and
tested; only the default seeded template is currently usable without curl). No Playwright e2e spec added
for the new gate flow despite the UI now being stable enough to write one against — deferred, noted in
TODO.md. Phase 4 (evidence/media) is now the only thing standing between the current gate flow's
placeholder `evidenceRef` strings and real photo/video capture.

**Exact recommended next action:** Begin Phase 4 (evidence/media) — real file/photo/video upload behind
the `StorageProvider` adapter interface already designed in ARCHITECTURE.md, signed-URL access, checksum-
on-receipt, and idempotency-key retry protection, then wire actual capture into the Phase 3 guided
inspection UI (`/gate/events/[id]`) and the manual facial-verification fallback flow, both of which
currently only accept placeholder reference strings.

---

**Note appended 2026-07-22 by the orchestrating session (this Phase 3 work was done by a delegated
background agent that stalled — status "failed: no progress for 600s" — after apparently completing the
above but before it could report back or hand off cleanly).** Per this project's hard rule against
trusting unverified claims, everything above was independently re-verified rather than taken on faith:
`npx tsc --noEmit` clean, `npm run lint` clean, `npm test` **255/255 passing** (matching the agent's own
count), `npm run build` clean (route list matches what's documented above). A full live curl walkthrough
was then repeated end-to-end by this session directly — login as 5 roles, create→submit→approve a
movement, start a gate event, identity verification, PASS+FAIL inspection results, auto-raised exception,
self-approval blocked, escalation-required-before-resolution enforced, supervisor resolution, clearance
(confirmed the `APPROVED → IN_PROGRESS` movement side effect), completion, re-completion correctly 409s,
duplicate gate-event start returns the same row, security dashboard returns real live counts matching the
actions just taken. All of this confirms the agent's own account above was accurate, not overclaimed.

**One real bug was found during this independent re-verification that the agent's own testing had not
caught:** calling `identity/verify` out of sequence (skipping the `identity/pending` transition) 500'd
instead of 409ing — see KNOWN_BUGS.md BUG-003. Root cause: five precondition checks in
`gate-event-repository.ts` threw a plain `Error` instead of one of the typed error classes every calling
route's `catch` block already knew how to map to a 4xx (the pattern the rest of the file — and Phase
1/2's BUG-001 — already established). Fixed: three new typed error classes added, five throw sites
updated, four routes' catch blocks updated, four new regression tests added to
`tests/gate-event-repository.test.ts`. Full suite re-verified after the fix: **259/259 passing**, lint
clean, typecheck clean, build clean (still 76 routes — no new routes, just corrected error handling on
existing ones). This is now folded into the numbers throughout the rest of this document; TESTING.md and
KNOWN_BUGS.md have been updated to reflect it.

**Exact recommended next action (reconfirmed):** Begin Phase 4 (evidence/media), as above. Nothing about
the bug fix changes that recommendation.

---

## 2026-07-22 — Session 5 — Phase 4: evidence and media
**Objective:** Build the full Phase 4 evidence/media module per PRODUCT_REQUIREMENTS.md EVID-001..004 and
the "Media/video architecture" section already sketched (aspirationally) in ARCHITECTURE.md: a
`StorageProvider` adapter interface + working local-filesystem dev implementation, a `MediaAsset` model,
secure permission-checked upload with server-side file-type/size validation and server-computed checksums,
signed-URL-only reads (no public/permanent URL), idempotency-key retry protection, and wiring real evidence
into every existing capture point that was previously a dev-mode placeholder string — following the exact
established patterns (typed error classes, `tenantWhere()` scoping, `recordAudit()`, D-007 repository-layer
business rules, `queueMicrotask(load)` UI pattern) read from `gate-event-repository.ts`,
`vehicle-repository.ts`, and prior WORKLOG entries before writing any code.

**Schema (1 new migration, applied to dev + test DB):**
- `20260722090000_phase4_media_assets`: new `MediaAsset` table (polymorphic `ownerType` enum + plain
  `ownerId` string, not N nullable FK columns — see DECISIONS.md D-011); dropped
  `Driver.portraitUrl` → added `Driver.portraitMediaAssetId`; dropped
  `ComplianceDocument.attachmentUrl` → added `ComplianceDocument.attachmentMediaAssetId`; dropped
  `GateEventInspectionItem.evidenceRef` → added `GateEventInspectionItem.evidenceMediaAssetId`; dropped
  `ManualFacialVerificationFallback.evidenceRef` → added
  `ManualFacialVerificationFallback.evidenceMediaAssetId` (all four new columns nullable, `@unique`, FK to
  `MediaAsset.id` `ON DELETE SET NULL`). Generated via `npx prisma migrate diff --from-config-datasource
  --to-schema prisma/schema.prisma --script`, reviewed, applied with `prisma migrate deploy` — same
  workflow as every prior migration in this repo; `migrate dev` still doesn't work in this non-interactive
  shell.

**Permission catalogue extended** (`lib/auth/permissions.ts`): `mediaAsset` (VIEW/CREATE only — deliberately
no EDIT, since evidence is immutable once uploaded, same append-only spirit as AuditLog; no DELETE yet
either, reserved for a future POPIA-erasure mechanism). Seed role-permission matrix
(`prisma/seed.ts`) updated for all 8 tenant roles with a deliberately differentiated slice: Gate Security
Officer and Fleet Manager get VIEW+CREATE (they're the roles that actually capture evidence — gate
inspection photos and driver/vehicle documentation respectively); Company Administrator, Security Manager,
Approving Manager, Risk/Compliance Manager and Internal Auditor get VIEW only; Executive Viewer gets no
`mediaAsset` permission at all (dashboards/aggregate reporting only, per SECURITY_AND_POPIA.md's
"Internal" classification).

**Code landed (by area):**
- Storage: `lib/storage/provider.ts` (`StorageProvider` interface — `store`/`getSignedReadUrl`/`read`/
  `delete`), `lib/storage/local-filesystem-provider.ts` (dev implementation, writes to the gitignored
  `.data/media/` directory — the `/.data` gitignore entry and `STORAGE_LOCAL_PATH` env var were already
  reserved for this since the Phase 2 placeholder-comment era), `lib/storage/signed-url.ts` (pure, DB-free
  HMAC-SHA256 signing/verification — same "pure decision function, directly unit-tested" pattern as
  `evaluateSession()`/the state machines).
- Core evidence logic: `lib/repositories/media-asset-repository.ts` — `uploadMediaAsset` (owner-existence
  check → type/size validation → server-side SHA-256 checksum, never trusting a client-supplied one →
  idempotency-key lookup/replay → store → create, with 8 typed error classes for every precondition
  violation), `mintSignedUrlForMediaAsset` (permission-checked by the caller, tenant-re-verified here,
  audit-logs the grant), `serveRawMediaAsset` (signature+expiry verification, then a defense-in-depth
  tenant re-check before reading bytes), `getMediaAssetInTenant`.
- Routes: `src/app/api/media/upload/route.ts` (multipart/form-data, `mediaAsset:CREATE`),
  `src/app/api/media/[id]/route.ts` (mints a signed URL, `mediaAsset:VIEW`), `src/app/api/media/raw/route.ts`
  (verifies the signature + session tenant match, streams bytes — the only route that ever serves raw
  evidence).
- Wiring into existing capture points (DECISIONS.md D-012 — all four upgraded, not just the two explicitly
  named): `gate-event-repository.ts`'s `recordInspectionResult` now accepts `evidenceMediaAssetId` (validates
  it belongs to the same gate event before linking); `facial-verification-repository.ts` gained
  `attachEvidenceToManualFallback` + new route
  `.../manual-fallback/[fallbackId]/evidence`; `api/drivers/[id]/route.ts` PATCH now accepts
  `portraitMediaAssetId` (route-level tenant-ownership check, D-007 precedent); `compliance-document-repository.ts`
  gained `attachAttachmentToComplianceDocument` + new route `.../[id]/attachment`. All four update-only
  (evidence uploaded after the owning record exists — see D-012 for the chicken-and-egg reasoning).
- UI: `/gate/events/[id]` gained a real file-input per inspection item — selecting a file uploads it via
  `POST /api/media/upload` (idempotency key derived from `gateEventId:itemId:fileName:fileSize`) before
  submitting the PASS/FAIL result, plus a "View evidence" link that mints and opens a signed URL for
  already-recorded evidence.
- `prisma/seed.ts` extended: `seedMediaAsset()` helper (writes a small fictional placeholder file straight
  to `.data/media/` + creates the matching `MediaAsset` row directly via Prisma — repository files are
  `server-only`-tagged and can't be imported into this plain tsx script, same constraint noted in the
  Phase 3 WORKLOG entry); two demo records — a driver portrait for Kagiso Ndlovu, and evidence for the
  seeded SUPERVISOR_REVIEW gate event's failed tyre-tread inspection item (both idempotent-by-lookup so
  re-running seed against an already-seeded DB backfills them without duplicating).

**Database changes:** 1 new migration, applied to both dev and test databases; seed re-run against dev DB
(idempotent).

**Design decisions:** D-011 (MediaAsset's polymorphic ownerType+ownerId, not N nullable FK columns — closer
to AuditLog's shape than ComplianceDocument's), D-012 (all four placeholder fields fully upgraded, not just
the two explicitly named; three of the four are update-only due to a chicken-and-egg ordering constraint),
D-013 (file type/size limits — 25MB image/200MB video — and signed-URL expiry — 5 minutes — chosen and
documented since no prior convention existed), D-014 (audit-on-read logged at signed-URL mint time, not
every raw-byte fetch). Full detail in DECISIONS.md.

**Tests run:**
- `npx tsc --noEmit` — clean throughout (ran after the schema change, after the repository layer, after the
  routes, and after the UI/seed changes).
- `npm run lint` — clean, no new violations.
- `npm run build` — clean (one benign Turbopack NFT tracing warning about `local-filesystem-provider.ts`'s
  filesystem calls, silenced with a `turbopackIgnore` comment on the one `path.resolve(process.cwd(), ...)`
  call it was pointing at).
- `npm test` — **286/286 passing** across 25 files (was 259/22). New files this session:
  `tests/signed-url.test.ts` (7 pure unit cases — valid, expired-vs-exact-boundary, tampered resourceKey,
  tampered expiresAt, wrong secret, malformed signature), `tests/media-asset-repository.test.ts` (15 cases —
  successful upload + server-computed checksum, invalid type/empty/oversized rejection, foreign-owner
  rejection, client-checksum-mismatch rejection, the full upload-retry-without-duplication suite, the full
  signed-URL mint/serve/expiry/tamper suite, tenant-scoped `getMediaAssetInTenant`),
  `tests/media-tenant-isolation.test.ts` (5 cases — invisible via `getMediaAssetInTenant`, cannot mint a
  signed URL for another tenant's asset, cannot read via a genuinely-minted signature once the requesting
  session's tenant differs, cannot upload evidence against a foreign gate event id by guessing it,
  `recordInspectionResult` rejects evidence belonging to a different gate event/tenant). No existing test
  referenced any of the four removed placeholder fields (confirmed via search before removing them), so no
  regression-fix was needed in the pre-existing suite.
- Manual end-to-end verification via `npm run dev` + curl, full chain: logged in as Fleet Manager, Approving
  Manager, Gate Security Officer and Platform Administrator; created → submitted → approved a fresh
  movement; officer started a gate event, verified identity (mock provider), began vehicle checks; confirmed
  Approving Manager (no `mediaAsset:CREATE`) is 403'd attempting to upload evidence; officer uploaded a piece
  of evidence (201) and recorded the inspection result with it linked (200); minted a signed URL (200) and
  fetched it, receiving the *exact original bytes* with the correct `Content-Type: image/jpeg` header
  (byte-for-byte `diff` against the source file); confirmed a tampered signature 403s, a request missing all
  signed-URL query parameters 400s, and a direct filesystem-style path to the storage location (3 path
  shapes tried) 404s — there is no static route serving `.data/`; confirmed Platform Administrator (a
  different tenant, holding no `mediaAsset` permission at all) is 403'd attempting to mint a signed URL for
  the demo tenant's evidence; confirmed re-uploading the identical file with the same idempotency key returns
  the *same* MediaAsset id (201, not an error) and that exactly one row exists for that key via a direct
  `psql` count query; deliberately exercised three precondition-violation paths with bad/out-of-sequence
  input — a disallowed content type (`text/plain`) → 400, a foreign/guessed `ownerId` → 404, and an
  idempotency-key reused with genuinely different content → 409 — confirming none of them fell through to a
  generic 500 (the exact bug class BUG-001/002/003 already hit three times in this codebase).

**Bugs found this session:** none. Every typed-error/status-code mapping was built following the
already-established pattern from the start (not discovered via a broken first attempt), and the live curl
pass above deliberately targeted the same bug class that caught BUG-001/002/003 without finding a new
instance of it. KNOWN_BUGS.md was not updated with a new entry.

**Remaining work:** No dedicated admin-page UI for uploading a driver portrait or a compliance-document
attachment (both are fully wired and curl-verified at the API layer — only the gate check-in inspection
evidence upload got a UI affordance, matching the brief's explicit scope, see DECISIONS.md D-012). No
MediaAsset delete/retention-purge path exists yet (`StorageProvider.delete()` is implemented but unwired).
Audit-on-read was implemented for MediaAsset specifically, not yet extended to other Restricted-classified
reads (e.g. viewing a Driver's licence detail) — SECURITY_AND_POPIA.md's general target, tracked in TODO.md.
No object-storage production vendor selected (stays blocked, same status as facial-verification/telematics —
INTEGRATIONS.md). Full detail in TODO.md.

**Exact recommended next action:** Begin Phase 5 (Reconciliation) — RECON-001 (departure-vs-return
comparison using the correct paired departure event, not most-recent-by-vehicle) and RECON-002
(Discrepancy record + resolution workflow, reviewed not auto-accusatory). GateEvent's current
movement-lifecycle wiring (DECISIONS.md D-010) is an explicitly-documented placeholder that Phase 5 is meant
to replace with the real design; the Phase 4 evidence now available (photos/video per inspection item) is
available to attach to any discrepancy found.

---

## 2026-07-23 — Session 6 — Recovery checkpoint: Phase 4 independent verification completed, first Git commit
**Objective:** The prior session's independent re-verification of Phase 4 was interrupted mid-way by a tool
error on the exact `psql` command that queries `MediaAsset` checksums (used the wrong column name,
`checksum` instead of `checksumSha256`). Complete that verification, then create the repository's first
local Git checkpoint (198 tracked files, zero commits existed before this session), before continuing into
an expanded set of product requirements the user supplied covering role realignment, departure/return
reconciliation, dispatch workflow enhancements, telematics, and a platform support-access view.

**Verification completed:**
- Corrected query confirmed: `prisma/schema.prisma` names the field `checksumSha256` (not `checksum`).
  `SELECT id, "ownerType", "contentType", "fileSizeBytes", "checksumSha256", "storageKey" FROM media_assets;`
  returned the expected 3 seeded rows (1 `DRIVER_PORTRAIT`, 2 `GATE_EVENT_INSPECTION_ITEM`).
- Computed `sha256sum` directly against the 3 corresponding files under `.data/media/<tenantId>/...` and
  confirmed byte-for-byte match against each row's `checksumSha256` column — the stored checksum is
  genuinely the hash of the stored file, not a placeholder.
- `npx tsc --noEmit`, `npm run lint`, `npm test` (286/286 passing, 22 files), `npm run build` (39 routes) —
  all re-confirmed clean in this session (in addition to having already passed earlier in the same
  conversation before the interruption).
- Did **not** upgrade Prisma despite the CLI's own "7.8.0 -> 7.9.0 update available" notice, per explicit
  instruction not to upgrade dependencies opportunistically.
- Confirmed no production credentials or real customer data present: `.gitignore` already excludes
  `.env*` and `.data` (local media storage); a grep across `src/`, `prisma/`, `scripts/` for common
  real-secret patterns (AWS keys, OpenAI-style keys, PEM private key headers, Slack tokens) found nothing;
  all seed accounts use `@example.test` addresses and a single documented fictional dev password
  (`GateFleet!Dev1`, `prisma/seed.ts`), consistent with every prior session's data-handling.

**Git checkpoint:** First commit created — `c5e5d33`, "chore: checkpoint completed foundation through phase
4 media", 198 files, 27,525 insertions. Confirmed via `git status --short` after staging that no `.env*` or
`.data` path was included. No remote is configured (`git remote -v` empty) — retained as local-only per
instruction; a remote backup is still required before this work exists anywhere but this machine.

**Scope change — new authoritative product requirements received this session (not yet implemented):** the
user supplied a substantially expanded requirements set: six primary customer roles (Company Administrator,
Dispatch and Logistics Officer, Gate Security Officer, Security Supervisor/Approving Manager, Fleet and GPS
Manager, Accountant/Finance and Compliance Officer) to map the existing 8 seeded roles onto; a
`SupportAccessSession`-style controlled/audited platform support-access design (visible banner, mandatory
reason, time-limited, read-only by default); a provider-neutral `TelematicsProvider` interface (Netstar/
Cartrack/Tracker/MiX-agnostic, mock + manual-confirmation fallback only for now); `VehicleUsePolicy` for
sales-rep vehicle allowances with geofence/after-hours/mileage exception generation; and dispatch-workflow
enhancements to `MovementAuthorisation` (sender/recipient, secure `MediaAsset`-backed delivery-note
upload). Full detail preserved in the user's own message this session — not yet transcribed into
PRODUCT_REQUIREMENTS.md; that transcription is the first task of Phase 5A.

**Revised build order going forward (Phase 5A → 5B → 5C → 6 → 7), per this session's instruction:**
5A requirement/role alignment, 5B departure/return reconciliation (RECON-001/002 — this replaces the prior
"exact recommended next action" from the previous session, same underlying work, now with explicit
discrepancy-comparison and dashboard requirements), 5C dispatch document/movement enhancements, Phase 6
telematics foundation + basic geofencing, Phase 7 platform support view. Subscription billing and full
investigation-case management are explicitly out of scope for this run.

**Remaining work:** All of Phase 5A/5B/5C/6/7 as scoped above. Small-checkpoint discipline (doc update →
implement → test → verify → commit, per phase) applies from here on — this session's commit is the
baseline every subsequent phase's commit will diff against.

**Exact recommended next action:** Begin Phase 5A — update PRODUCT_REQUIREMENTS.md/ARCHITECTURE.md/
DATA_MODEL.md/DECISIONS.md with the new role/support-access/telematics/vehicle-use-policy requirements,
then map the 8 existing seeded roles onto the 6 primary customer roles (preserving segregation of duties
and the existing Internal Auditor/Executive Viewer profiles), update `prisma/seed.ts`, and add tests
proving prohibited cross-role actions remain blocked after the remap.

---

## 2026-07-23 — Session 7 — Phase 5A: role and requirement alignment
**Objective:** Map the existing 8 seeded roles onto the user's more detailed role specification (six
primary customer roles + three additional non-daily profiles + two platform-side roles), preserving
segregation of duties, then transcribe the full expanded requirement set (telematics, vehicle-use
policies, dispatch enhancements, platform support-access) into the project's memory docs.

**Role remap (DECISIONS.md D-015):** Company Administrator and Gate Security Officer unchanged. "Security
Manager" + "Approving Manager" merged into "Security Supervisor / Approving Manager" (gate CONFIGURE
moved to Company Administrator, who already had it). "Fleet Manager" split into "Dispatch and Logistics
Officer" (gets `movement:CREATE/EDIT`) and "Fleet and GPS Manager" (keeps driver/vehicle master-data
rights, drops to `movement:VIEW` — a real behaviour change, not just a rename). "Risk/Compliance Manager"
→ "Accountant / Finance and Compliance Officer" (same grants, renamed). "Internal Auditor" → "Internal
Investigator / Auditor", "Executive Viewer" → "Executive Read-Only Viewer" (both unchanged permissions).
New "External Reviewer" role added — same evidence-review access as the internal profile, but no
`user:VIEW` and no `auditLog:EXPORT`.

**Files changed:**
- `prisma/seed.ts` — `TENANT_ROLE_DEFINITIONS` fully rewritten (9 roles, updated descriptions/comments),
  `fictionalNameFor()` name map updated, all `usersByRole.get("...")` demo-data lookups updated (movement
  requester/approver, driver-portrait capturer, gate-operations exception-resolver guard) — required
  introducing a separate `dispatchOfficer` variable distinct from `fleetManager` since those two concepts
  used to be one overloaded role.
- `src/lib/auth/permissions.ts` — updated two stale comments referencing "Security Manager".
- `tests/role-segregation.test.ts` (new) — 8 cases proving the specific prohibited actions named in the
  new role spec remain blocked after the remap (Dispatch and Logistics Officer cannot approve movements,
  Fleet and GPS Manager cannot create movements — the actual behaviour-change regression, Gate Security
  Officer cannot resolve exceptions/fallbacks, Security Supervisor cannot create movements/exceptions,
  Accountant/Finance cannot edit inspections/media, External Reviewer is more restricted than Internal
  Investigator/Auditor, Executive Read-Only Viewer has zero media access, Company Administrator never
  gets `mediaAsset:CREATE`).
- Docs: `PRODUCT_REQUIREMENTS.md` (new "Roles — nine-role structure" section with an old→new mapping
  table; new RECON-003, DISPATCH-001..005, GPS-001..006/GPS-BLOCKED, POLICY-001/002, SUPPORT-001..004
  requirement tables, all `todo`, none implemented this session), `DECISIONS.md` (D-015 role remap
  rationale, D-016 platform-side-roles/SupportAccessSession architecture note), `MVP_SCOPE.md` (scope
  expansion note, October 2026 pilot target), `SECURITY_AND_POPIA.md` (SupportAccessSession design
  pointer, GPS/vehicle-use-policy treatment section, employee-tracking legal-review flag, role names in
  "Video and image treatment" updated), `INTEGRATIONS.md` (TelematicsProvider section moved from "Phase
  3" — stale, that phase already happened without it — to Phase 6, expanded interface sketch, added
  VehicleUsePolicy note), `ARCHITECTURE.md` + `PROJECT.md` (stale "Security Manager"/8-role references
  corrected to the current 9-role structure), `TESTING.md` (Phase 5A coverage section), `TODO.md` (Phase
  5A moved to Completed recently, revised build order note pointing at 5B→5C→6→7).

**A deliberate operational decision this session:** the local dev Postgres database
(`gate_fleet_governance`) was dropped and recreated (`docker exec gate-fleet-governance-postgres psql ...
DROP DATABASE` / `CREATE DATABASE`, then `prisma migrate deploy` + `npm run seed`) rather than left with
the old-named Role rows and their now-stale Users after the rename — `prisma/seed.ts`'s upsert-by-name
pattern has no cleanup step for roles that no longer appear in `TENANT_ROLE_DEFINITIONS`, and renaming 6
of 8 roles would otherwise have left 6 orphaned roles + their orphaned users (one of which,
"Gate Security Officer", had already accumulated a second stray user from earlier live-testing sessions).
This is 100% fictional local dev data, explicitly authorised under "creating local test data" — no
customer or production data exists anywhere in this project.

**Tests run:**
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean.
- `npm test` — **294/294 passing** (23 files; 286 baseline + 8 new `role-segregation.test.ts` cases).
- `npm run build` — clean.
- Manual curl verification: fresh dev DB reseeded (confirmed via `psql` — exactly 9 roles under the demo
  tenant, one user each, no orphans); Dispatch and Logistics Officer logs in (200) and is 403'd attempting
  to approve a movement; Fleet and GPS Manager logs in (200) and is 403'd attempting to create a movement
  (the actual behaviour-change regression check, not just a permission-table read).

**Bugs found this session:** none.

**Remaining work:** All of Phase 5B/5C/6/7 as scoped in `PRODUCT_REQUIREMENTS.md` and `TODO.md`. No new
schema landed this session (pure role/permission remap + docs) — Phase 5B is the next schema change.

**Exact recommended next action:** Begin Phase 5B (Reconciliation) — RECON-001 (departure-vs-return
GateEvent pairing), RECON-002 (Discrepancy model + resolution workflow), RECON-003 (reconciliation
dashboard). Small-checkpoint discipline continues: docs → repository layer → routes/validation → UI →
tests → deliberate invalid-order/wrong-role/cross-tenant/duplicate-submission tests → tsc/lint/test/build
→ docs update → Git commit, before moving to 5C.

# ARCHITECTURE.md

## Stack decision (Decision D-001, see DECISIONS.md)
- **App framework:** Next.js (App Router), TypeScript strict mode, React, Tailwind CSS. Single
  deployable app serving both UI and API (route handlers / server actions). Actual installed version is
  whatever `npm install` resolved at scaffold time (currently Next.js 16 / React 19) — npm always pulls
  latest on a fresh install, so don't assume Next 14/15-era API shapes; check `node_modules/next/dist/docs`
  for the bundled version's docs before relying on training-data assumptions (params/cookies/searchParams
  are async as of this version — see WORKLOG.md 2026-07-19).
- **Database:** PostgreSQL, accessed via **Prisma ORM**. Chosen over the raw Supabase JS client so the
  data layer stays provider-agnostic (works against local Docker Postgres, Supabase-hosted Postgres, or
  any managed Postgres without code changes) — satisfies the "must not tightly couple to Supabase" rule
  in the build brief. Local dev DB runs in Docker (see `docker-compose.yml`), bound to a non-default host
  port to avoid colliding with other projects' Postgres containers already running on this machine.
- **Validation:** Zod, enforced server-side on every mutating route handler / server action. Client-side
  validation is a UX convenience only, never the security boundary.
- **Auth:** custom session-based auth (bcrypt password hashing + server-side session records, signed
  httpOnly cookie holding an opaque session ID — not a JWT, so sessions are revocable server-side).
  MFA-ready: `User` has `mfaEnabled`/`mfaSecret` columns wired but no TOTP flow in V1. See Decision D-002.
- **Testing:** Vitest (unit/integration), Playwright (e2e). Tenant-isolation and permission tests are
  mandatory gates, not optional coverage (`TESTING.md`).

## Tenant-isolation strategy
Defense in depth, two layers:
1. **Application layer (primary, enforced now):** every tenant-owned Prisma model carries a required
   `tenantId`. All repository/service functions accept the authenticated session's `tenantId` and inject
   it into every `where` clause; there is no code path that queries a tenant-owned table without a
   tenant filter. A lint-level convention (see `lib/db/tenant-scope.ts`) wraps Prisma delegates so raw
   `prisma.<model>.findMany()` without a tenant filter is not the blessed access path.
2. **Database layer (defense in depth, added once we're on Postgres RLS-capable hosting):** Postgres Row
   Level Security policies keyed on a session-local `app.tenant_id` GUC. Deferred to Phase 7 hardening
   because RLS needs a connection-pooling strategy (`SET LOCAL` per request) that's easier to get right
   once the app-layer contract is stable. Tracked as TODO item SEC-2.

Cross-tenant data leakage is a release-blocking defect per the build brief; tenant-isolation tests are
mandatory before any module is marked done (`TESTING.md`).

## Authentication and authorisation
- Session record in DB (`Session` table): id, userId, tenantId snapshot, createdAt, expiresAt, ip,
  userAgent, revokedAt. Cookie holds only the session id.
- Authorisation is **permission-based, not role-name-based**. `Role` has many `Permission`s
  (`resource` + `action`, e.g. `driver:approve`); a `User` has one primary `Role` plus optional
  `UserPermissionOverride` grants/revokes for edge cases. Every server action/route handler calls
  `requirePermission(session, resource, action)` before touching data — see `lib/auth/authorize.ts`.
- Approval delegation (`ApprovalDelegation`: delegator, delegate, permission scope, startAt, expiresAt) is
  checked at authorisation time; expired delegations are excluded by a time-bound query, not a cron job,
  so there's no window where an expired delegation still works.

## Audit architecture
Append-only `AuditLog` table. No application code path exposes UPDATE/DELETE on it — the Prisma client
used by the audit-write helper is the only writer, and it only exposes `create`. Every sensitive
mutation goes through a single `recordAudit()` helper (tenant, userId, action, entityType, entityId,
before/after JSON, reason, correlationId) so the call site can't forget a field. Stronger tamper-evidence
(hash chaining / external WORM sink) is deferred — documented in `SECURITY_AND_POPIA.md`.

## Media/video architecture (Phase 4 — implemented, see PRODUCT_REQUIREMENTS.md EVID-001..004)
Object storage sits behind a `StorageProvider` adapter interface (`lib/storage/provider.ts`: `store()`,
`getSignedReadUrl()`, `read()`, `delete()`), the same "interface + working dev implementation, production
provider stays swappable and unselected" pattern already used for `FacialVerificationProvider`. The dev
implementation (`lib/storage/local-filesystem-provider.ts`) writes to the gitignored `.data/media/`
directory (`STORAGE_LOCAL_PATH`); no Supabase/S3 adapter is built — that stays unselected per
INTEGRATIONS.md, exactly like the facial-verification and telematics vendors, and swapping one in later
means implementing this interface, not changing any call site.

**No public bucket access, ever.** There is no static/public route that serves `.data/` — it isn't under
Next's `/public`, and no route handler exposes a raw filesystem path. The only way to read a MediaAsset's
bytes is: (1) `GET /api/media/[id]` — permission-checked (`mediaAsset:VIEW`) and tenant-scoped
(`mintSignedUrlForMediaAsset()`, `lib/repositories/media-asset-repository.ts`) — mints a short-lived
(`SIGNED_URL_DEFAULT_EXPIRY_SECONDS` = 300s) signed URL and audit-logs the grant; then (2)
`GET /api/media/raw?key=...&expires=...&sig=...` — verifies the HMAC-SHA256 signature and expiry
(`lib/storage/signed-url.ts`, pure/DB-free, directly unit-tested), re-checks the requesting session's
tenant against the asset's tenant (defense in depth beyond the signature alone), and only then streams the
bytes. Both an expired signature and a signature whose resource key was tampered with are rejected with
distinct, typed reasons (`expired` → 410, `invalid_signature` → 403) — see
`InvalidOrExpiredSignedUrlError`.

**MediaAsset** (`prisma/schema.prisma`) is one reusable, polymorphic model for every evidence-capture point
in the system (DECISIONS.md D-011) — an `ownerType` discriminator (`GATE_EVENT`,
`GATE_EVENT_INSPECTION_ITEM`, `MANUAL_FACIAL_VERIFICATION_FALLBACK`, `DRIVER_PORTRAIT`,
`COMPLIANCE_DOCUMENT`) + plain `ownerId` string (same shape as `AuditLog`'s `entityType`/`entityId`, not N
nullable FK columns), capturing user/time, file type/size, an opaque tenant-namespaced `storageKey`, and a
SHA-256 `checksumSha256` computed server-side on receipt — never trusts a client-supplied value (an
optional client-supplied checksum, if present, is only used as an extra integrity cross-check). A
client-generated `idempotencyKey`, unique per `(tenantId, idempotencyKey)`, makes retrying an upload over
flaky gate connectivity safe: `uploadMediaAsset()` returns the existing row unchanged on a genuine retry
(same key, same content), and rejects with a typed `IdempotencyKeyConflictError` (409) if the same key is
reused with different content — satisfying EVID-003.

**Upload** (`POST /api/media/upload`, multipart/form-data, `mediaAsset:CREATE` permission) validates file
type (images: jpeg/png/webp/heic; video: mp4/quicktime/webm) and size (25MB image / 200MB video — see
DECISIONS.md D-013 for why these numbers) server-side before ever calling the storage provider, and
confirms the `ownerId` genuinely belongs to the caller's tenant (`assertOwnerExistsInTenant()`) before
attaching evidence to it — every violation is a typed error (`InvalidFileTypeError`, `EmptyFileError`,
`FileTooLargeError`, `MediaOwnerNotFoundError`, `ChecksumMismatchError`, `IdempotencyKeyConflictError`)
mapped to the correct 4xx status, following the same discipline BUG-001/002/003 established (see
KNOWN_BUGS.md) — nothing here falls through to a generic 500.

**Wired into existing capture points** (DECISIONS.md D-012): `GateEventInspectionItem.evidenceMediaAssetId`
and `ManualFacialVerificationFallback.evidenceMediaAssetId` replaced their old dev-mode placeholder string
fields; `Driver.portraitMediaAssetId` and `ComplianceDocument.attachmentMediaAssetId` were upgraded the
same way (both update-only — evidence is uploaded after the owning record exists, then linked via a
dedicated attach endpoint/function). The `/gate/events/[id]` guided-inspection UI has a real file-input
upload affordance per inspection item.

**Audit on read** (SECURITY_AND_POPIA.md): `mintSignedUrlForMediaAsset()` writes one `AuditLog` row per
signed-URL mint (`mediaAsset.readAccessGranted`) — the point where read access is actually authorised, not
every subsequent raw-byte fetch (DECISIONS.md D-014).

## Movement authorisation architecture (Phase 2)
`MovementAuthorisation` has its own state machine — a pure, DB-free transition table in
`lib/movements/state-machine.ts` (`isValidMovementTransition`, `assertValidMovementTransition`), the same
"pure decision function, DB-free, directly unit-tested" pattern already used for `evaluateSession()`.
DRAFT → SUBMITTED → APPROVED → IN_PROGRESS → COMPLETED is the happy path; REJECTED/CANCELLED/EXPIRED are
terminal. Every write goes through `movement-repository.ts`'s `transition()` helper, which checks the
table before writing and audit-logs before/after status. Self-approval (`approveMovement`) is blocked
unless `Tenant.allowSelfApproveMovement` is explicitly true (default false) — checked against
`requesterUserId === approverUserId`, not against role, so it holds even if a future role grants both
CREATE and APPROVE to the same person.

The gate-facing lookup (`searchMovementsForGate`, `/api/gate/movements/search`) is read-only by
construction: that route file only exports `GET`, there is no PATCH/PUT/DELETE handler anywhere under
`/api/gate/`, and DRAFT movements are excluded from results (a draft isn't a real request yet). A Gate
Security Officer's seeded role has `movement:VIEW` only — no EDIT/CREATE/APPROVE/REJECT/DELETE — so even
if a future refactor accidentally added a mutating gate endpoint, that role couldn't call it without an
explicit new permission grant.

## Gate operations architecture (Phase 3)
`GateEvent` models a vehicle's actual presence/processing at a gate — distinct from
`MovementAuthorisation`'s own pre-gate approval state machine (done in Phase 2). Its own pure, DB-free
transition table lives in `lib/gate-events/state-machine.ts` (`isValidGateEventTransition`,
`assertValidGateEventTransition`), same pattern as `lib/movements/state-machine.ts`. States: `EXPECTED →
INSPECTION_STARTED → IDENTITY_PENDING → IDENTITY_VERIFIED → VEHICLE_CHECKS_IN_PROGRESS → (EXCEPTION_RAISED
→ SUPERVISOR_REVIEW)* → CLEARED | DENIED → COMPLETED`, with `CANCELLED` reachable from every non-terminal,
non-decided state. `EXCEPTION_RAISED` can resolve directly back to `VEHICLE_CHECKS_IN_PROGRESS` (a
non-serious exception the officer clears themselves) or escalate to `SUPERVISOR_REVIEW` (a serious one);
`SUPERVISOR_REVIEW` resolves back to checks or terminates the event at `DENIED`. Every write goes through
`gate-event-repository.ts`'s `transitionGateEvent()` helper, which checks the table before writing and
audit-logs before/after status, identically to `movement-repository.ts`'s `transition()`.

`startGateEvent()` combines "start" and "begin inspection" into one call (`EXPECTED` →
`INSPECTION_STARTED`) so the officer's single tap starts the record — see D-010. It is idempotent: a
second call for the same `movementAuthorisationId` while one GateEvent is still open (non-terminal) returns
the existing row rather than creating a duplicate. It also re-checks driver/vehicle availability at gate
time (not just trusting the earlier movement approval) — defense in depth, since a driver/vehicle can be
suspended/locked *after* a movement was approved but before the vehicle physically reaches the gate; the
same re-check happens again in `clearGateEvent()` immediately before a CLEARED decision is recorded.

**Inspection engine (GATE-006).** `InspectionTemplate` (tenant-scoped, versioned via immutable new rows —
see D-009) holds an ordered `InspectionItem[]` grouped by `InspectionSection` (driver/authorisation,
vehicle identity, exterior condition, lights, tyres/wheels, operational info, load verification).
`getActiveTemplateForCategory()` picks the tenant's active category-specific template, falling back to a
generic (`vehicleCategory: null`) one — `startGateEvent()` calls this once, at creation, and stores the
chosen `inspectionTemplateId` on the `GateEvent` permanently. `GateEventInspectionItem` records the actual
answer (`PASS`/`FAIL`/`NOT_APPLICABLE`/`UNABLE_TO_VERIFY`, plus a reading value/unit for `READING`-type
items) against one item for one gate event; `evidenceRef` is a dev-mode placeholder URL string only, same
as `Driver.portraitUrl`/`ComplianceDocument.attachmentUrl` — no real upload until Phase 4.

**Exceptions and approvals (GATE item 3, GATE-005 for GateEvent).** A `FAIL` outcome on an inspection item
whose `InspectionItem.defaultExceptionSeverity`/`requiresSupervisorApprovalOnFail` are set automatically
raises an `Exception` (`raiseException()`) tied to that result, and moves the GateEvent to
`EXCEPTION_RAISED`; an officer can also raise one ad hoc. `ExceptionType` is the tenant-configurable
category catalogue (code/label/default severity/default outcome/`requiresSupervisorApproval`) — same shape
and purpose as `DocumentExpiryRule`. `resolveException()` enforces a **hard, non-tenant-configurable**
self-approval rule whenever `requiresSupervisorApproval` is true: the officer who raised it can never be
the one who resolves it, regardless of role/permission (see D-008 for why this deliberately doesn't reuse
`Tenant.allowSelfApproveMovement`'s opt-out pattern) — and it must first be explicitly escalated to
`SUPERVISOR_REVIEW` (`escalateExceptionToSupervisor()`) before it can be resolved at all. Resolution outcome
actions split into two groups: `WARNING`/`CLEARED_WITH_OBSERVATION`/`MANUAL_REVIEW`/`SUPERVISOR_APPROVAL`
return the GateEvent to `VEHICLE_CHECKS_IN_PROGRESS`; `WORKSHOP_LOCKOUT`/`SECURITY_HOLD`/`DENIED` terminate
it at `DENIED`. In the seeded permission matrix, `exception:CREATE` (raise) and `exception:APPROVE`
(resolve) are deliberately granted to different roles (Gate Security Officer vs Security Supervisor /
Approving Manager) so the
authorization boundary is meaningfully testable — the hard self-approval rule inside the repository
function is the actual, unconditional guarantee, independent of that role split (same "defense in depth,
not role-name-based" principle as D-007).

**Driver verification wiring (GATE item 5).** `verifyIdentityForGateEvent()` calls the existing
`FacialVerificationProvider` (mock in dev — no new mechanism built) against the driver on the linked
`MovementAuthorisation`; a `VERIFIED` result advances `IDENTITY_PENDING → IDENTITY_VERIFIED` automatically,
any other result records the attempt and leaves the officer to retry, request the existing
`ManualFacialVerificationFallback` flow, or raise an exception. Once a supervisor approves a manual
fallback request, `markIdentityVerifiedManually()` confirms it against the GateEvent.

**Security dashboard (GATE-002).** `security-dashboard-repository.ts`'s `getSecurityDashboardData()` is the
single place the dashboard's numbers are computed — real DB aggregate queries only (counts, `findMany`),
no static/mock values. It reuses `evaluateDocumentExpiry()` (Phase 2) for the expiring-documents panel,
closing the "no dedicated dashboard yet" gap flagged in TODO.md since MD-004.

## Reconciliation architecture (Phase 5B, see PRODUCT_REQUIREMENTS.md RECON-001..003)
`Reconciliation` pairs one movement's departure and return `GateEvent` and compares what each recorded.
"Departure" and "return" are assigned by chronological `completedAt` order, not a hardcoded
`ENTRY`/`EXIT` assumption — this works identically for a fleet vehicle leaving-then-returning (`EXIT`
then `ENTRY`) and a visiting vehicle entering-then-leaving (`ENTRY` then `EXIT`); the two legs are only
required to be in *opposite* directions, never the same one.

**Pairing (`reconciliation-repository.ts` `buildReconciliation()`).** Idempotent by construction, same
pattern as `startGateEvent()`: a repeat call for an already-paired movement (or an already-paired explicit
gate-event pair) returns the existing row unchanged. Validation order: same-event check (a malformed
request can't be masked by the idempotency lookup) → idempotency lookup → duplicate-pairing check (a
`GateEvent` can be the departure or return leg of at most one `Reconciliation`, ever — enforced by a DB
`@unique` constraint on each column, not just application code) → both legs `COMPLETED`/`CLEARED` → same
movement → same vehicle (defense in depth — always true given the first check, kept anyway) → opposite
directions → departure not completed after return. Auto-triggered best-effort from
`completeGateEvent()` (not fatal if the other leg doesn't exist yet — the common case, since this fires on
the departure leg too); also exposed as `POST /api/reconciliations` for a manual retry
(`reconciliation:CREATE`).

**Comparison (`lib/reconciliation/discrepancy-engine.ts`).** Pure, DB-free, unit-tested in isolation (same
family as `lib/gate-events/state-machine.ts` and `lib/documents/expiry-rules.ts`). Reads the departure and
return `GateEventInspectionItem` answers keyed by `inspectionItemId` and categorises purely off the
existing tenant-configurable `InspectionSection`/`unit` taxonomy — `OPERATIONAL_INFO`+`km` → odometer,
`OPERATIONAL_INFO`+`%` → fuel, `TYRES_WHEELS` → tyre, `EXTERIOR_CONDITION` → vehicle condition,
`LOAD_VERIFICATION` → cargo/seals/tools/equipment/passengers. A tenant's own custom inspection items are
compared automatically with no engine change ("where configured" in RECON-001) since nothing is keyed off
a specific item label. `MovementAuthorisation.expectedDistanceKm` (optional) is the only reconciliation-
specific input outside the inspection answers — set at dispatch time, compared against actual
`kmTravelled` for the "excess mileage" check; null skips that one check rather than treating it as zero.

**Discrepancies (RECON-002).** `ReconciliationDiscrepancy` never concludes fraud/theft/criminal conduct —
only a factual departure-vs-return delta plus a severity (`LOW`/`MEDIUM`/`HIGH`, reusing
`ExceptionSeverity`; the auto-engine never assigns `CRITICAL` itself). A `HIGH` discrepancy raises a real
`Exception` against the *return* `GateEvent` directly (not via `gate-event-repository.ts`'s
`raiseException()` — that would also attempt a `GateEvent` state transition, meaningless once both legs
are terminal/`COMPLETED`, and importing it would create a circular dependency between the two repository
modules) — RECON-002's "via the existing Phase 3 exception workflow rather than a parallel mechanism",
satisfied by writing to the same `Exception` table gate operations already use, not a second one. Human
review/explanation/resolution is one step (`resolveDiscrepancy()`): a mandatory `resolutionNotes`
explanation plus an optional `correctiveAction`, `reconciliation:APPROVE`-gated, separate from
`reconciliation:EDIT` (adding notes without the authority to close it out) the same way `exception:CREATE`
and `exception:APPROVE` are split. `Reconciliation.status` is derived, not independently settable:
`NO_DISCREPANCIES` at build time if none were found, `OPEN` while any discrepancy remains `OPEN`,
`RESOLVED` once every discrepancy on it reaches `RESOLVED`.

## Telematics architecture (Phase 6, see PRODUCT_REQUIREMENTS.md GPS-001..006/GPS-BLOCKED, POLICY-001/002)
`TelematicsProvider` (`lib/telematics/provider.ts`) is the adapter boundary a real GPS vendor plugs into —
same shape and purpose as `FacialVerificationProvider`/`StorageProvider`. Only `MockTelematicsProvider`
exists (deterministic, `force:<outcome>` markers in the provider vehicle id — `force:unavailable`,
`force:offline`, `force:ignition-off`, `force:at:<lat>,<lng>`); production connection is blocked
(GPS-BLOCKED, INTEGRATIONS.md).

**Sync (GPS-001/003, `telematics-repository.ts` `syncVehicleTelematics()`).** Pulls one snapshot from the
provider for a vehicle already carrying `gpsDeviceReference` (the tracker mapping itself was already
possible via Phase 2's generic `updateVehicle`), records a `TelematicsEvent`, and updates
`Vehicle.gpsStatus`/`gpsLastCommunicationAt`. A snapshot older than 30 minutes (`lastCommunicationAt`) is
never trusted as current — `gpsStatus` goes `INACTIVE` and geofence/policy compliance is not evaluated
against it (GPS-006 "stale data is flagged, not silently trusted" — an unreliable position must not
generate a false violation). A provider failure (`TelematicsProviderUnavailableError`) is caught, marks the
vehicle `INACTIVE`, and re-thrown as a typed error the calling route maps to 503, never a raw 500.

**Manual GPS confirmation (GPS-002, `ManualGpsConfirmation`).** A direct mirror of
`ManualFacialVerificationFallback`/`facial-verification-repository.ts` — office staff record a manual
confirmation of a vehicle's whereabouts by phone/radio when the (mock) provider is offline; a different
user resolves it (hard, unconditional self-approval block, same as facial verification's equivalent — see
D-008's reasoning, applied here without a tenant-configurable opt-out for the same "integrity isn't
optional" principle).

**Geofencing and policy compliance (GPS-004, POLICY-001/002,
`lib/telematics/geofence-engine.ts` + `evaluateVehiclePolicyCompliance()`).** `Geofence` is deliberately a
simple circle (center + radius), not a polygon/map-drawing tool — "basic geofence monitoring" is the
explicit GPS-004 scope. `VehicleUsePolicy` (POLICY-001's full field list: named driver, one-or-more
assigned vehicles via the `VehicleUsePolicyVehicle` join table, effective dates, permitted days/hours,
approved destination/geofence, km limits per trip/day/week/month, after-hours/weekend/private-use flags,
expected return time, a named approving manager, status, override reason) starts `DRAFT` and only the named
`approvingManagerUserId` can move it to `ACTIVE` (`approveVehicleUsePolicy()` — if no manager was named at
creation, the first `vehicleUsePolicy:APPROVE`-holder to approve becomes the manager of record).
Every non-stale `TelematicsEvent` for a vehicle with an `ACTIVE` policy assignment is compared against it
via the pure `evaluatePolicyCompliance()` — geofence deviation, day/hour restrictions, distance-limit
breaches — never concluding fraud/theft/criminal conduct (POLICY-002/GPS-005), only naming which configured
rule a reading fell outside of. Per-trip distance accumulation isn't wired up in this phase (no
trip-boundary tracking yet — see TODO.md); the per-trip km-limit check simply doesn't fire rather than
guessing at a distance, a documented gap rather than a silently wrong one.

**Reusing (not parallelling) the Exception model (GPS-005/POLICY-002, see DECISIONS.md D-020).**
`Exception.gateEventId` became nullable and a new `Exception.vehicleId` was added — a telematics/policy
exception is created directly against the vehicle, with no GateEvent involved (unlike every Phase 3/5B
exception, which always sets `gateEventId`). Written directly via `prisma.exception.create()` in
`telematics-repository.ts` rather than through `gate-event-repository.ts`'s `raiseException()`, for the
same reason as D-018's reconciliation exceptions: that function also attempts a meaningless GateEvent state
transition, and importing it would create a circular dependency risk given how tightly the two repository
modules would otherwise couple. Unlike reconciliation, telematics sync is *not* currently auto-triggered
from any GateEvent lifecycle hook — it's triggered by an explicit `POST /api/vehicles/[id]/telematics/sync`
call, matching how a real GPS vendor would push/poll independently of gate activity, not tied to a vehicle
physically being at a gate.

## Platform support-access architecture (Phase 7, see PRODUCT_REQUIREMENTS.md SUPPORT-001..004)
A new, separately-scoped, fully audited mechanism for platform staff to read a customer tenant's data —
deliberately **not** an extension of `platform-tenant-repository.ts` (that file's own comment already
anticipated this: "If a future support-access feature needs to read a customer tenant's business data, it
must be a new, separately-scoped, similarly audited mechanism — not an extension of this file", D-005).
Everything lives in `support-access-repository.ts` instead, with two distinct trust levels:

**Level 1 — the customer list (SUPPORT-001).** `getCustomerHealthSummaries()` is gated by the existing
`platformTenant:VIEW` alone — no support session needed — because it only ever returns *aggregate counts*
(sites, gates, vehicles, users, open HIGH/CRITICAL exceptions, GPS-active vehicle count, storage bytes,
last-activity timestamp, a derived onboarding status), never an individual business record. This is the
same "safe to browse before deciding whether to open a support session" tier as a real support-ops
dashboard.

**Level 2 — the support session and view (SUPPORT-002/003/004).** A `SupportAccessSession` is a
*permission window* layered on top of an already-authenticated platform session — not the same thing as
`Session` (that's the actor's own login, unaffected). Starting one (`startSupportAccessSession()`) requires
a mandatory `reason`, is time-limited (60 minutes, `SUPPORT_ACCESS_SESSION_TTL_MINUTES`), and is fully
audited. `getSupportViewForCustomer()` — the actual "controlled support view" — refuses to return anything
at all unless `getActiveSupportAccessSession(actorUserId, customerTenantId)` finds a matching, unexpired,
unended row; this check is scoped to *both* the specific actor *and* the specific customer tenant, so a
session opened against Tenant A grants zero access to Tenant B (SUPPORT-004 tenant isolation) and an
expired session is rejected on the very next request, the same "re-check live, don't trust a cached
decision" principle as `evaluateSession()`. The view itself is a bounded, read-only summary (site/gate
names, aggregate vehicle/driver counts, open exceptions, recent movements, support notes) — deliberately
excluding facial-verification enrolment detail, raw `MediaAsset` content, and investigation-case data (that
module doesn't exist yet regardless), satisfying "no default biometric/investigation-case access."

**Exit and elevation (SUPPORT-003).** `endSupportAccessSession()` is the "immediate exit action" — only
the actor who started a session may end it, and doing so revokes support-view access to that customer
immediately (verified in tests, not just assumed). `elevateSupportAccessSession()` is a second, deliberate,
separately-permissioned (`supportAccessSession:CONFIGURE`) action recording an elevation reason and
timestamp — but, per D-021, it currently only *records* elevated intent/audit trail; it does not itself
unlock a write path on any customer resource (movements, drivers, vehicles, ...). Building that out is
explicitly deferred until a real "platform support needs to make an authorised change" use case exists,
rather than speculatively wiring a cross-cutting elevated-write mechanism into every existing repository
function ahead of need.

**Platform-side roles.** Platform Administrator gets full `supportAccessSession` (VIEW/CREATE/CONFIGURE)
alongside its existing `platformTenant` grants; a new "Platform Support Analyst" role (D-016) gets
`platformTenant:VIEW` (to browse the customer list) plus `supportAccessSession:VIEW`/`CREATE` but
deliberately not `CONFIGURE` — elevation stays an Administrator-only action.

## Integration boundaries
`FacialVerificationProvider` (`lib/facial-verification/provider.ts`) has a deterministic mock
implementation (`mock-provider.ts`, driven by `force:<outcome>` markers in the capture reference — see its
docstring) and a separate `ManualFacialVerificationFallback` model/repository for the human-in-the-loop
path (request → supervisor approve/deny, self-approval blocked, every step audit-logged). `TelematicsProvider`
is not yet built (Phase 3). No facial-recognition or telematics vendor is selected yet (blocked pending
decision — see `INTEGRATIONS.md`). Provider selection must not require changing call sites.

## Deployment topology (target, not yet built — Phase 7)
Single Next.js app + managed Postgres + object storage, behind HTTPS, environment-driven config. Local
dev: Next.js dev server + Dockerised Postgres. Staging/production topology to be finalised in
`DEPLOYMENT.md` once a hosting decision is made (flagged as a major decision when we reach Phase 7).

## Technical constraints
- All timestamps stored UTC; tenant timezone is a display concern only.
- No secrets in the repo; `.env.example` documents required variables with placeholder values.
- Large media uploads must not block the main request thread — uploads go direct-to-storage via
  presigned URLs where the provider supports it, with server-side verification after upload completes.

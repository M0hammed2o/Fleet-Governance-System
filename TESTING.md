# TESTING.md

## Test strategy
Vitest for unit + integration tests (services, repositories, permission logic, state machine transitions
run against a real test-Postgres instance, not mocks — DB behaviour, especially tenant scoping, is exactly
what must be caught). Playwright for end-to-end workflow tests through the actual UI.

## Mandatory gates (from build brief section 12) — status
- [x] Tenant A cannot access Tenant B data — tests/tenant-isolation.test.ts (4 cases) +
      tests/tenant-isolation-admin.test.ts (4 cases) + tests/phase2-tenant-isolation.test.ts (4 cases,
      driver/vehicle/movement) + tests/gate-event-tenant-isolation.test.ts (2 cases, GateEvent), passing
      as of 2026-07-21
- [x] Gate officer cannot approve their own serious exception — now literal GateEvent/Exception coverage
      (Phase 3 closed this out for real): tests/gate-event-repository.test.ts ("rejects the same officer
      who raised a serious exception from resolving it themselves" — `SelfApprovalNotAllowedError`,
      unconditional/not tenant-configurable, see DECISIONS.md D-008); manually verified via curl (officer
      gets 403 attempting to resolve their own raised exception; a different role — Security Manager —
      resolves it successfully after escalation). The MovementAuthorisation-equivalent rule from Phase 2
      (tests/movement-repository.test.ts) remains in place for movement approval specifically.
- [x] Unauthorised roles cannot view facial or video evidence — MediaAsset now exists (Phase 4):
      `mediaAsset:VIEW` gates `mintSignedUrlForMediaAsset()`, tested at both layers —
      `tests/media-asset-repository.test.ts` ("mintSignedUrlForMediaAsset returns null for a MediaAsset
      belonging to a different tenant"), `tests/media-tenant-isolation.test.ts` (3 cases: invisible via
      `getMediaAssetInTenant`, cannot mint a signed URL, cannot read via a genuinely-minted signature once
      the requesting session's tenant differs); manually verified via curl — Approving Manager (no
      `mediaAsset:CREATE`) blocked 403 on upload, Platform Administrator (no `mediaAsset` permission at
      all, different tenant) blocked 403 attempting to mint a signed URL for the demo tenant's evidence.
      Executive Viewer is deliberately granted no `mediaAsset` permission at all in the seeded role matrix
      (prisma/seed.ts) — see SECURITY_AND_POPIA.md "Video and image treatment".
- [x] Expired approval delegation stops working — tests/authorize.test.ts, passing as of 2026-07-19
- [x] Invalid gate-event state transitions are rejected — now literal: tests/gate-event-state-machine.test.ts
      (134 cases — full 11-state × 11-state matrix against an independently-declared expectation table,
      plus documented happy/denial/escalation/cancellation flows) + tests/gate-event-repository.test.ts
      (transition enforcement via repository functions, e.g. rejects completing a gate event that hasn't
      been cleared/denied yet); manually verified via curl (409 `InvalidGateEventTransitionError` on
      completing an already-COMPLETED event). MovementAuthorisation's own state machine (Phase 2) remains
      separately tested.
- [x] Duplicate submissions do not create duplicate gate events — now literal: `startGateEvent()` is
      idempotent (`findOpenGateEventForMovement`, see DECISIONS.md D-010); tests/gate-event-repository.test.ts
      ("is idempotent: a duplicate start call returns the existing open gate event, not a second row");
      manually verified via curl (duplicate POST against MV-DEMO3, already open, returned the same
      SUPERVISOR_REVIEW gate event id, not a new one)
- [x] Media cannot be accessed using a public permanent URL — implemented Phase 4:
      `tests/media-asset-repository.test.ts` ("mints a signed URL that... returns the exact bytes",
      "rejects an expired signed URL, distinct from an invalid signature", "rejects a tampered signature",
      "rejects serving a valid signature+expiry when the requesting session's tenant does not match");
      manually verified via curl — a direct filesystem-style path to the storage location 404s (no static
      route serves `.data/`), `GET /api/media/raw` with no query params 400s, with a tampered signature
      403s, a genuinely-minted signed URL served the exact original bytes with the correct `Content-Type`.
- [x] Audit records cannot be edited through normal application functions — enforced at the DB level via
      Postgres triggers (`prevent_audit_log_modification`), see DATA_MODEL.md migration
      `20260720080000_invitations_and_audit_protection`; verified manually via psql (UPDATE raises), no
      automated test yet — worth adding an integration test that asserts the trigger fires
- [x] Vehicle lockout prevents normal clearance — now literal at the GateEvent level, not just movement
      creation: `clearGateEvent()` re-checks vehicle availability immediately before a CLEARED decision
      (defense in depth against a vehicle being locked *after* the gate event started) —
      tests/gate-event-repository.test.ts ("rejects clearing a vehicle that was locked after the gate
      event started"); movement *creation* enforcement from Phase 2 remains
      (tests/movement-repository.test.ts, manually verified via curl, 409 on locked vehicle)
- [ ] Return comparison uses the correct departure event — no reconciliation model yet (Phase 5)
- [x] Manual facial-verification fallback records reason and approver — tests/facial-verification.test.ts
      (9 cases: request captures reason/requester/timestamp + is audit-logged, approve/deny by a
      different user + audit-logged, self-approval rejected); now also wired into the gate flow itself
      (`markIdentityVerifiedManually` in gate-event-repository.ts), manually verified via curl
- [x] Delivery-note information is displayed without forcing duplicate capture — gate-facing lookup
      (`/api/gate/movements/search`) is read-only by construction (GET only, no PATCH/PUT route exists —
      manually verified 405 on PATCH); tests/gate-lookup-and-authorization.test.ts confirms a Gate
      Security Officer session has no EDIT/CREATE permission on movements; the Phase 3 gate check-in flow
      (`/gate` → `/gate/events/[id]`) carries the same movement record through start → inspection →
      clearance without ever re-prompting for cargo/delivery data already on the approved movement

This table is the authoritative "is it actually done" checklist; do not mark a checkbox without a passing
test in the repo backing it. As of 2026-07-21 (Phase 3), every row that was previously checked only against
the *MovementAuthorisation*-equivalent behaviour now has literal GateEvent/Exception coverage where GateEvent
is the actual subject of the requirement — noted inline above. As of 2026-07-22 (Phase 4), the two
previously-unchecked media rows above are now literal, with real MediaAsset coverage — noted inline above.

## Phase 4 coverage (evidence/media, added 2026-07-22)
- [x] File-type/size validation, server-side, typed errors not a generic 500 —
      `tests/media-asset-repository.test.ts` (rejects unsupported content type, empty file, oversized
      image); manually verified via curl (`text/plain` upload → 400, not 500)
- [x] Owner-existence-in-tenant check (guards a guessed/foreign ownerId) —
      `tests/media-asset-repository.test.ts` + `tests/media-tenant-isolation.test.ts`
      (`MediaOwnerNotFoundError`); manually verified via curl (nonexistent gate-event id → 404)
- [x] Upload retry without duplication (EVID-003 mandatory gate) —
      `tests/media-asset-repository.test.ts` ("uploading the same file with the same idempotency key twice
      results in exactly one MediaAsset row, returning the existing record on the second call", "rejects a
      retry that reuses the same idempotency key with genuinely different content", "allows the same
      idempotency key to be reused across two different tenants"); manually verified via curl (same
      idempotencyKey uploaded twice → same MediaAsset id both times, confirmed exactly 1 row via psql;
      same key + different content → 409, not a duplicate or a 500)
- [x] Signed-URL expiry and tenant-mismatch rejection — `tests/signed-url.test.ts` (7 pure unit cases:
      valid, expired vs. exact-boundary, tampered resourceKey, tampered expiresAt, wrong secret, malformed
      signature) + `tests/media-asset-repository.test.ts` (integration: mint → serve round-trip returns the
      exact original bytes; expired vs. tampered-signature give distinct rejection reasons)
- [x] Cross-tenant isolation for MediaAsset — `tests/media-tenant-isolation.test.ts` (5 cases: invisible via
      `getMediaAssetInTenant`, cannot mint a signed URL for another tenant's asset, cannot read via a
      genuinely-minted signature once the requesting session's tenant differs, cannot upload evidence
      against a foreign gate event id, `recordInspectionResult` rejects evidence belonging to a different
      gate event/tenant)
- [x] Precondition-violation errors are typed and map to 4xx, not a generic 500 — every new error class in
      `media-asset-repository.ts` (`InvalidFileTypeError`, `EmptyFileError`, `FileTooLargeError`,
      `ChecksumMismatchError`, `IdempotencyKeyConflictError`, `MediaOwnerNotFoundError`,
      `InvalidOrExpiredSignedUrlError`, `MediaAssetNotFoundForStorageKeyError`) is caught and mapped by
      every calling route; manually verified via curl with three deliberate out-of-sequence/bad-input
      calls (disallowed content type → 400, foreign ownerId → 404, idempotency-key content conflict → 409
      — none fell through to 500)
- [x] Full live curl verification (2026-07-22): login as Fleet Manager/Approving Manager/Gate Security
      Officer/Platform Administrator → create/submit/approve a movement → officer starts a gate event →
      identity verification → begin vehicle checks → Approving Manager blocked 403 uploading evidence (no
      `mediaAsset:CREATE`) → officer uploads evidence (201) → records the inspection result with the
      evidence linked (200) → officer mints a signed URL (200) → fetches it, receiving the exact original
      bytes with `Content-Type: image/jpeg` → a tampered signature is rejected (403) → a request with no
      signed-URL parameters is rejected (400) → a direct filesystem-style path to the storage location is
      not served (404, ×3 path shapes tried) → Platform Administrator (different tenant, no `mediaAsset`
      permission) blocked 403 minting a signed URL for the demo tenant's evidence → re-uploading with the
      same idempotency key returns the same MediaAsset id (201, not a duplicate — confirmed 1 row via
      psql).

**Test count as of 2026-07-22 (Phase 4): 286/286 passing across 25 files** (259 from Phase 3 + 27 new: 7
signed-url unit cases, 15 media-asset-repository cases, 5 media-tenant-isolation cases).

## Phase 3 coverage (gate operations, added 2026-07-21)
- [x] GateEvent state machine — full state×state matrix — tests/gate-event-state-machine.test.ts (134 cases)
- [x] GateEvent business rules (eligibility re-check at gate time, idempotent start, self-approval on
      serious exceptions, escalation-required-before-resolution, vehicle-lockout re-check at clearance,
      auto-exception-raising on inspection FAIL, movement-lifecycle side effects on clear/complete) —
      tests/gate-event-repository.test.ts (23 cases — 19 original + 4 precondition-error-typing
      regression cases added 2026-07-22, see below)
- [x] GateEvent tenant isolation — tests/gate-event-tenant-isolation.test.ts (2 cases)
- [x] InspectionTemplate versioning (new version deactivates the previous one; existing GateEvents keep
      pointing at their original version; category-specific template preferred over generic fallback) —
      tests/inspection-template-repository.test.ts (4 cases)
- [x] Full live curl verification (independently repeated end-to-end by the orchestrating session on
      2026-07-22, not just the delegated agent that originally built this — see WORKLOG.md): login as 5
      different seeded roles → create/submit/approve a movement → unauthorised role blocked from starting
      a gate event (403) → officer starts gate event → identity verification via mock provider
      (VERIFIED) → guided inspection (PASS + a FAIL that auto-raises a HIGH severity exception) → officer
      blocked from resolving their own exception (403, permission boundary) → resolution blocked before
      escalation (409) → officer escalates → Security Manager resolves (different user, succeeds) →
      vehicle cleared (linked movement side-effect confirmed IN_PROGRESS) → gate event completed →
      re-completing rejected (409, invalid transition) → duplicate gate-event start against an
      already-open event returns the same row, not a duplicate → security dashboard returns real
      DB-backed counts reflecting all of the above.
- [x] Precondition-violation errors are typed and map to 409/404, not a generic 500 — BUG-003 (found
      2026-07-22 during the independent re-verification above, by deliberately calling `identity/verify`
      out of sequence), fixed, regression-tested. See KNOWN_BUGS.md.

**Test count as of 2026-07-22: 259/259 passing across 19 files** (255 from the Phase 3 build + 4 BUG-003
regression cases).

## Additional security-closure coverage (not in the original mandatory-gate list, added 2026-07-20)
- [x] Session-expiry boundary behaviour — tests/session.test.ts (`evaluateSession`, 8 unit cases)
- [x] Suspending a user revokes their existing sessions — tests/session.test.ts (integration case)
- [x] A suspended user's/tenant's *new* login attempts are rejected, not just existing sessions —
      tests/login-eligibility.test.ts + tests/invitation.test.ts (this was BUG-002, see KNOWN_BUGS.md)
- [x] Platform Administrator has zero permission on ordinary business resources — tests/platform-admin.test.ts
- [x] Every Platform Administrator cross-tenant repository call is audit-logged — tests/platform-admin.test.ts
- [x] Invitation tokens: not-found/already-accepted/expired/revoked/tenant-suspended all rejected —
      tests/invitation.test.ts (6 cases)
- [x] Seed script refuses to run against a non-localhost DB or when NODE_ENV=production —
      tests/seed-guard.test.ts (6 cases)

## Additional Phase 2 coverage (added 2026-07-21)
- [x] VIN/registration uniqueness enforced server-side (DB constraint + friendly error, not just
      frontend validation) — tests/vehicle-uniqueness.test.ts (5 cases)
- [x] Expired document follows the tenant-configured expiry-rule action, never auto-denies without one —
      tests/document-expiry.test.ts (8 cases)
- [x] `evaluateDocumentExpiry` and the movement state machine are pure functions with full unit coverage,
      no DB required — tests/document-expiry.test.ts, tests/movement-state-machine.test.ts

## Known gaps (not yet covered by an automated test)
- The `audit_logs` append-only Postgres trigger is only manually verified (psql), not asserted by an
  automated test.
- The `queueMicrotask`-deferred data-fetch pattern used across admin pages (to satisfy
  `react-hooks/set-state-in-effect`) has no component-level test — covered only by manual browser/curl
  verification per WORKLOG.md.

## Unit tests
Target: permission-check logic, tenant-scope query wrapper, state-machine transition table, Zod schemas.

## Integration tests
Target: repository functions against a real (test) Postgres — tenant isolation is the priority target
since it cannot be reliably verified with mocks.

## Tenant-isolation tests
See mandatory gate above. Approach: create two tenants with overlapping data shapes in test fixtures,
authenticate as a user of tenant A, assert every list/get/export endpoint returns zero rows/403 for
tenant B's records — including by guessing tenant B's record IDs directly.

## Permission tests
Table-driven: for each (role, resource, action) combination expected by `PRODUCT_REQUIREMENTS.md`, assert
allowed/denied matches the permission matrix.

## Workflow tests
Playwright: full gate-event lifecycle (movement approval → gate arrival → inspection → clearance),
departure/return reconciliation, exception raise → supervisor approval.

## Media-upload tests
Retry-without-duplicate (idempotency key), file-type/size validation, signed-URL expiry, access-log
creation on read.

## Audit-integrity tests
Assert no application code path performs UPDATE/DELETE against `AuditLog`; assert every listed sensitive
mutation produces exactly one audit row with required fields populated.

## End-to-end tests
Playwright, covering the 15-step "Version 1 complete" workflow in `MVP_SCOPE.md`.

## Manual hardware/integration tests
Facial-verification and telematics providers are mock-only in V1 — no physical hardware test plan exists
yet; will be authored once a vendor is selected (see `INTEGRATIONS.md`).

## Phase 5A coverage (role realignment, added 2026-07-23)
- [x] Segregation of duties holds after the 8→9 role remap (DECISIONS.md D-015) —
      `tests/role-segregation.test.ts` (8 cases): Dispatch and Logistics Officer cannot approve/reject
      movements; Fleet and GPS Manager cannot create/edit movements (regression check — this permission
      moved to Dispatch and Logistics Officer); Gate Security Officer cannot resolve/approve exceptions or
      facial-verification fallbacks it can only create/request; Security Supervisor / Approving Manager
      cannot create a movement or raise an exception; Accountant / Finance and Compliance Officer cannot
      edit inspections/capture media/edit compliance documents; External Reviewer has no `user:VIEW` or
      `auditLog:EXPORT` (more restricted than Internal Investigator / Auditor); Executive Read-Only Viewer
      has zero media/evidence access; Company Administrator never gets `mediaAsset:CREATE`.
- [x] Manually verified via curl: Dispatch and Logistics Officer login + 403 on movement approve; Fleet
      and GPS Manager login + 403 on movement create.

## Phase 5B coverage (reconciliation, added 2026-07-24)
- [x] `tests/reconciliation-repository.test.ts` (24 cases): valid pairing through two different gates;
      auto-build via `completeGateEvent`; return-without-departure; duplicate return; incorrect
      movement/vehicle pairing (constructed data-integrity edge cases); reversed pairing; same-event
      pairing; same-direction pairing; not-yet-completed leg; idempotent retry (no duplicate row); every
      discrepancy category (odometer regression, excess mileage vs `expectedDistanceKm`, fuel increase,
      new vehicle damage + its linked Exception, tyre-tread drop, cargo/seal fail); no-discrepancy case;
      audit events on build and on resolve; resolve requires an explanation; already-resolved rejection;
      reconciliation stays OPEN while any discrepancy is unresolved.
- [x] `tests/reconciliation-authorization.test.ts` (4 cases): VIEW-only role cannot build/explain/resolve;
      officer-style role (VIEW+CREATE) cannot resolve; supervisor-style role (VIEW+EDIT+APPROVE) can; a
      role with no grant at all cannot even view.
- [x] Manually verified end-to-end via curl: full movement → approve → departure gate event (Main Gate,
      odometer 5000/fuel 70%) → return gate event (Yard Gate, odometer 5120/fuel 65%, deliberate new-damage
      FAIL) → auto-built reconciliation (kmTravelled 120, fuel delta -5%, one HIGH `VEHICLE_CONDITION`
      discrepancy with a linked `Exception` against the return GateEvent) → gate officer 403 on resolve →
      missing-explanation 400 → supervisor resolve 200 (reconciliation flips to RESOLVED) →
      already-resolved 409 → manual idempotent retry via `POST /api/reconciliations` 200 (same row) →
      same-gate-event-both-legs 409 → nonexistent-movement 404 → suspended user 401 on
      `/api/reconciliations`, reactivated and confirmed working again. No 500s observed at any step.

## Running tests locally
1. `docker compose up -d` (Postgres must be running; also used for the test DB, same container).
2. `npm test` — the `pretest` npm hook (`scripts/test-db-setup.mjs`) loads `.env.test` and runs
   `prisma migrate deploy` against `gate_fleet_governance_test` before Vitest runs, so migrations never
   need to be applied by hand for testing.
3. `npm run e2e` — Playwright; no specs exist yet (Phase 1 only has login/dashboard), config is wired for
   when Phase 3 gate-operations e2e specs land.

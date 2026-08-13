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

## Phase 5C coverage (dispatch workflow enhancements, added 2026-07-24)
- [x] `tests/dispatch-enhancements.test.ts` (11 cases): every new `MovementType` value accepted
      (parameterised) plus every pre-existing value still accepted; sender/recipient fields captured and
      independently optional; `vehicleUsePolicyId` accepted as a plain string with no FK validation (target
      model doesn't exist yet) and defaults null; document upload against a real movement succeeds,
      rejected against a cross-tenant movement id (`MediaOwnerNotFoundError`), and multiple documents per
      movement are allowed (no unique-per-owner constraint).
- [x] Manually verified via curl: created a movement with `movementType: SALES_VISIT`, sender/recipient
      fields and `expectedDistanceKm` all round-tripped correctly; uploaded a document via the existing
      `POST /api/media/upload` (no new endpoint) and confirmed it appears in `GET /api/movements/[id]`'s
      `documents` array for a role with `mediaAsset:VIEW`, and as an empty array for Executive Read-Only
      Viewer (no `mediaAsset` grant at all); minted a signed view URL successfully; both the movements list
      and detail admin pages render with the new fields/upload UI.

## Phase 6 coverage (telematics/geofencing/vehicle-use policies, added 2026-07-24)
- [x] `tests/telematics-repository.test.ts` (37 cases): `MockTelematicsProvider` every forced outcome
      (normal, offline/stale, unavailable, forced position, ignition-off); `geofence-engine` pure functions
      (haversine distance, geofence membership, every policy-violation type incl. the allow-flag bypasses);
      `syncVehicleTelematics` (vehicle-not-found, normal sync, stale/offline marks INACTIVE with zero
      violations evaluated, provider failure is a typed error and marks INACTIVE, a real geofence violation
      raises a HIGH vehicle-linked Exception with `gateEventId: null`, no violations when no active policy
      is assigned); manual GPS confirmation (request, self-approval blocked, different-user
      approve/deny, vehicle-not-found); Geofence CRUD + tenant isolation; VehicleUsePolicy (creation with
      driver/vehicle/geofence validation, only the named approving manager can approve, rejects approving a
      non-DRAFT policy, audit events on create/approve, tenant isolation).
- [x] `tests/telematics-authorization.test.ts` (4 cases): VIEW-only role cannot sync/configure/approve;
      officer-style role (VIEW+CREATE) cannot approve; no-grant role sees nothing; a policy-drafting role
      (VIEW+CREATE+EDIT) cannot approve.
- [x] Manually verified end-to-end via curl: synced a vehicle with no policy assigned (ACTIVE status, no
      violations) → created a geofence far from the mock provider's default position → created and approved
      a `VehicleUsePolicy` referencing it → re-synced the same vehicle → confirmed a HIGH
      `OUTSIDE_APPROVED_GEOFENCE` violation and a real linked `Exception` (`vehicleId` set, `gateEventId`
      null) → requested a manual GPS confirmation as a gate officer → confirmed self-approve blocked (403),
      wrong-role blocked (403, Dispatch and Logistics Officer has no `telematics:APPROVE`), supervisor
      resolve succeeded (200) → confirmed a `force:unavailable` device reference produces 503, not a raw
      500, and marks the vehicle INACTIVE → confirmed the geofences and vehicle-use-policies admin pages
      render (200).

## Phase 7 coverage (platform support-access view, added 2026-07-24)
- [x] `tests/support-access-repository.test.ts` (22 cases): health summary requires `platformTenant:VIEW`
      and returns real aggregate counts excluding the canonical platform tenant; session start requires a
      mandatory reason, is time-limited, and is audited; rejects a nonexistent or platform-slugged
      customer tenant; only the actor who started a session can end or elevate it (tested with a colleague
      in the *same* platform tenant, not an isolated one, matching real usage); rejects ending an
      already-ended session and elevating an ended one; the support view is refused with no active session,
      returns a bounded read-only summary once one exists, includes support notes, and is immediately
      revoked on exit; a session active for one customer tenant grants zero access to another (tenant
      isolation); an expired session (forced into the past) is rejected on the next request, same pattern
      as `evaluateSession()`; session audit history listing; wrong-role cases (VIEW-only cannot
      start/note, CREATE-only cannot elevate).
- [x] Manually verified end-to-end via curl: Platform Support Analyst blocked from viewing a customer with
      no session (403) → started a session with a reason → view succeeded → added a support note →
      elevation attempt blocked (403, no `supportAccessSession:CONFIGURE`) → exited the session → view
      blocked again immediately → Platform Administrator started and elevated their own session (200,
      `elevated: true`) → session audit history showed both entries with correct actor/reason/elevated/
      ended state → an ordinary customer-tenant Company Administrator got 403 on every support-access
      endpoint (zero grant, confirming the platform/customer boundary holds) → both UI pages render (200).

## Phase 8A coverage (engineering hardening, added 2026-07-26)
- [x] `tests/distance-engine.test.ts` (11 cases): timezone window boundaries (`startOfDayInTimeZone`/
      `startOfWeekInTimeZone`/`startOfMonthInTimeZone`) crossing the UTC calendar-day boundary; daily/weekly/
      monthly distance as baseline-to-latest odometer delta; `null` (not zero) when no baseline reading exists
      before the window; clamped to zero on an odometer rollback; trip-boundary detection via ignition
      off→on transitions, excluding an earlier completed trip; fallback to the earliest reading when ignition
      has been on throughout; `null` when no ignition signal exists at all.
- [x] `tests/telematics-repository.test.ts` "timezone boundary" suite (3 cases): permitted-day and
      permitted-hours evaluation uses the tenant's IANA timezone, not UTC/server-local — an instant that is
      Monday 23:30 UTC but already Tuesday 01:30 in `Africa/Johannesburg` is evaluated as Tuesday; the same
      instant against a different tenant timezone is evaluated differently, proving the timezone parameter is
      actually used, not vestigial.
- [x] `tests/telematics-repository.test.ts` "GPS-exception deduplication" suite (4 cases): three repeated
      syncs against the same unresolved violation produce exactly one `Exception` row with
      `observationCount: 3`, not three rows; a violation persisting past the escalation threshold flips
      MEDIUM→HIGH with `requiresSupervisorApproval: true` and an audit event; suspending the vehicle's policy
      (nothing left to violate) auto-clears the previously-open episode with a distinct resolution note and
      audit event, and no new exception is created afterward; a manually-raised exception
      (`violationType: null`) is left untouched by the reconciliation.
- [x] Manually verified end-to-end via curl against a running dev server: created a geofence + approved
      vehicle-use policy, synced the same vehicle three times — confirmed via `psql` exactly one open
      `OUTSIDE_APPROVED_GEOFENCE` exception (`observationCount: 3`) and the co-occurring `MEDIUM`
      `WEEKEND_USE_NOT_PERMITTED` violation escalated to `HIGH`/`requiresSupervisorApproval: true` with a
      `telematics.policyViolationEscalated` audit row; suspended the assigned policies and synced once more —
      confirmed both open exceptions transitioned to `resolvedAt` set with the automatic-clearing resolution
      note and a `telematics.policyViolationCleared` audit row each, and the sync response's `violations`
      array was empty.
- [x] `npm run verify:clean-migrations` (HARD-001): all 13 migrations, including this phase's, apply cleanly
      to a genuinely empty database created fresh on the same local Postgres container — no manual checksum
      edits.
- [x] Root-caused (not just silenced) the pg concurrent-query deprecation warning — see KNOWN_BUGS.md BUG-004
      for the underlying N+1 fan-out defect (fixed, verified 396/396→416/416 passing under the same
      1,283-tenant test database that previously caused intermittent timeouts) and the residual, functionally
      inert warning traced to Prisma's own runtime (left open, documented, not chased with an unconfirmed
      dependency upgrade).

## Phase 8B coverage (cost-efficient object-storage architecture, added 2026-07-26)
- [x] `tests/media-asset-repository.test.ts` (rewritten for the compression pipeline, 19 cases): a real
      valid image (`fakeImageBytes()`, `tests/helpers/fixtures.ts` — sharp-generated, since sharp now
      genuinely decodes uploaded evidence) compresses to WebP, checksum recorded over the *final* bytes
      (asserted distinct from a hash of the original), thumbnail generated and independently readable,
      `DAMAGE_EVIDENCE` preserves the original alongside the compressed copy while `OTHER_DOCUMENT` does
      not, capture metadata round-trips, all pre-existing type/size/checksum/idempotency/signed-URL cases
      still pass unchanged.
- [x] `tests/object-storage-phase8b.test.ts` (20 cases): full presigned-upload lifecycle (initiate → raw PUT
      → confirm → READY, compressed); confirming before the object exists marks FAILED and throws a typed
      error; confirming a non-PENDING asset is rejected; failed-upload cleanup removes an aged
      PENDING/FAILED row (and best-effort deletes its storage object) but leaves a young PENDING row and any
      READY row untouched regardless of age; storage-usage accounting aggregates READY bytes by category,
      excludes PENDING/FAILED from totals, and does not leak another tenant's usage;
      `R2CompatibleStorageProvider` throws `R2NotConfiguredError` from every method when unconfigured
      (the real state of this environment — no Cloudflare account exists) and generates a validly-shaped
      presigned URL against a fake config with zero real network calls; `media-categories.ts`
      (classification, per-kind size limits, every category has a rule, DAMAGE_EVIDENCE/
      INVESTIGATION_EVIDENCE preserve-original + high-quality); `image-compression.ts` (WebP conversion,
      1920px ceiling, never upscales, profile quality ordering, thumbnail ceiling, throws on undecodable
      input rather than silently passing it through).
- [x] `tests/signed-url.test.ts` extended (3 new "purpose isolation" cases): an upload-purpose token cannot
      be verified as a read-purpose token and vice versa.
- [x] Manually verified end-to-end via curl against a running dev server: uploaded a real 2400×1600 JPEG
      with `category=DAMAGE_EVIDENCE` via `POST /api/media/upload` — confirmed the response shows
      `contentType: image/webp`, a `thumbnailStorageKey`, an `originalStorageKey`, and
      `compressionProfile: high-quality`, with the compressed `fileSizeBytes` far smaller than the original;
      confirmed a VIEW-only role (no `mediaAsset:CREATE`) is blocked 403 initiating a presigned upload; ran
      the full presigned-upload lifecycle (`POST /api/media/presigned-upload` → `PUT
      /api/media/raw-upload` with the real file bytes, no auth cookie, matching how a real S3/R2 presigned
      URL behaves → `POST /api/media/[id]/confirm-upload`) and confirmed the resulting asset is `READY`,
      `contentType: image/webp`, category `VEHICLE_INSPECTION_PHOTO` with the `standard` profile and no
      preserved original (correct per that category's policy); confirmed re-confirming an already-confirmed
      upload correctly 404s (`PendingUploadNotFoundError`), not a 500.
- [x] `npm run verify:clean-migrations` — all 14 migrations, including this phase's, apply cleanly to a
      genuinely empty database.

## Phase 8C coverage (retention, archive and deletion, added 2026-07-26)
- [x] `tests/retention-repository.test.ts` (31 cases): pure `deletion-rules.ts`/`archive-pricing.ts` engine
      tests (eligibility blocking for each of legal-hold/investigation-hold/unresolved-exception
      independently, `computeScheduledDeletionAt`, `currentRetentionMilestone` boundary sweep across every
      90/60/30/7/0 threshold plus "too far out" and "already past" cases, archive-tier boundary matches
      against the exact ZAR-excl-VAT pricing schedule); `RetentionPolicy` default-fallback and per-category
      override with tenant isolation; legal hold and investigation hold each independently exclude an asset
      from a deletion request's scope, and releasing a hold restores eligibility; an unresolved `Exception`
      linked via a real `GateEvent` blocks deletion; `extendRetention` is audit-logged;
      `moveAssetsToArchive` respects a category's `archiveEligible` policy flag and reports usage through a
      spy billing hook; **dual-control deletion workflow**: the initiator cannot approve *or* reject their
      own request (`SelfApprovalNotAllowedError`), only the initiator can cancel their own pending request
      (`NotRequestInitiatorError`), approving/rejecting/completing a request in the wrong status is
      rejected, completing before the recovery period elapses is rejected
      (`RecoveryPeriodNotElapsedError`), completing an unapproved request is rejected
      (`DeletionRequestNotApprovedError`); permanent deletion after the recovery period issues a
      `DeletionCertificate` with an exact checksum manifest match, deletes the storage object, and leaves
      the `MediaAsset` row itself intact as a metadata tombstone (`retentionStatus: DELETED`,
      `binaryDeletedAt` set); an asset that gains a hold *during* the recovery window is skipped at
      completion time, not deleted (three-layer defense in depth: creation, approval, completion); deletion
      never touches another tenant's assets; export requests generate a manifest with a valid signed URL
      and checksum per asset and never include another tenant's evidence; retention-notification milestone
      computation finds assets due within 90 days and excludes archived ones.
- [x] `tests/retention-authorization.test.ts` (4 cases): VIEW-only role cannot CREATE/APPROVE/CONFIGURE/
      EXPORT; a Company-Administrator-style role (CREATE+CONFIGURE+EXPORT) cannot APPROVE; an
      approver-style role (VIEW+APPROVE) cannot CREATE or CONFIGURE; no-grant role cannot even VIEW.
- [x] Manually verified end-to-end via curl against a running dev server: uploaded evidence, applied a
      legal hold as Company Administrator, confirmed a deletion request scoped to that category correctly
      409s with `EmptyDeletionScopeError` (nothing eligible); released the hold, created the deletion
      request (201); Company Administrator's own self-approval attempt correctly 403s at the permission
      layer (the seeded role grants CREATE/CONFIGURE but never APPROVE, structurally mirroring the hard
      self-approval rule as an additional layer); Security Supervisor (a genuinely different user, holding
      `retention:APPROVE`) approved successfully, receiving a `recoveryExpiresAt` 30 days out; completing
      immediately correctly 409s (`RecoveryPeriodNotElapsedError`); back-dated `recoveryExpiresAt` directly
      via `psql` (disposable local dev data) to simulate elapsed recovery, then completed successfully —
      confirmed via `psql` the storage object was actually removed from `.data/media/` and the `MediaAsset`
      row survives with `retentionStatus: DELETED`, `binaryDeletedAt` set, and its original
      `checksumSha256` intact; created an export request and confirmed its manifest contains a real,
      fetchable signed URL. No raw 500s at any step.
- [x] `npm run verify:clean-migrations` — all 16 migrations, including both of this phase's, apply cleanly
      to a genuinely empty database.

## Phase 8D coverage (platform and customer storage dashboards, added 2026-07-26)
- [x] `tests/storage-dashboard-repository.test.ts` (8 cases): `getPlatformStorageDashboard` requires
      `platformTenant:VIEW`; excludes the canonical platform tenant and correctly reports a real customer
      tenant's active-vehicle count, current storage, and per-category breakdown; evidence-under-hold,
      failed-upload, and export/deletion-request counts are all correct and isolated per tenant;
      **BUG-005 regression coverage**: a permanently-deleted asset's bytes are excluded from
      `currentStorageBytes` (its binary is actually gone) and an archived asset's bytes are counted only in
      `archivedBytes`, never both; a nonexistent tenant id returns `null` rather than throwing.
- [x] Manually verified end-to-end via curl against a running dev server: fetched the platform dashboard as
      Platform Administrator and confirmed real, correct per-category totals for the demo tenant — this is
      exactly where BUG-005 was found (a `CARGO_EVIDENCE` asset deleted earlier in the same session's Phase
      8C live testing was still showing up as 306 bytes of "current storage"); fixed, then re-verified live
      that the number dropped by exactly 306 bytes and the now-empty category entry disappeared entirely;
      fetched the customer dashboard as Company Administrator (200, correct data) and as Executive
      Read-Only Viewer (403, no `retention` grant at all).
- [x] `npm run verify:clean-migrations` — all 16 migrations (no schema change in this subphase) still apply
      cleanly to a genuinely empty database.

## Phase 8E coverage (retention operationalisation and corrections, added 2026-07-27)
- [x] `tests/retention-assignment.test.ts` (10 cases): direct-upload and presigned-upload paths both assign
      `scheduledDeletionAt` on READY, using the effective per-category policy or the 365-day default;
      `backfillMissingScheduledDeletionAt()` assigns for an ordinary ACTIVE legacy asset and one with a
      category-specific policy override, but never for an ARCHIVED, DELETED, held (legal or investigation),
      or explicitly-extended (`retentionExtendedAt` set) asset; idempotent — a second run assigns nothing.
- [x] `tests/retention-repository.test.ts` boundary additions (7 new cases): `getArchiveTierForBytes(0)`
      returns the dedicated R0 tier, not the lowest paid one; the first archived byte prices at the lowest
      *paid* tier; exact-boundary cases at 100GB/100GB+1/250GB/500GB/exactly-1TB/1TB+1byte all land in the
      correct tier, including the corrected 1TB boundary (was previously miscomputed against a decimal-GB
      assumption).
- [x] `tests/retention-notification-repository.test.ts` (5 cases): generation creates exactly one record
      per (asset, milestone, scheduledDeletionAt) and is a no-op on re-run; a genuinely new scheduled-
      deletion date (e.g. after an extension) does get a fresh notification; delivery groups same-tenant/
      category/milestone records into one batch with correct category/date-range/storage/actions and marks
      every member record SENT; a provider failure marks records FAILED with a reason and a retry can
      succeed; the no-op provider always reports delivered with no side effects.
- [x] `tests/background-jobs.test.ts` (11 cases): `runJob()` records SUCCEEDED/FAILED `JobRun` rows
      correctly; a second concurrent attempt at the same `jobName` while one is RUNNING is refused
      (`JobAlreadyRunningError`) via the real partial-unique-index constraint, not a mocked check; a fresh
      run is allowed once the previous one is no longer RUNNING; `authorizeJobRequest()` fails closed with
      no `JOB_SCHEDULER_TOKEN` configured (even with a token header present), rejects a wrong token, and
      accepts the correct token with no user session; `expireOldExportRequests`,
      `reportArchiveUsageForAllTenants` (never reports a zero-byte tenant), and
      `expireDueSupportAccessSessions` all scoped-and-boundary tested.
- [x] `tests/retention-evidence-listing.test.ts` (6 cases): `listEvidenceInTenant()` never returns
      `storageKey`/`checksumSha256`/thumbnail/original keys; filters correctly by category, hold status, and
      approaching-expiry window; excludes binary-deleted evidence; never crosses tenant boundaries.
- [x] `tests/video-capture-policy.test.ts` (15 cases): duration clamping to [30, 60]; file-size
      estimate/bitrate-estimate are consistent inverses; policy-violation checks at exact boundaries (0/1
      byte over the size limit, within/beyond the 1s duration grace window); mime-type selection preference
      order and honest fallback (never claims a codec `isTypeSupported` didn't actually report).
- [x] Test-database isolation (8E-007, no dedicated test file — a testing-infrastructure fix, not a
      product feature): `tests/helpers/fixtures.ts`'s `createTenant()` tracks every tenant it creates;
      `tests/setup/global-cleanup.ts` (a Vitest `setupFile`, so it runs once per test file) deletes them all
      in an `afterAll`, using `SET LOCAL session_replication_role = replica` inside a per-tenant transaction
      to bypass the `audit_logs` append-only trigger for exactly that one disposable cleanup transaction —
      never during an actual test of the trigger's own behavior. Verified via two consecutive full-suite
      runs with the test database's tenant count confirmed to hold at exactly 1 throughout.
- [x] `e2e/retention-management.spec.ts` (2 Playwright specs, real Chromium against a running dev server and
      the seeded `acme-logistics` demo tenant): `/admin/retention` renders real policy/evidence/export/
      deletion-request data for a Company Administrator; a deletion request initiated by the Company
      Administrator is approved end to end by a different authenticated user (Security Supervisor /
      Approving Manager) through the real UI — separation of duties proven through actual browser sessions.
- [x] `e2e/video-capture-smoke.spec.ts` (1 Playwright spec, Chromium `--use-fake-device-for-media-stream`):
      `VideoCaptureRecorder` acquires a real (fake-device) camera stream and reaches the ready-to-record
      state. This exact test caught a real `getUserMedia` `OverconstrainedError` bug (see D-030) — fixed,
      then re-verified clean. Known to `test.skip()` (not false-fail) when the dev-seeded gate event it
      depends on isn't in the right state; not yet a fully deterministic fixture (TODO.md).
- [x] `npm run verify:clean-migrations` — all 19 migrations (3 new: `retention_extension_and_backfill`,
      `retention_notifications`, `job_runs`) apply cleanly to a genuinely empty database.
- [x] Full suite: 539/539 passing, run twice consecutively clean, plus a third clean run after the live
      video-capture bug fix.

## Phase 9 coverage (on-device facial verification and basic liveness, added 2026-07-27)
- [x] `tests/facial-template-encryption.test.ts` (6 cases): a descriptor round-trips through encrypt/decrypt
      exactly (within float32 precision); the ciphertext is never equal to the plaintext bytes; every
      encryption gets a fresh iv (never reused); decryption rejects an unrecognised key id; a tampered
      ciphertext fails to decrypt (AES-256-GCM auth-tag mismatch).
- [x] `tests/facial-descriptor-math.test.ts` (11 cases): Euclidean distance, mean-descriptor averaging, and
      `evaluateMatch()`'s three-tier MATCH/REVIEW_REQUIRED/NO_MATCH outcome at and around both configurable
      thresholds.
- [x] `tests/facial-capture-quality.test.ts` (11 cases): every individual capture-quality issue code
      (no/multiple faces, too small/off-center, too dark/bright/blurry, low detection confidence), combined
      issues, and a custom policy override.
- [x] `tests/facial-enrolment-repository.test.ts` (11 cases): enrols from 3-5 guided captures storing only
      the encrypted mean descriptor; rejects missing consent, too few/many captures, and mutually
      inconsistent captures; rejects a nonexistent driver; re-enrolment revokes the previous ACTIVE template
      (exactly one ACTIVE row survives, enforced by the database's own partial unique index); revocation
      clears the driver's enrolled flag; decrypts back to the enrolled descriptor and returns `null` once
      revoked; status/history responses never include template bytes; never crosses tenant boundaries.
- [x] `tests/facial-verification-attempt.test.ts` (11 cases): `runOnDeviceFacialVerificationAttempt()`
      always compares against exactly the one driver assigned to the gate event's own movement — MATCH
      advances the gate event to IDENTITY_VERIFIED, every other outcome (NO_MATCH, REVIEW_REQUIRED,
      NOT_ENROLLED, CAPTURE_FAILED, LIVENESS_FAILED, PROVIDER_UNAVAILABLE) leaves it in IDENTITY_PENDING; a
      FAILED liveness result short-circuits before any match is even attempted (a live descriptor that would
      otherwise match still cannot produce MATCH); refuses to run outside IDENTITY_PENDING; records a full
      audit history entry for every attempt; rate-limits repeated attempts on the same gate event; never
      matches against another tenant's driver template.
- [x] `tests/liveness-challenge.test.ts` (13 cases): random challenge selection only ever returns a known
      type; BLINK/TURN_LEFT/TURN_RIGHT/MOVE_CLOSER each pass/fail correctly; a single frame (i.e. a still
      photo) can never complete a challenge (`FAILED_NO_PROGRESS`); every frame being identical is
      classified as `FAILED_STATIC_INPUT` even with enough frames, distinct from merely insufficient
      progress; a frame window exceeding the time limit fails with `FAILED_TIMEOUT`; escalation triggers
      once `attempts >= maxRetries`.
- [x] `tests/cloud-fallback-repository.test.ts` (4 cases): `NoOpCloudLivenessProvider` is always honestly
      `PROVIDER_UNAVAILABLE`, never a fabricated result; `MockCloudLivenessProvider` returns whichever
      outcome it's constructed to force; every invocation is recorded with its own audit row; usage
      aggregates by reason, scoped per tenant.
- [x] `e2e/facial-verification-smoke.spec.ts` / `e2e/facial-verification-gate-smoke.spec.ts` (Chromium
      `--use-fake-device-for-media-stream`): both the driver-enrolment and gate-verification components
      genuinely load the MediaPipe WASM runtime + FaceLandmarker `.task` model from Google's CDN and the
      face-api.js face-recognition model from this app's own `/models/face-recognition` static assets, and
      run real per-frame detection inference without error — this is exactly where a real SSR crash was
      found and fixed (a static top-level `import` of `@vladmandic/face-api` was evaluated during Next's
      server-render pass, where browser globals it depends on don't exist; fixed by converting both browser
      model loaders to dynamic `import()` calls inside the functions that use them, resolved only after
      hydration). A fake camera device produces a synthetic pattern, not a real face, so these specs prove
      the model-loading/detection-loop half of the pipeline, not a real MATCH outcome — that decision logic
      is covered above instead.
- [x] `e2e/facial-verification-workflow.spec.ts` (Phase 9I, real browser sessions across six role logins:
      Company Administrator, Fleet and GPS Manager, Dispatch and Logistics Officer, Security Supervisor /
      Approving Manager, Gate Security Officer, Platform Administrator): creates two fictional synthetic
      test drivers, enrols one via the real enrolment API with synthetic (non-biometric, numeric) descriptor
      arrays and an explicit consent acknowledgement, creates/submits/approves movements across separate
      roles, starts gate events, and drives every required `FacialVerificationAttempt.result` outcome
      through the real API — MATCH, NO_MATCH, LIVENESS_FAILED, NOT_ENROLLED, PROVIDER_UNAVAILABLE — plus the
      manual-fallback path (self-approval rejected, a different role approves, the officer confirms), audit-
      trail visibility and permission boundaries (Dispatch and Logistics Officer, which holds neither
      `facialVerificationAttempt` permission, is denied; Company Administrator's oversight-only VIEW grant
      succeeds), and cross-tenant denial (the platform tenant's own admin cannot see this tenant's
      enrolment). No real biometric data is used anywhere — every descriptor is a synthetic numeric array
      derived from a seed value, never a captured face.
- [x] `npm run verify:clean-migrations` — all 20 migrations (1 new: `phase9_facial_verification`) apply
      cleanly to a genuinely empty database.
- [x] Full suite: 605/605 passing, run twice consecutively clean; tenant count in the test database
      confirmed to hold at exactly 1 across both runs.

## Phase 9F coverage (facial-verification browser follow-ups, added 2026-07-27)
- [x] `GateFacialVerification`'s unsupported-browser, camera-permission-denied, and model-load-failure
      paths all now report a real, audited `PROVIDER_UNAVAILABLE` `FacialVerificationAttempt` via the
      existing API (repository-level coverage: `tests/facial-verification-attempt.test.ts`'s existing
      PROVIDER_UNAVAILABLE case; browser-level: `e2e/facial-verification-gate-smoke.spec.ts`'s new test —
      stubs `navigator.mediaDevices` to `undefined`, confirms the settled UI never shows "Verified", always
      shows a safe "Facial verification unavailable" state with a retry and manual-fallback route, the gate
      event never silently advances past IDENTITY_PENDING, and the attempt is genuinely audited server-side).
- [x] `e2e/helpers/gate-fixtures.ts` — `e2e/facial-verification-gate-smoke.spec.ts` and
      `e2e/video-capture-smoke.spec.ts` no longer depend on a specific seeded gate event's status/ordering;
      each test now builds its own dedicated driver/movement/gate event via real API calls and drives it to
      the required state deterministically. Both specs run repeatedly clean (`--workers=1`, since several
      heavy multi-role-login fixture builds against one shared dev server benefit from serial execution —
      an initial parallel run produced spurious webServer-contention timeouts unrelated to the fix itself).

## Phase 10 coverage (subscriptions, billing and invoicing, added 2026-07-28)
Full requirement-by-requirement detail in BILLING_AND_SUBSCRIPTIONS.md.
- [x] `tests/billing-money.test.ts` (8 cases): the approved worked example exactly (15 vehicles -> R6,484
      subtotal before VAT); 0/1/large fleet counts; VAT applied only when a rate is configured;
      tenant-negotiated pricing produces a different total; round-half-up VAT rounding; ZAR display
      formatting.
- [x] `tests/platform-billing-repository.test.ts` (5 cases): singleton auto-creation; `platformBilling:
      CONFIGURE`-gated settings update, denied for an unauthorised role; VAT cannot be enabled without a
      rate configured first; 20 genuinely concurrent `allocateNextInvoiceNumber()` calls produce 20 unique
      numbers; append-only pricing versions resolve correctly by `effectiveFrom`.
- [x] `tests/tenant-billing-repository.test.ts` (6 cases): profile view/edit permission boundary; billing
      contacts create/list/deactivate feed the email-delivery list correctly; a tenant-negotiated agreement
      overrides the platform default for that tenant only; append-only pricing never retroactively changes
      an earlier resolved price; rejects a negative/non-integer pricing amount; a customer-tenant role can
      never edit pricing directly.
- [x] `tests/billable-vehicle-repository.test.ts` (9 cases): 0/1/15/40-vehicle counts; a DECOMMISSIONED or
      archived vehicle excluded, a WORKSHOP_LOCKOUT/SECURITY_LOCKOUT vehicle still counted; the approved
      worked example's exact fees; tenant-negotiated pricing applied; idempotent for the same tenant+period
      including under real concurrency (10 simultaneous calls -> exactly 1 snapshot row); a price change
      between periods never retroactively affects an already-generated snapshot.
- [x] `tests/invoice-repository.test.ts` (15 cases): snapshot-required-first precondition; the exact worked
      example; VAT applied and "TAX INVOICE" labelling only when the platform's VAT registration + rate are
      both configured, never charged without a VAT registration number even if a rate exists; 0/1-vehicle
      edge cases; idempotent per billing period including under real concurrency; unique sequential numbers
      across concurrent generation for different tenants; a real PDF genuinely rendered and attached via the
      existing MediaAsset architecture (system-generated, `capturedByUserId` null); an issued snapshot is
      immutable to a later pricing change; void requires `invoice:EDIT`, refuses an already-PAID or
      already-VOID invoice, cross-tenant denied; reissue requires VOID first and links back via
      `reissueOfInvoiceId`; list/get require `invoice:VIEW` and never return another tenant's invoices.
- [x] `tests/payment-repository.test.ts` (11 cases): `payment:CREATE`-gated initiation, refuses a
      non-payable invoice; a successful webhook marks the invoice PAID exactly once even processed twice
      (duplicate webhook -> `DUPLICATE`, no second `Payment` row); FAILED/PENDING provider statuses never
      mark an invoice paid; amount-mismatch and currency-mismatch webhooks rejected and audited; an invalid
      webhook signature rejected before any content is trusted; manual payment requires an exact
      amount/currency match, a proof reference, and `payment:CREATE`; no card/CVV/banking-credential field
      exists on the `Payment` schema; a successful payment restores a SUSPENDED tenant once no invoices
      remain outstanding; `listPaymentsForTenant` requires `payment:VIEW` and tenant-isolated.
- [x] `tests/billing-email-repository.test.ts` (8 cases): `NoOpBillingEmailProvider` never claims delivery;
      exactly one email per active billing contact for a genuine payment-success event via the mock
      provider; idempotent per (invoice, payment) including under real concurrency (8 simultaneous calls ->
      1 delivery); an authorised resend is always a new, deliberate delivery, never blocked by the
      payment-event idempotency guarantee; a failed send is recorded and never reverses the triggering
      payment; delivery history requires `billingEmail:VIEW`; no recipients configured sends nothing and
      never throws.
- [x] `tests/subscription-repository.test.ts` (9 cases): PENDING never blocks movement creation; suspension
      requires PAST_DUE first; PAST_DUE is a warning only, never blocks; SUSPENDED blocks new movement
      creation (`TenantAccessSuspendedError`) but leaves all existing data completely untouched; explicit
      platform-admin suspend/restore is permission-gated and records the actor; an automated suspension
      (actor null) is still fully audited; cannot restore an ACTIVE/PENDING subscription;
      `isEligibleForAutomatedSuspension()` grace-period boundary (pure function); the automated-suspension
      sweep only acts on a genuinely-elapsed PAST_DUE tenant.
- [x] `tests/recurring-billing-repository.test.ts` (4 cases, 90s timeout — this function scans every ACTIVE
      tenant in the whole database, which under Vitest's full-suite parallel execution genuinely takes
      longer than the default per-test budget when many unrelated test files' tenants exist at once, not a
      performance defect): generates exactly one invoice per active tenant for the reference month; running
      the identical cycle three times never duplicates an invoice or a snapshot for the same tenant; never
      bills the platform tenant itself; marks a backdated invoice overdue and (once the grace period has
      elapsed) automatically suspends.
- [x] `tests/billing-tenant-isolation.test.ts` (5 cases, P10N): documents and proves the real cross-tenant
      boundary (every customer-facing route hardcodes `session.tenantId`, verified directly against route
      source; only platform-only-permission-gated routes accept an explicit tenant id); there is no code
      path that lets a client mark an invoice paid directly, only a genuine webhook or an audited manual
      payment; the `Payment` schema has no card/CVV/banking field; `getInvoiceForTenant` never returns a
      cross-tenant result even with a valid permission; a session with zero billing permissions is rejected
      with `ForbiddenError`, never a silent empty result.
- [x] `e2e/billing-workflow.spec.ts` (2 tests, run repeatedly clean against the real dev server): platform
      admin negotiates pricing, the Accountant configures the tenant's own billing profile, an invoice is
      generated for a tenant with 15+ active vehicles, the Accountant views and downloads the real PDF, a
      restricted role (Gate Security Officer) is denied at every billing endpoint, a dedicated fresh second
      tenant genuinely receives a 404 for the first tenant's invoice, a real provider webhook marks the
      invoice paid, the exact same webhook event delivered again produces `DUPLICATE` (still exactly one
      `Payment` row), the billing email is recorded exactly once for that payment event, both dashboard
      pages render the expected data; a second test proves a not-yet-PAST_DUE tenant cannot be suspended
      directly and an ordinary operational role (Dispatch and Logistics Officer) is denied at every billing
      endpoint. This spec's own idempotent design (checks the invoice's current status before re-attempting
      payment) is itself what makes repeated runs against the same real tenant/period stable — see the
      spec's own comments.
- [x] Visually inspected in a real browser: `/platform/billing` (dashboard list), `/platform/billing/
      [tenantId]` (drill-down: subscription/pricing/invoices/payments), `/admin/billing` (customer
      Accountant portal), a normal invoice PDF ("VAT was not charged on this invoice"), and a
      VAT-configured tax invoice PDF (correct 15% line and total) — found and fixed BUG-009 (pdfkit/
      Turbopack `__dirname` bundling) via this same live verification.
- [x] `npm run verify:clean-migrations` — all 21 migrations (1 new: `phase10_billing_and_subscriptions`)
      apply cleanly to a genuinely empty database.
- [x] Full suite: 680/680 passing, run consecutively clean.

## Running tests locally
1. `docker compose up -d` (Postgres must be running; also used for the test DB, same container).
2. `npm test` — the `pretest` npm hook (`scripts/test-db-setup.mjs`) loads `.env.test` and runs
   `prisma migrate deploy` against `gate_fleet_governance_test` before Vitest runs, so migrations never
   need to be applied by hand for testing.
3. `npm run e2e` — Playwright, against a running (or auto-started) dev server and the seeded dev database.
   Six specs exist as of Phase 9: `e2e/retention-management.spec.ts`, `e2e/video-capture-smoke.spec.ts`,
   `e2e/facial-verification-smoke.spec.ts`, `e2e/facial-verification-gate-smoke.spec.ts`, and
   `e2e/facial-verification-workflow.spec.ts` — the camera-dependent specs need Chromium launched with
   `--use-fake-device-for-media-stream` (already configured per spec file via `test.use({ launchOptions })`)
   to acquire a camera stream without real hardware. A failing spec's page state is captured as a screenshot
   automatically (`playwright.config.ts`'s `screenshot: "only-on-failure"`).
4. `npm run job -- --list` / `npm run job -- <name>` (Phase 8E-004) — runs one background job against a
   running dev server; requires `JOB_SCHEDULER_TOKEN` to be set (the endpoint fails closed without it).

## Phase 11 verification — investigations and external audit

- Repository/security coverage: case, referral, evidence/hold, finding, report, notification,
  external-auditor access, and dedicated confidentiality tests.
- Proved boundaries include tenant and parent/child isolation, cross-tenant entity rejection,
  confidential case/note/evidence filtering, no biometric leakage, concurrent numbering/referrals,
  append-only history, hold-aware retention, separation of duties, and external grant gates.
- Report tests render real PDFs for three outcomes, extract text, filter restricted content, exercise long
  pagination, and guard against blank trailing pages.
- `e2e/investigation-workflow.spec.ts` covers the full multi-role manual lifecycle and a gate-officer
  referral with duplicate reuse/source immutability in real Chromium.
- Playwright intentionally uses one worker: these stateful integration workflows share one seeded database
  and one Next dev server. Whole-test timeout is 180 seconds; locator assertions remain 15 seconds.
- Final baseline: **64 files / 735 Vitest tests**, **11 Playwright tests**, clean TypeScript/ESLint/build,
  Prisma validation/status, and all 24 migrations replayed from empty.
- Known non-failing output: BUG-010's pg adapter deprecation and Next dev socket-listener warnings.

## Phase 12 verification — governance analytics and risk indicators

- Four new Vitest files add 30 tests for tenant/time-zone date boundaries, dashboard aggregate/filter
  correctness, rule versioning and immutable snapshots, minimum samples, deterministic persistence,
  cooldown/idempotency, eight-way constraint concurrency, mock/manual/unavailable data, review chronology,
  dismissal/reopen/escalation/linkage, supporting-record permissions, confidential aggregate redaction,
  formula-safe CSV, PDF disclosure/isolation, and job retry/overlap behavior.
- `e2e/governance-analytics-workflow.spec.ts` adds three serial Chromium tests: manager dashboard/filter/
  rule/review/dismiss/export/report; denied/restricted/foreign-tenant/altered-ID separation; and
  deterministic indicator escalation with persisted same-tenant case linkage.
- Visual artifacts cover desktop, 768px tablet, 390px mobile, rule configuration, indicator detail,
  chronology, empty filtered indicators, mock disclosure, CSV, and both rendered PDF pages. The PDF review
  found and fixed BUG-013 before final verification.
- The shared Playwright login helper verifies populated fields and retries one cold-dev-server reload after
  a bounded 45 seconds (BUG-014); this prevents an empty login page from consuming a whole workflow timeout.
- Focused development command:

  `npx vitest run tests/analytics-rules-and-timezone.test.ts tests/analytics-calculation-repository.test.ts tests/analytics-indicator-workflow.test.ts tests/analytics-dashboard-export-job.test.ts`

- Final gate also runs `npx prisma format`, `npx prisma validate`, `npx prisma generate`,
  `npx prisma migrate status`, `npm run verify:clean-migrations`, `npx tsc --noEmit`, `npm run lint`,
  `npm test`, `npm run build`, and `npx playwright test`, twice from a stable tree.
- Final baseline: **68 files / 765 Vitest tests**, **14 Playwright tests**, **103/103** generated static
  pages, clean TypeScript/ESLint/build, Prisma validation/status, and all **26 migrations** replayed from
  empty in each gate.
# Phase 13A verification additions

New coverage exercises configuration/environment separation, readiness classifications and redaction, health/diagnostic authorization, CSRF policy, rotating scheduler/media/session keys, local database guards and actual dump/restore, storage contract/health, tracker capability/freshness/timeout/retry/revocation/isolation, transactional-email no-op/idempotency, payment lifecycle/disabled PayFast/open redirects, login throttling, bounded notification retries, job error redaction, and the platform readiness browser view/permission denial. `npm run performance:pilot` is a bounded, read-only local regression probe; its timings are not capacity claims.

The final stable-source gate passed twice. Each pass completed clean install/lockfile integrity, Prisma format/validate/generate/status, empty replay of all 27 migrations, isolated backup/restore, TypeScript, ESLint, **73 Vitest files / 808 tests**, a Next.js 16.3.0 production build with **104/104** generated pages, **16/16 Playwright tests**, dependency audit with **0 vulnerabilities**, fail-closed production readiness, secret/diff checks and the local performance probe. Gate A's Vitest run took 200.04 seconds and Playwright 5.4 minutes; Gate B took 192.51 seconds and 5.3 minutes respectively.

Container verification built image `genbridge-governance:phase13-local`, confirmed the final image contains no build-only `DATABASE_URL`, runs as `nextjs` (UID 1001), reached Docker `healthy`, and returned `{"status":"ok"}` from `/api/health/live`. The exact smoke container was removed afterward; the local image was retained.

# Phase 14A pilot verification

Focused commands are `npm run pilot:seed`, `npm run pilot:verify`, `npm run pilot:test-boundaries`, `npm run pilot:imports:validate`, `npm run pilot:uat:validate`, `npx vitest run tests/pilot-safety.test.ts tests/pilot-import-validator.test.ts tests/uat-catalogue.test.ts`, and `npx playwright test e2e/pilot-readiness.spec.ts`. The pilot browser spec validates exact tenant data, least privilege, cross-tenant IDs, external-auditor scope, keyboard/accessibility names, 24px targets, four phone/tablet orientations, mobile overflow and online-only failure/recovery. Existing serial workflows remain the end-to-end authority for dispatch/approval/gate/evidence/reconciliation, exception/referral, independently approved investigation, analytics lifecycle, external-auditor revocation, billing and readiness. `npm run pilot:rc` composes the complete local gate and expects production readiness to exit 1.

# Phase 15A verification scope

Focused Phase 15A coverage exercises all 27 simulator scenarios, production refusal, artificial identity/
coordinates, poisoned numeric/timestamp quarantine, unknown-value preservation, unit conversion, mapping
authorization/isolation/uniqueness/effective dates/correction history, idempotent event context, provenance
labels, log/CSV injection, UAT pack chronology/roles/sign-off, and staging fail-closed validation. The
reusable conformance command currently reports 25 checks spanning capabilities, auth/isolation, pagination,
normalization/provenance/freshness, mapping, timeout/rate-limit/partial/malformed profiles, duplicates,
ordering/late events, outage recovery, bounded retry/backoff, signature/replay, polling, revocation, audit
and log redaction.

The pilot browser workflow now verifies synthetic and unavailable tracker disclosures, mapping status,
ordinary-role mapping denial, fingerprint-only mapping history, responsive behavior at mobile portrait/
landscape, tablet portrait/landscape and desktop sizes, accessible names, loading and the existing error/
offline paths. Automated rehearsal remains evidence for human testers, never a UAT PASS.

Focused suites cover all 27 simulator scenarios, production refusal, capability/pagination, units/timestamps, duplicate/out-of-order/late/freshness, partial/malformed data, timeout/rate-limit/recovery, webhook signature/replay, revocation, cross-tenant mapping, mapping authorization/uniqueness/audit/correction history, provenance labels, UAT pack digest/roles/chronology/formula safety and staging fail-closed rules.

Commands are `npm run tracker:conformance`, UAT execution init/validate/export under ignored storage, `npm run staging:check` (expected exit 1 without approvals) and `npm run staging:rc`. The final staging gate covers 29 migrations/clean replay/restore, TypeScript, ESLint, full Vitest/build/Playwright, pilot boundaries/import/UAT, secret scan, audit, expected blocked production/staging readiness, performance and non-root container health twice. Automated rehearsal remains distinct from human UAT.

The executable candidate `c9df227` passed that complete 25-step gate twice consecutively. Gate A ran
17:45:48-18:03:57Z (18.1 minutes): Vitest 208.6 seconds, build 65.6 seconds, Playwright 362.2 seconds and
container verification 174.6 seconds. Gate B ran 18:04:56-18:19:20Z (14.4 minutes): Vitest 224.9 seconds,
build 58.1 seconds, Playwright 353.9 seconds and cached container verification 14.9 seconds. Each pass
confirmed all 29 migrations, 81 Vitest files / 858 tests, 104/104 generated pages, 25/25 provider
conformance checks, all 27 UAT definitions with zero human execution events, 20/20 serial Chromium tests,
623 tracked files scanned for secrets/environment leakage, zero dependency vulnerabilities, fail-closed
production and staging readiness, and a clean tree at entry and exit. The image
`genbridge-governance:phase15a-local` ran non-root and passed liveness without production data.

An earlier complete-gate attempt was excluded from the consecutive count after the unit/integration step
exited 1 under full-gate load. Its immediate standalone rerun passed all 858 tests without a code change;
the final count was restarted and both gates above then passed. Known non-failing output remains BUG-010's
upstream Prisma PostgreSQL adapter warning plus browser-server listener/MediaPipe diagnostics; none affected
assertions or data correctness.

# Phase 16A mobile verification scope

`MOBILE_TESTING.md` records focused commands and native limitations. `npm run mobile:test` runs 5 files / 13 tests; Playwright adds 4 rendered Capacitor-web journeys for guard success, guard exception, owner approval and security/responsive/connectivity boundaries at 360×640, 430×932, 844×390, 768×1024 and 1024×768. Mobile TypeScript, lint, config and export are independent gates.

`npm run mobile:rc` includes established web/backend coverage, 30-migration replay/restore, build, pilot/UAT/tracker checks, all Playwright, audit/secret/package checks, expected blocked production/staging readiness, performance and non-root Docker liveness. No native emulator/simulator/device result is claimed.

Two consecutive stable gates passed at `d9276d3`: Gate A 20.3 minutes and Gate B 14.8 minutes. Each
reported 86 Vitest files / 871 tests, 112 generated pages/routes, 25/25 tracker conformance checks, 24/24
Playwright tests, zero audit findings and a clean source tree. The established visible listener/MediaPipe
diagnostics did not affect assertions. The earlier 29/30 candidate exposed and fixed MOBILE-DEF-004 and is
not counted.

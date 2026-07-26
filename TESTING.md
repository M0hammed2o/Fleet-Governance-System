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

## Running tests locally
1. `docker compose up -d` (Postgres must be running; also used for the test DB, same container).
2. `npm test` — the `pretest` npm hook (`scripts/test-db-setup.mjs`) loads `.env.test` and runs
   `prisma migrate deploy` against `gate_fleet_governance_test` before Vitest runs, so migrations never
   need to be applied by hand for testing.
3. `npm run e2e` — Playwright; no specs exist yet (Phase 1 only has login/dashboard), config is wired for
   when Phase 3 gate-operations e2e specs land.

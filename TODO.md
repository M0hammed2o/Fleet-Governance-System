# TODO.md

## Now
Phase 8 (Pilot Hardening, Cost-Efficient Evidence Storage and Retention Management) is **complete** —
8A-8E all done, see WORKLOG.md Sessions 13-17. Phase 9 (on-device one-to-one facial verification and
basic liveness with a cloud fallback interface) is also **complete** — see WORKLOG.md Session 18. Next
planned work, when the user is ready to scope it: subscription billing, full investigation-case
management, and a production hosting/scheduler/vendor decision (see "Blocked" below — several items now
depend on the same underlying hosting choice).

Phases 5B/5C/6/7 (an earlier run's full scope) are **all complete** — see the Revised build order below and
WORKLOG.md Sessions 9-12. Per that same instruction, this remains the deliberate stopping point for that
scope: **subscription billing and the full Investigation Case Management module are explicitly not
started.** Next planned work, when the user is ready to scope it:
- Subscription billing — real payment/invoicing integration (`Tenant.subscriptionStatus`, added Phase 7,
  is a manually-set placeholder flag only, not a billing system — see DECISIONS.md D-021's sibling
  reasoning on scope boundaries).
- Full investigation-case management — case creation, findings, disposition tracking. External Reviewer /
  Internal Investigator profiles already exist for evidence access (Phase 5A), but no case-management
  module itself.
Also still open, not part of either of the above: production hosting/deployment target (Unresolved
questions #3, PRODUCT_REQUIREMENTS.md), facial-verification and telematics production vendor selection
(both blocked on the user's decision).

## Revised build order (2026-07-23, per user instruction — target: October 2026 pilot)
Phase 5A (role realignment) — **done**, see WORKLOG.md Session 7. Phase 5B (Reconciliation) — **done**, see
WORKLOG.md Session 9 / DECISIONS.md D-017/D-018. Phase 5C (Dispatch workflow enhancements) — **done**, see
WORKLOG.md Session 10. Phase 6 (Telematics foundation + basic geofencing) — **done**, see WORKLOG.md
Session 11 / DECISIONS.md D-019/D-020. Phase 7 (Platform support-access view) — **done**, see WORKLOG.md
Session 12 / DECISIONS.md D-021. This was the full scope of the current build run — subscription billing
and full investigation-case management are explicitly out of scope, next planned work whenever the user
wants to scope that separately. Full requirement detail in PRODUCT_REQUIREMENTS.md.

## Next
- [ ] Driver-portrait and compliance-document-attachment upload UI — both are fully wired end-to-end at the
      API layer (`PATCH /api/drivers/[id]` with `portraitMediaAssetId`, `POST
      /api/compliance-documents/[id]/attachment`) and curl-verified, but there's no admin-page form yet
      (only the gate check-in inspection-evidence upload got a UI affordance in Phase 4, per the brief's
      explicit scope — see DECISIONS.md D-012) | Priority: medium | Deps: none
- [ ] Extend audit-on-read beyond MediaAsset to other Restricted-classified reads (e.g. viewing a Driver's
      licence/PDP detail) — SECURITY_AND_POPIA.md flags this as a general target; Phase 4 only closed the
      gap for media (DECISIONS.md D-014) | Priority: low | Deps: none
- [ ] Gate check-in UI polish: the guided-inspection page (`/gate/events/[id]`) is functionally complete (every state, every action, including Phase 4's per-item evidence upload) but has no dedicated Playwright e2e spec yet — `playwright.config.ts` has been wired since Phase 1 for exactly this and still has zero specs; worth adding one full-lifecycle spec now that a stable UI exists to drive | Priority: medium | Deps: none
- [ ] Inspection template admin UI — API routes exist and are tested (`/api/admin/inspection-templates`, `.../new-version`) but there's no admin page yet to create/version templates or manage the `ExceptionType` catalogue (`/api/admin/exception-types`); currently only usable via curl/API or the one seeded default template | Priority: medium | Deps: none
- [ ] Vehicle create/edit UI: tyrePositionConfigId picker and inline tyre (VehicleTyre) editing on the vehicle detail page — API routes already exist and are tested (`POST /api/vehicles/[id]/tyres`), just no UI affordance yet | Priority: low | Deps: none
- [x] ~~Per-trip distance accumulation for the vehicle-use-policy km-limit check~~ — done, Phase 8A (HARD-005), see ARCHITECTURE.md "Real distance accumulation" and `lib/telematics/distance-engine.ts`.
- [ ] Manual GPS confirmation and geofences UI affordance on the vehicle detail page itself (currently reachable via `/admin/geofences`, `/admin/vehicle-use-policies`, and the API directly, but not from the vehicle detail page where a Fleet/GPS Manager would naturally look) | Priority: low | Deps: none
- [ ] Wire `SupportAccessSession.elevated` into an actual write path once a real "platform support needs to make an authorised change" use case is specified — today elevation only records audit intent (DECISIONS.md D-021); do not build a generic cross-cutting elevated-write mechanism speculatively, wire the *one* specific resource that needs it | Priority: low | Deps: a concrete authorised-change use case from the user
- [ ] SUPPORT-001's "failed integrations" health-summary field has no concrete signal to aggregate yet — no integration-attempt logging exists anywhere (facial-verification/telematics provider calls aren't logged as attempts, only their outcomes on the owning record); add one if/when a real production provider integration exists to actually fail | Priority: low | Deps: a production provider (currently blocked)
- [ ] MediaAsset retention-purge / hard-delete mechanism (POPIA erasure) — no delete path exists yet for any owner kind; `StorageProvider.delete()` is implemented but unwired to any route | Priority: low | Deps: legal review of retention granularity (see existing "Retention-purge scheduled job" item below)
- [ ] FOUND-003 — Password reset flow | Priority: medium | Deps: none to build (dev-mode token-in-response, same pattern as invite), email provider only needed for production delivery | Design: SECURITY_AND_POPIA.md
- [ ] FOUND-010 — Reauthentication requirement for defined sensitive actions | Priority: low | Deps: first genuinely sensitive Phase 3+ action to attach it to (e.g. high-severity exception override) | Design: SECURITY_AND_POPIA.md
- [ ] SEC-2 — Add Postgres RLS as defense-in-depth on top of app-layer tenant scoping | Priority: medium | Deps: hosting decision
- [ ] Break-glass audited support-access mechanism for Platform Administrator (explicitly NOT granted by default — see DECISIONS.md D-005) | Priority: medium | Deps: none, but should land before any real customer tenant is onboarded
- [ ] Automated test asserting the audit_logs UPDATE/DELETE Postgres trigger actually fires (currently only manually verified via psql) | Priority: low | Deps: none
- [ ] Rate-limiting infrastructure (first real caller would be password-reset request endpoint once built) | Priority: low | Deps: none
- [ ] Scheduled job to auto-transition APPROVED movements past `expectedDepartureAt` to EXPIRED (repository function `expireMovement` exists and is tested; nothing calls it on a schedule yet) | Priority: low | Deps: none
- [ ] No self-service way to change `Tenant.timezone` from its seeded/schema default (`Africa/Johannesburg`) — the field is now genuinely used for vehicle-use-policy evaluation (Phase 8A, HARD-004), but there is no `tenant` permission resource or settings route/UI to update it; every tenant is evaluated against the default until one is added | Priority: low | Deps: none, deliberately not built speculatively — no route existed for any tenant self-service setting before this phase
- [ ] `TRIP_DISTANCE_LIMIT_EXCEEDED`'s trip-boundary definition (ignition-off→on transitions, D-023) has not been validated against a real telematics vendor's actual ignition-signal reliability — only the mock provider, which always reports it | Priority: low | Deps: a production telematics provider (currently blocked, GPS-BLOCKED)
- [ ] Real video compression (H.264/MP4 transcoding to the 720p/24-30fps/30-60s policy already defined in `lib/storage/video-compression.ts`) — currently a documented passthrough (D-024); needs ffmpeg or an equivalent installed and verified in this environment | Priority: medium | Deps: none, but must be verified end-to-end before claiming it works, not just installed
- [ ] Most existing `uploadMediaAsset()` call sites (gate inspection evidence, manual facial-verification fallback evidence, compliance-document attachments, movement documents — everything predating Phase 8B) still default to `category: OTHER_DOCUMENT` rather than passing a real category (D-025) — update each capture-point's call site to pass an appropriate category as those pages are next revisited | Priority: medium | Deps: none
- [x] ~~No admin UI to browse/act on `MediaAsset.uploadStatus`~~ — `cleanupFailedUploads()` is now wired as a callable, idempotent background job (`media.cleanupFailedUploads`, Phase 8E-004) with its own JobRun bookkeeping; still no dedicated "browse failed uploads" list page, only the job itself — that narrower UI gap remains, low priority.
- [x] ~~No admin UI for the Phase 8C retention/deletion/export/archive workflows~~ — done, Phase 8E-005 (`/admin/retention`): policies, evidence browsing, legal/investigation holds, retention extension, archive selection, export requests, dual-control deletion requests (create/approve/reject/cancel/complete), recovery-period status, deletion certificates. Live-verified via Playwright (`e2e/retention-management.spec.ts`).
- [x] ~~`completeDeletionRequest()`/`completeDueDeletionRequests()` and `cleanupFailedUploads()` are not wired to any scheduler~~ — a real job architecture now exists (Phase 8E-004: `lib/jobs/`, `src/app/api/jobs/*`, `npm run job`), with JobRun bookkeeping, a hard per-job-name concurrency guarantee (partial unique index), and a documented service-token scheduler boundary (`JOB_SCHEDULER_TOKEN`). **Still open:** no actual production scheduler (cron/queue) is configured to call these endpoints on a timer — see new item below.
- [ ] Deletion eligibility only checks legal hold, investigation hold, and an unresolved linked Exception — the brief's "insurance claim, dispute, or open audit" conditions have no corresponding data model in this codebase (MVP_SCOPE.md explicitly scopes full investigation-case management out) and are not enforced (D-025's sibling gap, lib/retention/deletion-rules.ts) | Priority: medium | Deps: an investigation-case/claims data model, out of scope for this run
- [ ] `serveRawMediaAsset()`/`mintSignedUrlForMediaAsset()` do not yet check `MediaAsset.binaryDeletedAt` before attempting a read — a deleted asset's storage key simply 404s at the provider level today rather than a purpose-built "this evidence was permanently deleted on [date]" response (D-027) | Priority: low | Deps: none, add when a UI surfaces a "view" action for a deleted/archived asset
- [x] ~~The shared test-Postgres database has accumulated well over 1,000 fixture tenants across every session~~ — fixed, Phase 8E-007: deterministic per-test-file cleanup (`tests/setup/global-cleanup.ts`, a Vitest `setupFile`) plus a one-time backlog cleanup (4,461 stale tenants removed). Tenant count now confirmed to hold at exactly 1 (the canonical "platform" tenant) across repeated full-suite runs. One pre-existing, disclosed, low-severity intermittent flake remains in `reconciliation-repository.test.ts` under full-suite parallel load — see KNOWN_BUGS.md, unrelated to this fix.
- [ ] "Monthly storage growth" on the Phase 8D dashboards is an approximation (last-30-days vs prior-30-days upload bytes from `MediaAsset.capturedAt`), not a true historical ledger — no `StorageUsageSnapshot`-style time-series table exists | Priority: low | Deps: none, build one if the pilot customer needs real historical trend charts, not just a point-in-time indicator
- [ ] No production scheduler (cron/queue) is actually configured to call the Phase 8E-004 job endpoints (`src/app/api/jobs/*`) on a timer — the endpoints, service-token auth, CLI (`npm run job`), concurrency protection, and JobRun audit trail all exist and are tested/live-verified, but nothing invokes them periodically yet | Priority: medium | Deps: a hosting/scheduler decision (blocked, see "Blocked" below)
- [ ] `RetentionNotificationProvider` has no real email/SMS implementation — only `DevConsoleRetentionNotificationProvider` (logs) and `NoOpRetentionNotificationProvider` exist (Phase 8E-003); every 90/60/30/7/0-day retention notice is generated and "delivered" (idempotently, with retry-on-failure) but never actually reaches a customer inbox | Priority: medium | Deps: an email/SMS vendor selection (none chosen, no paid account created)
- [ ] Real video compression (H.264/MP4 transcoding to the 720p/24-30fps/30-60s policy) is still a documented server-side passthrough (D-024) — Phase 8E-006 added real client-side capture *restrictions* (720p/24-30fps target, configurable 30-60s max with countdown/auto-stop, configurable bitrate, live size estimate, policy rejection, honest actual-codec/resolution/duration/bitrate/size metadata) via the browser's native MediaRecorder, but no server-side transcoder exists in this environment | Priority: medium | Deps: ffmpeg (or equivalent) installed and verified end-to-end, not just installed
- [ ] `e2e/video-capture-smoke.spec.ts` (Phase 8E-006 live verification) is flaky when run alongside other e2e specs or on repeat — it depends on a specific seeded gate event being in `VEHICLE_CHECKS_IN_PROGRESS` status, and the dev-seeded gate events' ordering from `GET /api/gate/gate-events` was observed to vary between runs; it correctly `test.skip()`s rather than false-failing when that precondition isn't met, but is not yet a fully deterministic test | Priority: low | Deps: a dedicated e2e fixture (a freshly created, driven-to-VEHICLE_CHECKS_IN_PROGRESS gate event per test run) instead of relying on seed-data state
- [ ] `e2e/facial-verification-gate-smoke.spec.ts` (Phase 9 live verification) has the same seed-data-ordering dependency/flakiness as the video-capture one above, and for the same reason — same fix applies to both once built | Priority: low | Deps: same dedicated e2e fixture item above
- [ ] Face-recognition accuracy without face-api.js's own alignment step is not benchmarked in this codebase — Phase 9B deliberately skips face-api.js's 68-point-landmark alignment (its training data excludes commercial use, FACIAL_VERIFICATION_LICENSING.md) and computes the descriptor from an unaligned MediaPipe-located crop instead; the dlib project's own 99.38% LFW accuracy figure assumes its own alignment pipeline, which this codebase does not replicate — real-world match-rate impact is unverified with actual driver photos | Priority: medium | Deps: real pilot enrolment data to benchmark against, or accept the disclosed trade-off
- [ ] `GateFacialVerification` doesn't yet distinguish "camera permission denied" from "on-device model failed to load" when reporting to the server — the repository layer now supports an explicit `providerUnavailable` signal distinct from `CAPTURE_FAILED` (Phase 9I tested directly via the API), but the browser component's own error-handling path doesn't yet set it automatically | Priority: low | Deps: none, straightforward follow-up wiring
- [ ] `@vladmandic/face-api`'s GitHub repository is archived (no longer maintained, per the author's own notes) — the MIT licence and CC0-equivalent model weights remain fully valid and usable regardless (FACIAL_VERIFICATION_LICENSING.md), but no future security patches or TensorFlow.js compatibility updates will come from this exact package | Priority: medium | Deps: periodic re-evaluation of whether a newer, equally-clearly-licensed alternative has emerged

## Later
- [ ] Object-storage production vendor integration (interface + local-filesystem dev implementation already done, Phase 4) | Deps: vendor selection (blocked)
- [ ] Cloud liveness fallback production vendor integration (interface + honest no-op already done, Phase 9F) | Deps: vendor selection (blocked) — the on-device recognition/liveness pipeline itself needs no vendor and is already real, not blocked
- [ ] GOV-001..003 — Governance module | Deps: none (can start once Foundation is stable)
- [ ] Retention-purge scheduled job honouring `Tenant.retentionDays` | Deps: legal review of retention granularity
- [ ] MFA (TOTP) enrolment/verification | Deps: none — schema already ready (`User.mfaEnabled`/`mfaSecret`)
- [ ] Promote `Driver.department` from a plain string to a real Department entity if department-level reporting/permissions are ever needed (D-006) | Deps: none, only if requested

## Blocked
- [ ] Cloud liveness fallback production provider selection (optional additional layer on top of the already-working on-device pipeline) | Needs: user decision on vendor + budget approval
- [ ] Telematics production provider selection | Needs: user decision on vendor + budget approval
- [ ] Production hosting/deployment | Needs: user decision on Supabase vs self-managed, paid-service approval
- [ ] Production scheduler/cron for the Phase 8E-004 background jobs | Needs: hosting decision (above) — the job endpoints, auth boundary, and CLI are ready for whichever scheduler the hosting choice implies
- [ ] Retention-notification email/SMS provider | Needs: user decision on vendor + budget approval

## Completed recently
- [x] Phase 9: On-device one-to-one facial verification and basic liveness (FACE-001..009) — commercial
      licensing independently verified against primary sources *before* any model was added
      (`FACIAL_VERIFICATION_LICENSING.md`): `@mediapipe/tasks-vision` (Apache-2.0) for detection/landmarks/
      liveness geometry, `@vladmandic/face-api`'s `faceRecognitionNet` only (MIT wrapper, CC0-equivalent
      dlib-derived model weights) for the recognition descriptor — one candidate model (face-api.js's own
      68-point landmark model, non-commercial training data) and one alternative library (`@vladmandic/human`,
      unclear per-model licensing) were evaluated and explicitly not used, disclosed as blockers rather than
      shipped unclear. Driver biometric enrolment (3-5 guided captures, quality-checked, AES-256-GCM
      encrypted template, key outside the database, restricted-role gated, re-enrolment/revocation, full
      audit history, `DriverFacialTemplate` with a hard one-ACTIVE-per-driver database constraint); real
      one-to-one matching (`runOnDeviceFacialVerificationAttempt()`) against exactly the driver assigned to
      a gate event's own approved movement, never a global search, recording a full `FacialVerificationAttempt`
      audit trail (MATCH/NO_MATCH/REVIEW_REQUIRED/NOT_ENROLLED/CAPTURE_FAILED/LIVENESS_FAILED/
      PROVIDER_UNAVAILABLE) for every attempt; basic active liveness (blink/turn/move-closer) that a single
      still photo can never complete, honestly documented as not a commercial-grade anti-spoofing product;
      a `CloudLivenessProvider` interface with an honest no-op (no paid vendor) and per-tenant usage
      tracking for future billing; server-side rate limiting on verification attempts (5 per gate event per
      5 minutes); a gate-tablet interface with large, simple states and no raw confidence score shown. 605/605
      tests passing (66 net new), tsc/lint/build clean, clean-migration verification passing (1 new
      migration), two consecutive clean full-suite runs, tenant count confirmed to hold at exactly 1. Found
      and fixed one high-severity bug via live browser verification (a browser-only ML library crashing on
      Next.js's server-render pass — see KNOWN_BUGS.md BUG-008). Live Playwright verification: two specs
      proving the real MediaPipe/face-api model-loading and per-frame-detection pipeline genuinely works in
      a live browser (`e2e/facial-verification-smoke.spec.ts`, `e2e/facial-verification-gate-smoke.spec.ts`),
      plus a full six-role-login workflow spec (`e2e/facial-verification-workflow.spec.ts`) exercising every
      required result outcome, the manual-fallback path, audit-trail permission boundaries, and cross-tenant
      denial — using only synthetic, non-biometric descriptor arrays, never real captured face data —
      2026-07-27. **This completes Phase 9.**
- [x] Phase 8E: Retention operationalisation and corrections (8E-001..007) — automatic `scheduledDeletionAt`
      assignment on every new MediaAsset reaching READY (direct and presigned-upload paths), plus a safe,
      idempotent, forward-only backfill for pre-existing ACTIVE assets (`retentionExtendedAt` marker added
      so a human's explicit extension is never overwritten); fixed a real zero-byte archive-billing defect
      (a tenant with nothing archived was quoted the lowest paid tier's price instead of R0) and a related
      1TB-boundary tier-selection bug (`archive-pricing.ts`); `RetentionNotificationRecord` with a hard
      per-(asset, milestone, scheduledDeletionAt) uniqueness constraint plus a provider-neutral
      `RetentionNotificationProvider` (dev-console/no-op; no paid vendor); a full background-job
      architecture (`lib/jobs/`, `JobRun` bookkeeping, a hard partial-unique-index concurrency guarantee,
      dual auth — service token or Platform Administrator session — `npm run job` CLI) covering
      notification generation/delivery, due-deletion completion, failed-upload cleanup, export-link expiry,
      archive-usage reporting, support-session expiry, and storage-summary recalculation; a full retention
      management UI (`/admin/retention`) covering policies, evidence browsing, holds, extensions, archive
      selection, export/deletion requests, dual-control approval, recovery status, and certificates;
      browser video-capture cost controls (`VideoCaptureRecorder`, native MediaRecorder — 720p/24-30fps
      target, configurable 30-60s max with countdown/auto-stop, configurable bitrate, live size estimate,
      policy rejection, honest actual-codec/resolution/duration/bitrate/size metadata, never claims
      transcoding that didn't happen) wired into the gate inspection evidence flow; deterministic
      per-test-file database cleanup fixing unbounded fixture-tenant growth across repeated test runs
      (4,461-row one-time backlog cleanup). 539/539 tests passing (53 net new), tsc/lint/build clean, clean-
      migration verification passing (3 new migrations), two consecutive clean full-suite runs, tenant count
      confirmed to hold at exactly 1 across repeated runs, live Playwright browser verification of the
      dual-control deletion-approval workflow through the real UI and a real second user session, and a live
      Playwright fake-camera-device browser test of the video-capture component that caught and fixed a real
      bug (a hard `frameRate: { min }` getUserMedia constraint threw `OverconstrainedError` and refused to
      open the camera on devices that couldn't guarantee it; fixed to use `ideal`) — 2026-07-27. **This
      completes Phase 8.**
- [x] Phase 8D: Platform and customer storage dashboards (DASH-001..003) — real DB-backed aggregate
      dashboards computed via a fixed, batched set of `groupBy` queries across every tenant at once (never
      a per-tenant loop, directly applying the BUG-004 lesson); platform-admin view across every customer
      tenant (`platformTenant:VIEW`-gated) and a customer-admin view scoped to the caller's own tenant
      (`retention:VIEW`-gated); both read-only, no new elevation path, Phase 7's `SupportAccessSession`
      boundary unchanged. Found and fixed BUG-005 via live verification: "current storage" was counting a
      permanently-deleted asset's bytes because the aggregate only checked `uploadStatus`, not
      `retentionStatus` — fixed, with two regression tests. 486/486 tests passing (8 new), tsc/lint/build
      clean, clean-migration verification passing, full live curl verification of both dashboards including
      the bug-fix confirmation and role-based access denial — 2026-07-26. **This completes Phase 8.**
- [x] Phase 8C: Retention, archive and deletion (RETAIN-001..010) — per-category `RetentionPolicy`
      (12-month rolling default, overridable), replacing the never-enforced single tenant-wide
      `Tenant.retentionDays` (removed); legal-hold/investigation-hold hard blockers plus a best-effort
      unresolved-linked-exception check; a dual-control `DeletionRequest` workflow (Company Administrator
      initiates, a different authorised user approves, eligibility re-checked at creation/approval/
      completion) with a configurable 30-day recovery window before permanent deletion; an immutable
      `DeletionCertificate` with a checksum manifest issued on completion, the `MediaAsset` metadata row
      itself always surviving as the historical record (D-027); an `ExportRequest` workflow producing a
      signed per-file manifest (D-026); retention extension and paid-archive workflows; a
      `StorageBillingHookProvider` interface (no-op, no billing vendor chosen) and the specified
      ZAR-excl-VAT archive pricing configuration; retention-expiry milestone computation for 90/60/30/7/0
      days (no real notification delivery — no provider exists). 478/478 tests passing (35 net new),
      tsc/lint/build clean, clean-migration verification passing, full live curl verification of the
      legal-hold-prevention → dual-approval → recovery-window → permanent-deletion → certificate lifecycle
      and the export-request workflow against a running dev server — 2026-07-26.
- [x] Phase 8B: Cost-efficient object-storage architecture (MEDIA-001..012) — `ObjectStorageProvider`
      interface extended with presigned upload/confirm; `R2CompatibleStorageProvider` (real
      `@aws-sdk/client-s3` client, blocked — no Cloudflare account); ten `MediaCategory` values with
      per-category compression-profile/original-retention/retention-category rules; real image compression
      (WebP, ≤1920px, 75-82% quality via `sharp`) with checksum computed on the final compressed bytes, not
      the client's original; thumbnails; video-compression policy + interface defined but shipped as a
      documented passthrough (D-024, real transcoding needs ffmpeg, not installed); upload-status lifecycle
      (PENDING→PROCESSING→READY/FAILED); failed-upload cleanup; per-tenant/per-category storage usage
      accounting — 443/443 tests passing (27 net new over Phase 8A's 416, including a full rewrite of the
      19 media-asset-repository cases for the new compression pipeline),
      tsc/lint/build clean, clean-migration verification passing, full live curl verification of the
      multipart-upload-with-compression path and the complete presigned-upload lifecycle — 2026-07-26.
- [x] Phase 8A: Engineering hardening (HARD-001..006) — clean-database migration verification
      (`npm run verify:clean-migrations`); root-caused and fixed the Postgres concurrent-query deprecation
      warning's real underlying defect (`getCustomerHealthSummaries()`'s unbounded per-tenant query fan-out,
      BUG-004 in KNOWN_BUGS.md — was causing genuine intermittent test timeouts, not just a cosmetic
      warning); replaced the obsolete `vite-tsconfig-paths` plugin with Vite's native
      `resolve.tsconfigPaths`; vehicle-use-policy day/hour/weekend evaluation now uses the tenant's IANA
      timezone (`Tenant.timezone`, a Phase 1 field that had sat unused) instead of the server clock; real
      per-trip/daily/weekly/monthly distance accumulation (`lib/telematics/distance-engine.ts`, pure,
      timezone-aware); GPS-exception deduplication with episode tracking, escalation after 3 consecutive
      re-observations, and automatic clearing on a return to compliance (`Exception.violationType`/
      `observationCount`/`lastObservedAt`, migration `20260726120000_phase8a_telematics_exception_dedup`) —
      416/416 tests passing (20 new), tsc/lint/build clean, full live curl verification of the dedup/
      escalate/clear lifecycle against a running dev server — 2026-07-26.
- [x] Phase 7: Platform support-access view (SUPPORT-001..004) — `getCustomerHealthSummaries()` (real
      aggregate counts, gated by existing `platformTenant:VIEW`), `SupportAccessSession` (60-minute TTL,
      mandatory reason, fully audited), a new "Platform Support Analyst" role (D-016) alongside Platform
      Administrator, `getSupportViewForCustomer()` (bounded read-only summary, requires an active session,
      tenant-isolated), immediate-exit and explicit-elevation actions (elevation records audit intent only —
      see D-021's documented scope boundary), platform customer-list and support-view UI with a visible
      banner — 396/396 tests passing (22 new), tsc/lint/build clean, full live curl verification incl. the
      complete session lifecycle and the platform/customer permission boundary — 2026-07-24. **This was the
      last phase of the current build run per the user's instruction — see "Now" above.**
- [x] Phase 6: Telematics foundation, basic geofencing, vehicle-use policies (GPS-001..006/GPS-BLOCKED,
      POLICY-001/002) — `TelematicsProvider`/`MockTelematicsProvider` (provider-neutral, GPS-BLOCKED
      recorded), `ManualGpsConfirmation` (mirrors facial-verification fallback), `Geofence` (simple
      circle), `VehicleUsePolicy`/`VehicleUsePolicyVehicle` (full POLICY-001 field list), pure
      `geofence-engine.ts` compliance evaluation, `Exception.gateEventId` made nullable +
      `Exception.vehicleId` added so telematics/policy violations reuse the same Exception table/workflow
      (D-020) — 374/374 tests passing (41 new), tsc/lint/build clean, live curl verification incl. a real
      geofence-violation Exception raised end-to-end and a provider-unavailable 503 (not a raw 500) —
      2026-07-24
- [x] Phase 5C: Dispatch workflow enhancements (DISPATCH-001..005) — `MovementType` extended
      (SALES_VISIT/SERVICE/AUTHORISED_PRIVATE_USE), sender/recipient fields, `MOVEMENT_DOCUMENT` MediaAsset
      owner type reusing the existing upload/signed-URL routes unchanged, plain nullable
      `vehicleUsePolicyId` (upgraded to a real FK once VehicleUsePolicy exists in Phase 6), dispatch UI
      improvements (movements list create form + detail-page document upload/list, no separate screen) —
      333/333 tests passing (11 new), tsc/lint/build clean, live curl verification incl. the
      mediaAsset:VIEW visibility boundary (Executive Read-Only Viewer sees zero documents) — 2026-07-24
- [x] Phase 5B: Reconciliation (RECON-001..003) — `Reconciliation`/`ReconciliationDiscrepancy` models,
      chronological (not hardcoded-direction) departure/return pairing with duplicate/reversed/mismatched
      protection (DECISIONS.md D-017), pure discrepancy-comparison engine generic over the existing
      InspectionSection/unit taxonomy, HIGH discrepancies raise a real Phase 3 Exception (D-018), mandatory-
      explanation resolve workflow, reconciliation list/detail admin UI, auto-build wired into
      `completeGateEvent`, manual retry API — 322/322 tests passing (28 new), tsc/lint/build clean, full
      live curl verification incl. two-different-gates pairing, wrong-role/missing-explanation/already-
      resolved/suspended-user 4xx paths (no 500s) — 2026-07-24
- [x] Phase 5A: remapped the 8 seeded roles onto 9 (six primary customer roles + three additional
      profiles, DECISIONS.md D-015) — `prisma/seed.ts` TENANT_ROLE_DEFINITIONS rewritten, fictional demo
      users/emails updated, local dev DB dropped/recreated to clear orphaned old-role rows, 8 new
      segregation-of-duties tests (`tests/role-segregation.test.ts`), live curl regression check that
      Fleet and GPS Manager (ex-"Fleet Manager") can no longer create movements — 294/294 tests passing,
      tsc/lint/build clean — 2026-07-23
- [x] Recovery checkpoint: completed the interrupted Phase 4 independent verification (corrected
      `checksumSha256` column name, confirmed file/checksum match, full tsc/lint/test/build re-run) and
      created the repository's first two Git commits (`c5e5d33` baseline, `7e2a455` docs) — the repo had
      zero commits despite four completed phases — 2026-07-23
- [x] Phase 4: MediaAsset model (polymorphic ownerType/ownerId, DECISIONS.md D-011), StorageProvider
      interface + local-filesystem dev implementation, HMAC-signed time-limited read URLs
      (`lib/storage/signed-url.ts`), secure upload endpoint with server-side file-type/size validation and
      server-computed SHA-256 checksums, idempotency-key retry protection (EVID-003), `mediaAsset`
      permission resource with a differentiated 8-role matrix, audit-on-read at signed-URL-mint time
      (DECISIONS.md D-014) — 2026-07-22
- [x] Phase 4: all four dev-mode placeholder evidence fields upgraded to real MediaAsset-backed uploads —
      `GateEventInspectionItem.evidenceRef`, `ManualFacialVerificationFallback.evidenceRef`,
      `Driver.portraitUrl`, `ComplianceDocument.attachmentUrl` (DECISIONS.md D-012); gate check-in UI
      (`/gate/events/[id]`) gained a real file-input upload affordance per inspection item — 2026-07-22
- [x] Phase 4: 1 migration (`20260722090000_phase4_media_assets`), 27 new automated tests (7 signed-url
      unit cases, 15 media-asset-repository cases, 5 media-tenant-isolation cases) — 286/286 total
      passing — 2026-07-22
- [x] Phase 4: full live curl verification — secure upload, unauthorised-role block (403), signed-URL
      mint+serve returning exact original bytes, tampered-signature rejection (403), expired-URL rejection
      (410), direct filesystem-style path not served (404), cross-tenant signed-URL-mint block (403),
      idempotent retry (same MediaAsset id, confirmed 1 DB row), three deliberate precondition-violation
      paths all returning typed 4xx (not 500) — 2026-07-22
- [x] Independent re-verification of the Phase 3 work (delegated agent stalled before it could report
      back) + found and fixed BUG-003 (5 untyped Error throws in gate-event-repository.ts → 500 instead
      of 409/404) + 4 regression tests — 259/259 passing — 2026-07-22
- [x] Phase 3: GateEvent state machine (11 states, own pure transition table), configurable
      InspectionTemplate/InspectionItem engine with immutable-row versioning, GateEventInspectionItem
      results recording with automatic exception raising on FAIL, ExceptionType tenant-configurable
      catalogue + Exception raise/escalate/resolve workflow with a hard (non-tenant-configurable)
      self-approval rule, driver identity verification wired into the gate flow (mock provider + manual
      fallback), real DB-backed security dashboard, tablet-friendly gate check-in/check-out UI
      (`/gate` → `/gate/events/[id]`) — 2026-07-21
- [x] Phase 3: 1 migration (`20260721160000_phase3_gate_operations`), permission catalogue extended
      (`gateEvent`, `inspectionTemplate`, `exception`), all 8 tenant roles' permission matrix updated with
      a deliberately differentiated slice (Gate Security Officer: raise exceptions but not resolve;
      Security Manager: resolve but didn't raise — mirrors the movement CREATE/APPROVE separation
      pattern) — 2026-07-21
- [x] Phase 3: 159 new automated tests (134 state-machine matrix cases, 19 gate-event-repository cases,
      2 tenant-isolation cases, 4 inspection-template-versioning cases) — 255/255 total passing — 2026-07-21
- [x] Phase 3: full live curl verification of the entire gate lifecycle across 5 roles, including the
      self-approval-block, escalation-required, duplicate-gate-event-idempotency, and vehicle-lockout
      defense-in-depth checks — 2026-07-21
- [x] MD-004 finish — expiring-documents now surfaced on the Phase 3 security dashboard — 2026-07-21
- [x] Phase 2: organisation/site/gate admin UI, driver register, vehicle register (server-side VIN/
      registration uniqueness), compliance documents + tenant-configurable expiry rules, tyre-position
      configuration, movement authorisation with full approval state machine, gate-facing read-only
      lookup, facial-verification interface + mock provider + manual fallback — 2026-07-21
- [x] Phase 2: 51 new automated tests across 7 files (state machine, eligibility, self-approval,
      cross-tenant isolation, VIN/registration uniqueness, document expiry, gate lookup/authorization,
      facial-verification fallback) — 96/96 total passing — 2026-07-21
- [x] Phase 2: full live curl verification of create→submit→approve movement lifecycle, locked-vehicle
      rejection, self-approval rejection, gate officer search + forbidden-to-modify — 2026-07-21
- [x] Phase 1 security closure: user invitation workflow (invite/accept, dev-mode link since no email provider) — 2026-07-20
- [x] Phase 1 security closure: account suspension/reactivation, existing sessions revoked on suspend — 2026-07-20
- [x] Phase 1 security closure: session-expiry unit tests + suspension-revokes-sessions integration test — 2026-07-20
- [x] Phase 1 security closure: extra cross-tenant-admin-access tests via real site/gate/user repositories — 2026-07-20
- [x] Phase 1 security closure: Platform Administrator narrowed to an explicit, audited `platformTenant` permission (D-005) — 2026-07-20
- [x] Phase 1 security closure: seed script refuses to run outside localhost / with NODE_ENV=production — 2026-07-20
- [x] Phase 1 security closure: audit_logs append-only enforced at the Postgres level (trigger), not just convention — 2026-07-20
- [x] Phase 1 security closure: found and fixed BUG-001 (ForbiddenError → 500 instead of 403) and BUG-002 (login/accept-invitation didn't check tenant status) — 2026-07-20, see KNOWN_BUGS.md
- [x] Password-reset and reauthentication designs documented (D-004), deliberately not built yet — 2026-07-20
- [x] Project memory documentation set created — 2026-07-19
- [x] Dedicated git repo initialised at project root — 2026-07-19
- [x] Next.js 16 + TS strict + Tailwind app scaffolded, builds clean — 2026-07-19
- [x] Prisma schema + migrations (Tenant/Site/Gate/User/Role/Permission/RolePermission/
      UserPermissionOverride/Session/ApprovalDelegation/AuditLog) against local Docker Postgres — 2026-07-19
- [x] Auth foundation: bcrypt password hashing, DB-backed hashed-token sessions, permission evaluation
      (role/override/delegation), audit logging on login/logout — 2026-07-19
- [x] Seed script: platform tenant + demo tenant with 8 roles and one fictional user each — 2026-07-19
- [x] Manual end-to-end verification of login/logout/session-expiry/audit-logging via curl — 2026-07-19

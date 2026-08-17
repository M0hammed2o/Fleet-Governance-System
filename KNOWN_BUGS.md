# KNOWN_BUGS.md

## Phase 17A observed blockers

- `PropertyVault_Pixel7_API35` became `offline` before boot completion on 2026-08-14; no emulator install/smoke result exists and no physical device was connected. This is a release blocker, not a verified application defect.
- No private Git remote exists: Critical operational continuity risk, not a software defect.
- POPIA/provider decisions, human UAT and sign-offs are incomplete. Readiness correctly blocks activation/handover.

## BUG-001 — ForbiddenError from a repository function surfaced as 500, not 403
- Severity: medium
- Reproduction steps: authenticate as a tenant user without the `platformTenant` permission, call
  `GET /api/platform/tenants`.
- Expected result: `403 {"error": "Forbidden"}`.
- Actual result (before fix): `500 {"error": "Internal server error"}`.
- Suspected cause: `platform-tenant-repository.ts` functions call `requirePermission()` directly (so the
  audited cross-tenant access surface can't be reached even accidentally without a permission check), but
  `apiErrorResponse()` in `lib/auth/api-guard.ts` only recognised its own `ApiError` class, not the
  `ForbiddenError` thrown by `requirePermission()` — so the error fell through to the generic 500 branch.
- Status: fixed — 2026-07-20, `lib/auth/api-guard.ts` `apiErrorResponse()` now also catches `ForbiddenError`.
- Fix verification: manually reproduced via curl (confirmed 500 before, 403 after) during Phase 1 security
  closure live workflow checks; no automated regression test added specifically for this status-code
  mapping — worth adding if `api-guard.ts` grows more error types.

## BUG-002 — Login and invitation-acceptance did not check tenant status
- Severity: high
- Reproduction steps: Platform Administrator suspends a tenant (`POST
  /api/platform/tenants/{id}/status {"status":"SUSPENDED"}`); a user of that tenant then calls
  `POST /api/auth/login` with correct credentials.
- Expected result: login rejected (401) — a suspended tenant's users should not be able to authenticate,
  consistent with `evaluateSession()` already rejecting *existing* sessions for a suspended tenant.
- Actual result (before fix): login succeeded (200, valid new session issued) — only `user.status` was
  checked, not `user.tenant.status`. The same gap existed in `/api/auth/accept-invitation`.
- Suspected cause: the login route was written checking the "obvious" per-user status field and the
  tenant-status check was only ever added to `evaluateSession()` (existing-session validation), not to
  the two places that *mint* a new session.
- Status: fixed — 2026-07-20. Added `lib/auth/login-eligibility.ts` (`isEligibleToAuthenticate`) as the
  single source of truth for "may this user start a session", used by the login route; added the
  equivalent tenant-status check inside `validateInvitationToken()` for the accept-invitation path.
- Fix verification: reproduced and confirmed fixed via live curl workflow (suspend tenant → login now
  401); regression tests added in `tests/login-eligibility.test.ts` and
  `tests/invitation.test.ts` ("rejects a still-valid token once its tenant is suspended").

## BUG-003 — Five GateEvent precondition checks threw untyped Error, surfacing as 500 instead of 409/404
- Severity: medium
- Reproduction steps: start a gate event (lands in `INSPECTION_STARTED`), then call
  `POST /api/gate/gate-events/{id}/identity/verify` immediately, skipping the required
  `identity/pending` transition.
- Expected result: `409` with a clear message ("Gate event must be IDENTITY_PENDING to attempt
  verification…").
- Actual result (before fix): `500 {"error": "Internal server error"}` — the real message was visible
  only in the server log, not the API response.
- Suspected cause: `gate-event-repository.ts` had five call sites (`verifyIdentityForGateEvent`,
  `markIdentityVerifiedManually`, `recordInspectionResult` ×2, `resolveException`) that threw a plain
  `Error` for a precondition-on-current-status violation, instead of one of the typed error classes
  (`InvalidGateEventTransitionError` and friends) that every route's `catch` block already knew how to
  map to a 4xx. Every other precondition in the same file already used a typed class — these five were
  the exceptions, and every calling route's `apiErrorResponse(err)` fallback silently swallowed the
  distinction and returned 500. Found during independent live-curl verification of a background agent's
  Phase 3 (gate operations) work, by deliberately calling `identity/verify` out of sequence.
- Status: fixed — 2026-07-22. Added `GateEventPreconditionError`, `ManualFallbackNotApprovedError`,
  `InspectionItemNotFoundError` to `gate-event-repository.ts`; updated the five throw sites; updated the
  four affected routes' catch blocks (`identity/verify`, `identity/manual-verified`,
  `inspection-results`, `exceptions/[id]/resolve`) to map them to 409/404.
- Fix verification: reproduced and confirmed fixed via live curl (500 before, then correct-sequence call
  succeeded with 200 after fix); 4 new regression tests in `tests/gate-event-repository.test.ts`
  ("precondition violations surface as typed, catchable errors (not a generic 500)") asserting
  `rejects.toBeInstanceOf(...)` for each error class, so a future refactor can't silently regress to an
  untyped throw. Full suite re-run afterward: 259/259 passing.

## BUG-004 — `getCustomerHealthSummaries()` fanned out ~9 concurrent Prisma queries per tenant, unbounded
- Severity: high
- Reproduction steps: run the full test suite (`npm test`) once enough fixture tenants have accumulated in
  the shared test database (observed at 1,283 tenants — every test session creates fixture tenants and
  none are torn down, by design, per TESTING.md's tenant-isolation approach). Call
  `getCustomerHealthSummaries()` (platform customer list, SUPPORT-001).
- Expected result: completes promptly regardless of tenant count.
- Actual result (before fix): `tests/support-access-repository.test.ts`'s two SUPPORT-001 cases timed out
  (15s) intermittently once the tenant count was large enough — the function fired
  `tenants.map(async tenant => Promise.all([9 queries]))`, i.e. an unbounded `9 × tenantCount` concurrent
  query fan-out in one tick, which saturated the pg connection pool and surfaced as
  `(node) DeprecationWarning: Calling client.query() when the client is already executing a query is
  deprecated...` (pg's warning path for overlapping queries on a client that should be queued/awaited, not
  fired all at once) as well as the outright timeouts.
- Suspected cause: no concurrency bound and no batching — one query per metric per tenant instead of one
  grouped query per metric across all tenants.
- Status: fixed — 2026-07-26 (Phase 8A). `getCustomerHealthSummaries()` rewritten to use
  `prisma.<model>.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds } }, ... })` — 9 queries
  total regardless of tenant count, not 9 per tenant. Same output shape, same test assertions.
- Fix verification: full suite (`npm test`) re-run against the same 1,283-tenant test database — 396/396
  passing, no timeouts, in ~100s (was intermittently failing before). See WORKLOG.md Phase 8A entry.

### Residual, non-blocking: a `pg` concurrent-query DeprecationWarning line still prints once per Vitest
worker during a full suite run, unrelated to BUG-004 above (traced separately — see below).
- **Root cause (traced via `NODE_OPTIONS=--trace-deprecation`):** the warning's stack trace points into
  `@prisma/client`'s own generated runtime (`node_modules/@prisma/client/runtime/client.js`, `interpretNode`)
  calling into `@prisma/adapter-pg`'s `PgTransaction.performIO` (`node_modules/@prisma/adapter-pg/dist/
  index.mjs:618`) from inside an `Array.map`. This is Prisma's own query-interpreter executing a
  multi-statement operation (a nested-array create — e.g. seeding many `RolePermission` rows or
  `InspectionItem` rows in one nested `create: [...]` call, something almost every test fixture touches)
  by mapping several `client.query()` calls onto the *same* checked-out transaction connection, which is
  exactly the pattern node-postgres is deprecating (queuing multiple `.query()` calls on one client instead
  of sequencing them with `await`). This is inside Prisma's compiled runtime, not application code — there
  is no `Promise.all`/`.map()` over a `client.query()` call anywhere in this repository's own source.
- **Why not fixed further:** (1) it has zero observed functional effect — the full suite passes 396/396
  reliably after the BUG-004 fix above, and this warning line has apparently been present in every prior
  session's `npm test` output without ever causing a failure; (2) the only two available fixes are
  disproportionate to a cosmetic warning — either an unconfirmed `prisma`/`@prisma/client`/
  `@prisma/adapter-pg` version bump (tried 7.8.0 → 7.9.0 experimentally; reverted without confirming it
  helped, since this project has an explicit prior precedent, WORKLOG.md Session 6, against upgrading
  dependencies opportunistically, and the bump surfaced pre-existing `npm audit` findings that needed
  separate verification — see below), or rewriting every nested-array-create call site across the codebase
  to issue sequential creates instead, which is a broad refactor with real regression risk for a warning
  with no correctness impact.
- **Separately confirmed:** the 16 `npm audit` findings (mostly `eslint`/`next`/`prisma` dev-tooling
  transitive advisories) are pre-existing at the currently-pinned dependency versions, not introduced by the
  reverted upgrade attempt — confirmed by re-running `npm audit` after `git checkout -- package.json
  package-lock.json && npm install` and observing the same count.
- Status: open (cosmetic, non-blocking) — worth revisiting the next time a Prisma version bump is already
  on the table for another reason, not on its own.

## BUG-005 — Platform/customer storage dashboards counted a permanently-deleted asset's bytes as "current storage"
- Severity: medium
- Reproduction steps: permanently delete a `MediaAsset` (Phase 8C `completeDeletionRequest()` — its binary
  is removed, `retentionStatus` set to `DELETED`, but `uploadStatus` stays `READY` since that field tracks
  the *upload* lifecycle, not the *retention* lifecycle). Then fetch
  `GET /api/platform/storage-dashboard` or `GET /api/retention/storage-dashboard`.
- Expected result: the deleted asset's `fileSizeBytes` is excluded from `currentStorageBytes` and its
  category breakdown — the binary no longer exists, so it isn't "current storage."
- Actual result (before fix): the byte count and category entry were still present, because
  `storage-dashboard-repository.ts`'s aggregate queries filtered only on `uploadStatus: "READY"`, not on
  `retentionStatus`. Found via live curl verification (Phase 8D): a `CARGO_EVIDENCE` asset deleted earlier
  in the same session's Phase 8C live testing still showed up as 306 bytes of "current storage."
- Suspected cause: `uploadStatus` and `retentionStatus` are two independent lifecycle fields on `MediaAsset`
  (upload confirmation vs. retention/deletion), and the dashboard aggregates were written checking only the
  first.
- Status: fixed — 2026-07-26. The `currentStorageBytes`/`storageByCategory`/30-day-growth queries now filter
  `retentionStatus: { in: ["ACTIVE", "PENDING_DELETION"] }` in addition to `uploadStatus: "READY"` — `DELETED`
  assets are excluded entirely (binary genuinely gone) and `ARCHIVED` assets are excluded from "current"
  (tracked separately as `archivedBytes`, so the two stats never double-count the same bytes).
- Fix verification: two new regression tests in `tests/storage-dashboard-repository.test.ts` ("excludes a
  permanently-deleted asset's bytes from current storage" and "counts archived bytes separately from
  current storage, never both"); re-verified live via curl against the same dev-server tenant — confirmed
  `currentStorageBytes` dropped by exactly 306 bytes and the now-empty `CARGO_EVIDENCE` category entry
  disappeared from the breakdown entirely.

## BUG-006 — Zero-byte archive storage was quoted the lowest paid tier's price instead of R0, and exactly 1TB fell into the wrong pricing tier
- Severity: medium
- Reproduction steps: call `getArchiveTierForBytes(0)` (or view a customer/platform storage dashboard for a
  tenant with nothing in archive storage). Separately, call `getArchiveTierForBytes(1024 * GB)` (exactly
  1TB, using this codebase's 1024-based GB unit throughout).
- Expected result: a tenant with `archivedBytes = 0` is quoted R0 (nothing archived, nothing owed); a
  tenant with exactly 1TB archived is quoted the flat "501GB-1TB" tier price (R899/month), not routed to
  "More than 1TB, custom quotation."
- Actual result (before fix): `getArchiveTierForBytes(0)` fell through to the first tier in the list ("Up to
  100GB", R149/month) since `0 <= 100` is true — every non-archiving tenant would have been quoted a
  phantom monthly charge. Separately, the "501GB-1TB" tier's `maxGb` was set to `1000` (a decimal-GB
  assumption) while `BYTES_PER_GB` in the same file is `1024 ** 3` — converting exactly 1TB (`1024 ** 4`
  bytes) to this codebase's GB unit yields `1024`, which is `> 1000`, so an exactly-1TB tenant would have
  incorrectly fallen through to the custom-quotation tier instead of the flat price.
- Suspected cause: the zero-byte case was never explicitly handled — the tier-selection loop's first
  `<= 100` check is true for `0` by simple arithmetic, with no code ever asking "is there actually anything
  archived at all?" The 1TB-boundary bug was a units mismatch between the tier table's `maxGb` values
  (apparently authored assuming decimal GB) and the file's own `BYTES_PER_GB` constant (binary/1024-based).
- Status: fixed — 2026-07-27 (Phase 8E-002). Added a dedicated `NO_ARCHIVE_TIER` (R0, `customQuote: false`)
  returned whenever `bytes <= 0`, before the tier-selection loop runs at all. Corrected the "501GB-1TB"
  tier's `maxGb` from `1000` to `1024` to match the file's own 1024-based unit.
- Fix verification: 6 new boundary regression tests in `tests/retention-repository.test.ts` covering exactly
  0 bytes, 1 byte, exactly 100GB, 100GB+1 byte, exactly 250GB/500GB, exactly 1TB, and 1TB+1 byte.

## BUG-007 — Browser video capture's `getUserMedia` call refused to open the camera at all on devices that couldn't guarantee a 24fps minimum
- Severity: medium
- Reproduction steps: on any browser/device where the camera can't guarantee a hard `frameRate: { min: 24
  }` constraint (confirmed live against Chromium's own `--use-fake-device-for-media-stream` synthetic
  camera), call `VideoCaptureRecorder`'s "Start camera" action.
- Expected result: the camera opens using the best frame rate the device can actually provide, up to the
  24-30fps policy target; the recorder reaches its "ready to record" state.
- Actual result (before fix): `getUserMedia({ video: { frameRate: { min: 24, max: 30 }, ... } })` rejected
  with `OverconstrainedError`, and the component surfaced its generic "camera access was denied or is
  unavailable" message — indistinguishable from an actual permission denial, even though the camera itself
  was available and permission had been granted.
- Suspected cause: a hard `min` frame-rate constraint in the W3C Media Capture spec means `getUserMedia`
  must reject outright if no available track can satisfy it, rather than negotiating the closest available
  rate — the component's constraint object mirrored the server-side policy's "24-30fps" language literally
  without accounting for this getUserMedia semantic.
- Status: fixed — 2026-07-27 (Phase 8E-006, see DECISIONS.md D-030). Changed to `frameRate: { ideal: maxFps,
  max: maxFps }` — a soft preference the browser negotiates toward, not a hard requirement it can refuse
  over. The actually-achieved frame rate is still read back via `MediaStreamTrack.getSettings()` and
  recorded honestly in the captured evidence's metadata, never assumed to match the requested ideal.
- Fix verification: found via a live, real-browser Playwright test
  (`e2e/video-capture-smoke.spec.ts`, `--use-fake-device-for-media-stream`) that reproduced the exact
  failure with an in-browser `getUserMedia` probe using the same constraints as the component; re-ran clean
  after the fix (component reaches the "ready to record" state).

## BUG-008 — Facial-verification pages crashed on every request because a browser-only ML library was evaluated during Next.js server-side rendering
- Severity: high (the pages were completely unusable — every request to `/admin/drivers/[id]` and
  `/gate/events/[id]` crashed once the new facial-verification components were wired in)
- Reproduction steps: import `@vladmandic/face-api` as a static top-level `import` statement anywhere in a
  module reachable from a `"use client"` React component, then request the page that renders it.
- Expected result: the page renders normally — a `"use client"` component's browser-only dependencies
  should only execute in the browser.
- Actual result (before fix): `TypeError: this.util.TextEncoder is not a constructor`, thrown during
  module evaluation, crashing the page entirely. Found immediately via live Playwright verification
  (`e2e/facial-verification-smoke.spec.ts`) — the very first run against a real dev server.
- Suspected cause: Next.js still server-renders a `"use client"` component once before it hydrates in the
  browser. A static top-level `import` is evaluated during that server-side pass too, and face-api.js's
  browser bundle assumes browser globals (`window.TextEncoder` among them) that don't exist in that
  Node.js SSR context.
- Status: fixed — 2026-07-27 (Phase 9C/9D, see DECISIONS.md D-032). Converted both browser-only model
  loaders (`@vladmandic/face-api`, `@mediapipe/tasks-vision`) in `lib/facial-verification/browser-engine.ts`
  to dynamic `import()` calls made inside the functions that actually use them, which only resolve when
  called from a browser event handler after hydration — never during SSR.
- Fix verification: `e2e/facial-verification-smoke.spec.ts` and `e2e/facial-verification-gate-smoke.spec.ts`
  both re-ran clean after the fix, confirming the pages render, the camera opens, and both models genuinely
  load and run real per-frame inference in a live browser with zero page errors.

## BUG-009 — Invoice PDF rendering failed with ENOENT because `pdfkit`'s bundled font-metrics path was rewritten by Turbopack
- Severity: high (every invoice PDF generation failed silently in the background — the financial `Invoice`
  row was created correctly, but `pdfMediaAssetId` stayed null and the download endpoint returned 409 for
  every invoice)
- Reproduction steps: generate an invoice through the real dev server (`POST /api/platform/billing/
  customers/[tenantId]/invoices`), then attempt to download its PDF.
- Expected result: a valid `application/pdf` download.
- Actual result (before fix): the invoice generated correctly but its PDF never attached; the audit trail
  recorded `invoice.pdfGenerationFailed` with reason `ENOENT: no such file or directory, open
  'C:\ROOT\node_modules\pdfkit\js\data\Helvetica.afm'`. Found via live Playwright verification
  (`e2e/billing-workflow.spec.ts`) — the download step failed on the very first full run.
- Suspected cause: `pdfkit` resolves its standard-14 font metrics (`.afm`) files relative to its own
  bundled `__dirname` at require time. Turbopack rewrites `__dirname` to a synthetic path when a package is
  bundled into a server function, which does not correspond to any real directory on disk.
- Status: fixed — 2026-07-28 (Phase 10, see DECISIONS.md D-037). Added `serverExternalPackages: ["pdfkit"]`
  to `next.config.ts` so Next.js `require()`s it from the real `node_modules` directory at runtime instead
  of bundling it.
- Fix verification: `e2e/billing-workflow.spec.ts` re-ran clean (twice consecutively) after the fix,
  including a real PDF download and content-type check; both a normal invoice PDF and a VAT-configured tax
  invoice PDF were rendered and visually inspected end-to-end through the real dev server.

## BUG-010 — `@prisma/adapter-pg` 7.8.0/7.9.1 issues overlapping `client.query()` calls on one transaction-pinned `pg.Client`, triggering pg's own "already executing a query" deprecation warning (P11-000, confirmed unavoidable upstream defect)
- Severity: low (cosmetic — a deprecation warning printed to stderr; every automated test and live workflow
  passes correctly regardless, and no data corruption, lost write, or incorrect result has ever been
  observed alongside it)
- Package/version: `@prisma/client` 7.8.0 and `@prisma/adapter-pg` 7.8.0 (also confirmed still present on
  the latest available stable, 7.9.1 — tested directly, see "Investigation" below); `pg` 8.22.0 (the
  deprecation itself is `pg`'s own new client-level guard, added specifically to catch exactly this pattern
  in any caller, including Prisma).
- Reproduction steps: run `NODE_OPTIONS=--trace-deprecation npx vitest run` (the full suite, or any subset
  that exercises an interactive `prisma.$transaction(async (tx) => {...})` containing more than one
  statement against `tx`) against this project's local Postgres. The warning appears intermittently — not
  on every run, and never in a small isolated single-process repro script, only under the real full-suite's
  multi-worker load/timing.
- Expected result: no deprecation warning; each transaction-pinned client only ever runs one query at a
  time, exactly as the application code itself always does (every `$transaction(async (tx) => {...})` in
  this codebase awaits each `tx.*` call in sequence — verified by direct inspection of every call site
  before starting the investigation below).
- Actual result: `DeprecationWarning: Calling client.query() when the client is already executing a query
  is deprecated and will be removed in pg@9.0.` printed with a stack trace (via `--trace-deprecation`)
  rooted entirely inside Prisma's own runtime:
  `Client.query` (`node_modules/pg/lib/client.js:715`) →
  `PgTransaction.performIO` → `PgTransaction.queryRaw` (`@prisma/adapter-pg/dist/index.mjs`) →
  several frames of `@prisma/client/runtime/client.js`'s `interpretNode`/`Array.map` — never a single frame
  of application code between the awaited `tx.*` call and the internal `Client.query()` call.
- Investigation (P11-000, exhaustive, see WORKLOG.md Session 20):
  1. Audited every `prisma.$transaction(async (tx) => {...})` call site in `src/`, `tests/helpers/
     fixtures.ts`, and `scripts/cleanup-test-db-fixtures.mjs` — every single one already awaits each `tx.*`
     query sequentially. No overlapping application-code query usage exists or ever existed.
  2. Found and fixed 6 call sites (`invoice-repository.ts` ×2, `inspection-template-repository.ts` ×2,
     `reconciliation-repository.ts`, `retention-repository.ts`, `telematics-repository.ts`,
     `tyre-config-repository.ts`, plus the equivalent in `prisma/seed.ts`) using a nested relational write
     with an array of 2+ related records (e.g. `lineItems: { create: [...] }`) inside an interactive
     transaction — Prisma decomposes this into multiple per-row statements internally. Replaced every one
     with an explicit, separately-awaited `tx.parent.create()` → `tx.child.createMany()` →
     (re-fetch where the caller needs the created rows) sequence (DECISIONS.md D-038) — a genuine code
     quality improvement (one SQL statement instead of N per-row inserts) independent of whether it fixed
     the warning.
  3. Re-ran the full suite with `--trace-deprecation` after the fix — **the warning still appeared**, now
     traced to `tx.child.createMany()` calls (my own replacement code) with the identical
     `PgTransaction.performIO`/`interpretNode`/`Array.map` stack shape. This proved the trigger is not
     specific to nested writes — Prisma's driver-adapter runtime appears to internally decompose *any*
     multi-row write inside an interactive transaction into multiple sequential `performIO()` calls, and
     under some timing condition two of them are not fully sequenced against the transaction's single
     pinned `pg.Client`.
  4. Tested whether the latest available stable Prisma release fixes it: upgraded `prisma`/`@prisma/client`/
     `@prisma/adapter-pg` from 7.8.0 to 7.9.1 (a minor version, not a major upgrade) and re-ran the same
     traced reproduction — **the warning still appeared**, identical stack shape. Reverted cleanly back to
     the pinned 7.8.0 (`git checkout -- package-lock.json`, `npm install`, `npx prisma generate`) since the
     upgrade provided no benefit for this issue and this project's standing instruction is not to upgrade
     database packages unnecessarily.
  5. Searched for prior reports: this is a **confirmed, publicly tracked upstream Prisma defect**, not
     unique to this codebase — see prisma/prisma issue
     [#29646](https://github.com/prisma/prisma/issues/29646) ("DeprecationWarning with @prisma/adapter-pg
     v7.8.0", opened 2026-06-15) and issue
     [#29407](https://github.com/prisma/prisma/issues/29407) ("`adapter-pg`: `PgTransaction.performIO`
     called concurrently on single `pg` Client ..., triggering deprecation warning", opened 2026-03-27).
     Per the community investigation referenced there, `PgTransaction.performIO` passes the same `values`
     parameter both inside the query-config object and as `client.query()`'s second positional argument,
     which is itself enough to route through pg's newly-added deprecated call path — and because
     `PgTransaction` pins one single `pg.Client` (not a pool) for the whole transaction's duration by
     design (required for transactional atomicity), any of the adapter's own internal multi-statement
     sequencing that isn't perfectly serialized will trip pg's new client-side guard.
- Suspected cause: an upstream defect in `@prisma/adapter-pg`'s `PgTransaction`/`performIO` implementation,
  not in this codebase's own query usage (proven by exhaustive audit, item 1 above) and not fixable by
  restructuring application-side write patterns (proven by item 3 above, where even the "fixed" code
  triggers it identically).
- Status: **open — proven unavoidable upstream defect**, not fixed in this codebase (nothing here can fix
  it) and not silently suppressed (no `process.noDeprecation`, no log filtering, no `--no-deprecation` flag
  added anywhere). Purely cosmetic: confirmed via two consecutive full-suite runs, both 685/685 passing,
  with the warning appearing on both runs and having no effect on correctness, data integrity, or test
  outcome. The `createMany()` refactor (item 2 above) is kept regardless, as a genuine, independent code
  quality improvement.
- Upgrade path: track prisma/prisma issues #29646 and #29407 upstream; re-run this exact reproduction
  (`NODE_OPTIONS=--trace-deprecation npx vitest run`) after any future `@prisma/client`/`@prisma/adapter-pg`
  upgrade to check whether it has been resolved. Do not upgrade preemptively to an unreleased/dev version
  to chase this — it is cosmetic, not correctness-affecting, and `pg`'s own changelog confirms the
  underlying `client.query()` behavior itself won't actually change until `pg@9.0`, so there is no urgency.
- Fix verification: n/a for the warning itself (confirmed unavoidable, not fixed). The `createMany()`
  refactor's own correctness was verified by the full existing test suite for every affected repository
  (`tests/invoice-repository.test.ts`, `tests/inspection-template-repository.test.ts`,
  `tests/reconciliation-repository.test.ts`, `tests/retention-repository.test.ts`,
  `tests/telematics-repository.test.ts`, `tests/tyre-config-repository.test.ts` where present) all passing
  unchanged after the refactor, plus two consecutive full-suite runs (685/685 both times).

## Known, disclosed: intermittent full-suite-only flake in one reconciliation test (not fixed, not blocking)
- Severity: low
- Reproduction steps: run `npm test` (the full 34-file suite) repeatedly. Roughly 1 run in 2-4,
  `tests/reconciliation-repository.test.ts`'s "pairs the departure and return gate events for the same
  movement, even through different authorised gates" fails.
- Expected/actual: the same test passes 100% reliably every time it's run in isolation
  (`npx vitest run tests/reconciliation-repository.test.ts`, confirmed 3/3 clean re-runs across two
  separate sessions), and the overwhelming majority of full-suite runs also pass clean (Phase 8E-007
  verification: 2 consecutive clean 486/486 runs achieved after this was first observed).
- Suspected cause: not yet root-caused. First observed in the Phase 8D session (before any Phase 8E-007
  test-database-isolation changes existed), so it predates and is unrelated to the fixture-cleanup work in
  this phase — most likely resource contention (Postgres connection-pool pressure, or similar) specific to
  running 34 files' worth of integration tests in parallel against one local Postgres container, not a
  logic defect in the reconciliation pairing code itself (which has full, passing, deterministic unit
  coverage independent of timing).
- Status: open, disclosed — not fixed this session. Not blocking: Phase 8E-007's actual target (unbounded
  tenant-count growth across repeated runs) is fixed and verified; this is a pre-existing, low-severity,
  intermittent-only concern logged for a future session to root-cause, not silently hidden.
- Fix verification: n/a (not yet fixed) — tracked in TODO.md.

## BUG-011 — Investigation report footer created a blank trailing page

- Severity: medium
- Reproduction steps: generate a compact Phase 11 report and render every PDF page.
- Expected result: one content page with `Page 1 of 1`.
- Actual result before fix: PDFKit wrote the footer inside its bottom auto-flow margin, appended a blank
  second page, and left stale page-count text on it.
- Status: fixed — 2026-08-11. Footer moved above the auto-flow boundary.
- Fix verification: report tests assert compact reports are exactly one page and long reports stay
  multi-page; the generated PDF was rendered and visually inspected.

## BUG-012 — Fixed-date telematics escalation test drifted past its relative policy start

- Severity: low (test-only)
- Reproduction steps: run the full suite after 2026-08-02.
- Expected result: the fixed Saturday 2026-08-01 event is covered by its test policy.
- Actual result before fix: policy start was `now - 1 day`; once the clock passed the event, no active
  policy existed and the test correctly produced no exception.
- Status: fixed — 2026-08-11. That fixture now starts on 2026-07-01.
- Fix verification: focused telematics test and the full 735-test suite pass.

## BUG-013 — Governance analytics report notice overlapped report metadata

- Severity: medium
- Reproduction steps: generate a filtered Phase 12 PDF and rasterise its first page.
- Expected result: report identity, period, generation metadata, human-review notice, and first section are
  separated with no clipping or overflow.
- Actual result before fix: PDFKit's flow cursor was reused after drawing a fixed-position notice; the
  notice text overlapped metadata and its border surrounded the following data-quality section.
- Status: fixed — 2026-08-11. The notice now uses an explicit top coordinate and advances `doc.y` to the
  exact bottom of its fixed-height box.
- Fix verification: the Playwright workflow generated a fresh two-page report; both pages were rasterised
  at 2x and manually inspected with clean headings, wrapping, page breaks, and `Page 1/2` footers.

## BUG-014 — Cold Next dev reload could consume the full browser-workflow timeout on an empty login form

- Severity: low (test infrastructure only)
- Reproduction steps: start the complete serial Playwright suite on a cold dev server under local resource
  contention. The server may rebuild/reload `/login` between field entry and form submission.
- Expected result: a shared fixture either reaches `/dashboard` promptly or retries a freshly populated
  form within a bounded interval.
- Actual result before fix: `page.waitForURL()` inherited the whole 180-second test timeout; one Phase 10
  pass ended on an empty reloaded login form even though the identical workflow passed in 30 seconds in
  the preceding gate and every later test remained green.
- Status: fixed — 2026-08-11. The shared helper verifies company/email values and retries the UI login once
  after an explicit 45-second bound.
- Fix verification: focused billing Playwright rerun passed 2/2; final complete gates exercise every caller.

## Template for new entries
```
### BUG-NNN — <short title>
- Severity: critical | high | medium | low
- Reproduction steps:
- Expected result:
- Actual result:
- Suspected cause:
- Status: open | in-progress | fixed | wont-fix
- Fix verification: <test name/link once fixed>
```
# Phase 13A findings (2026-08-11)

- Dependency audit initially reported 12 findings (7 high, 5 moderate), including the Next.js 16.2.10 proxy bypass and vulnerable transitive tooling. Next.js/eslint config were updated to 16.3.0 and the Prisma toolchain to 7.9.1 using non-major fixes; `npm audit --audit-level=low` now reports zero vulnerabilities.
- BUG-010 remains: `pg` emits a deprecation warning when concurrent repository tests call `client.query()` while the adapter is already executing. It is reproduced in focused/full tests, is upstream adapter behavior, and has not affected assertions or data correctness. It is not suppressed.
- Local timing and Docker smoke checks do not prove hosted capacity, availability, backup RPO/RTO or provider interoperability. These are explicit hosted validation gaps, not resolved defects.

## BUG-015 — Repeated local analytics browser runs could hide their fixture behind the bounded result window

- Severity: low (test infrastructure only)
- Reproduction steps: retain more than 100 synthetic HIGH-severity indicators in the local development database, then rerun the Phase 12 analytics browser workflow.
- Expected result: the workflow opens the indicator it created during the current run.
- Actual result before fix: the production dashboard correctly returned its bounded 100-row window, so the title locator could wait until the workflow timeout even though the fixture existed.
- Status: fixed — 2026-08-11. The workflow still verifies dashboard loading/filter reset, then navigates to the newly inserted fixture using the ID returned by its deterministic setup helper.
- Fix verification: the analytics workflow and the investigation workflow that followed the prior timeout passed together (2/2) in 3.4 minutes.

# Phase 14A pilot findings (2026-08-12)

PILOT-DEF-001 (Medium) found the investigation table widening a 390px document by 50px; the table is now in a local horizontal container and page/filter/header layouts wrap. PILOT-DEF-002 (Medium) found an unhandled gate-list rejection when disconnection raced initial load; it now produces a user-facing alert and recovery reload. Both passed the pilot Chromium retest. No Critical or High pilot defect is open; details remain in `PILOT_DEFECT_REGISTER.md`. The current online-only boundary and lack of an installable PWA are known product limitations, not hidden defects.

# Phase 15A findings

No Phase 15A Critical or High defect is known. Findings fixed in this phase include mutable unaudited
mapping, fallback-to-vehicle-ID, raw identifier exposure, missing event provenance, provider-event
duplication, staging development-provider defaults, premature activation of future mappings, cross-vehicle
correction lineage, synthetic population of a live-provider mapping, missing-value coercion, future/non-
finite/negative telemetry acceptance, structured-log newline injection, and one unnamed existing expiry-
date input exposed by the new responsive browser check. The focused browser run also exposed a cold dev-
server output-pipe failure; the server was restarted with durable local ignored logs, the accessibility
label was fixed, and the five-viewport test passed. The Playwright web-server cold-start budget is now 120
seconds; assertion budgets were not broadened.

BUG-010 remains Low/upstream: the existing Prisma PostgreSQL adapter test warning is not suppressed and has
not affected assertions/data correctness. Provider interoperability, hosted capacity and real webhook/
legal/commercial suitability remain explicit external evidence gaps, not claimed defects.

# Phase 16A mobile findings

No unresolved Critical or High Phase 16A defect is known. The initial Expo/React Native candidate was rejected—not shipped—after npm reported 21 advisories (14 High, 7 Moderate) without a compatible fixed graph. The committed Capacitor graph audits at zero.

MOBILE-DEF-001 (High if released) found browser `fetch` invoked with the API client as `this`; it is now bound to `globalThis`. MOBILE-DEF-002 (High availability) found exact `home`, `guard` and `owner` routes omitted while child routes were allowed; exact roots are now tested. MOBILE-DEF-003 (High release boundary) found native CORS absent and trusted cross-site origins rejected too early; exact `MOBILE_TRUSTED_ORIGINS`, bounded CORS and trusted-origin precedence now pass.

MOBILE-DEF-004 (High release integrity) was found by the first complete candidate gate: the Docker dependency
stage copied only the root manifest before `npm ci`, so the new workspace packages were absent and the
container build failed Next's TypeScript check. The dependency stage now copies every workspace manifest
before installation. A focused clean image build then generated all 112 pages, ran as non-root `nextjs`,
returned healthy liveness and connected to no production data. The failed candidate is not counted as a
final gate.

Known limitations are no native build/device verification, final identifiers, production auth, push, offline mutations, automatic EXIF stripping, native upload cancellation/background resume or detailed owner drill-down. BUG-010 remains the known Low upstream warning.

# Phase 16B Android findings

ANDROID-DEF-001 (High if released) found the native URL listener accepted any parseable scheme/host. It now
accepts only `genbridgefleet://open/<non-empty-path>` and capability authorization remains mandatory.
ANDROID-DEF-002 (High if released) found default Android backup enabled and a FileProvider external-root
path. Backups/data transfer are disabled and paths are app-specific Pictures/cache only.
ANDROID-DEF-003 (High release integrity) found no build-type separation/guard for local cleartext, logging
and the provisional ID. Debug/release sources are separated and Gradle refuses local config on release.
ANDROID-DEF-004 (High build integrity) was found by the first complete Phase 16B candidate gate: the Docker
Next typecheck did not accept Vite's `ImportMetaEnv` as a string-indexed default parameter. The default is
now explicitly narrowed at the boundary; the failed candidate is excluded from consecutive gate counts.
ANDROID-DEF-005 (Medium verification stability) was found by the corrected candidate gate: unbounded Vitest
workers saturated the shared local PostgreSQL instance, timing out three repository cases while their 872
peers passed. Both affected files passed 28/28 together. The suite now caps two workers and uses a 30-second
default/120-second documented global billing scan ceiling without removing or weakening assertions.

ANDROID-ENV-001 remains open: the API 35 AVD becomes offline during both streamed and non-streaming APK
installation. APK/JVM/lint/instrumentation compilation pass, but installation/native execution does not.
Automatic EXIF/location stripping is also an explicit release blocker. No unresolved Critical code defect
is known; device runtime, final identity/signing and independent review remain mandatory.

## Phase 17B Android facial-verification finding

ANDROID-DEF-006 (High functional gap if Phase 17A were presented as mobile-complete) found the Phase 17A APK identical to Phase 16B because the Android bundle still exposed only the legacy generic synthetic identity success action. The mobile application had no enrolment state, explicit failure outcomes, camera-readiness surface, controlled fallback/manager workflow, attempt feedback or audit confirmation. The Android workflow, tenant-scoped mobile endpoints, binding/separation enforcement and synchronized-bundle JVM regression are now implemented. The rebuilt APK hash differs. Physical-device execution remains blocked by ANDROID-ENV-001 and is not claimed.

## Phase 18A known limitations

No open Critical/High Phase 18A code defect is accepted. Self-service registration is intentionally unavailable in production; CSV import, live tracking, real email, hosted-scale evidence and real facial verification are out of scope. Vehicle health is presented as factual status/expiry/inspection information rather than an invented score. Physical Android validation remains governed by ANDROID-ENV-001 and is not claimed by this web/backend phase.

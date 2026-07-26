# KNOWN_BUGS.md

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

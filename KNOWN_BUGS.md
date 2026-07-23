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

# SECURITY_AND_POPIA.md

## Security controls (V1 target)
- Server-side authorisation on every mutating and every sensitive-read code path via
  `requirePermission()` — never rely on UI hiding a control.
- Tenant filter injected on every tenant-owned query (see ARCHITECTURE.md tenant-isolation strategy).
- Passwords hashed with bcrypt (cost factor documented in `lib/auth/password.ts` once written); never
  logged, never returned by any API response.
- Sessions: httpOnly, Secure (in production), SameSite=Lax signed cookie holding only an opaque session
  id; server-side revocation supported.
- Media: no public bucket access; all reads via short-lived (5-minute) signed URLs minted server-side after
  a `mediaAsset:VIEW` permission + tenant check — implemented Phase 4, see ARCHITECTURE.md "Media/video
  architecture" and `lib/repositories/media-asset-repository.ts`.
- Input validation: Zod schemas server-side on every mutation; client validation is UX-only.
- Structured audit logging for sensitive record access (facial data, video evidence, identity documents),
  not just for writes — implemented for media reads in Phase 4 (`mediaAsset.readAccessGranted`, logged at
  signed-URL mint time, see DECISIONS.md D-014); not yet extended to other Restricted-classified reads
  (e.g. viewing a Driver's licence/PDP fields) — tracked in TODO.md as a follow-up, not blocking this phase.

## Access model
Permission-based (resource + action), not role-name checks in business logic — see ARCHITECTURE.md.
Platform Administrator support access to tenant data is restricted and must itself be audit-logged; it is
not a silent bypass (build-brief requirement — "cannot silently access tenant evidence"). Planned
(Phase 7, DECISIONS.md D-016): a dedicated `SupportAccessSession` model — visible "Support view —
[Customer]" banner, read-only by default, mandatory reason/ticket reference, time-limited, start/end/actor/
customer/reason all audit-logged, no default access to biometric evidence or restricted investigation
cases, explicit separate elevated-access workflow required for any authorised change. This replaces
granting platform roles any standing permission on customer tenant business resources — there is no such
grant today and none is planned.

## Sensitive data classifications
- **Restricted:** facial reference/verification data, identity documents (licences, PDP), vehicle video,
  location/GPS history, driver personal contact details.
- **Confidential:** vehicle master data, movement authorisations, inspection results, audit logs.
- **Internal:** dashboards/aggregate reporting.

## Facial-reference data treatment
No facial-recognition model is built in-house. `FacialVerificationProvider` interface stores only:
provider reference, match result, confidence/result metadata (if supplied), liveness result, verification
timestamp, failure reason. Raw biometric templates, if a future provider requires storing them, are out
of scope for V1 storage — treated as Restricted and access-logged if ever added.

## Video and image treatment
Gate evidence (photos/video) is Restricted — enforced, not just documented, as of Phase 4. Every
`MediaAsset` defaults to `classification: RESTRICTED`. Access requires the `mediaAsset:VIEW` permission
(role-differentiated across the nine tenant roles, see DECISIONS.md D-015 — e.g. Gate Security Officer,
Dispatch and Logistics Officer, and Fleet and GPS Manager can create and view evidence they capture;
Internal Investigator/Auditor, Accountant/Finance and Compliance Officer, Company Administrator, and
Security Supervisor / Approving Manager can view but never create; Executive Read-Only Viewer has no
`mediaAsset` permission at all) plus a tenant match, both re-checked at signed-URL mint time
(`mintSignedUrlForMediaAsset()`), not just implied by a UI control. Every grant is audit-logged
(`AuditLog`, `entityType: "MediaAsset"`, `action: "mediaAsset.readAccessGranted"`) — see DECISIONS.md
D-014 for the chosen granularity (per mint, not per raw-byte fetch). No raw storage path is ever reachable
without a valid, unexpired, tenant-matched signature — verified by `tests/media-asset-repository.test.ts`
and `tests/media-tenant-isolation.test.ts`, and manually confirmed via curl (direct filesystem-style paths
404, a tampered signature 403s, an expired one 410s, a different tenant's session is rejected even
against a genuinely-minted signature).

## GPS/location and vehicle-use-policy treatment (planned, Phase 6)
Location/GPS history is already classified Restricted (above). Telematics data (position, ignition,
odometer, speed) will be accessed only through the `TelematicsProvider` interface — no raw vendor
credentials or API tokens stored in plaintext, logs, or exposed through any API response
(`INTEGRATIONS.md`). Geofence/after-hours/mileage-policy violations raise an `Exception` for human review
through the existing Phase 3 workflow; the system must never state or imply that an employee committed
fraud, theft, or a crime — a violation is a fact pattern for a human to review, not a conclusion.

## Retention configuration
Tenant-level `retentionDays` setting exists on `Tenant` (Phase 1 schema) as the config point; the
scheduled-purge job enforcing it is not yet built — tracked in TODO.md. Until built, no data is
auto-deleted.

## Encryption expectations
Transport: HTTPS everywhere in any non-local environment. At rest: relies on the hosting provider's
disk/volume encryption (Postgres + object storage) — no field-level application encryption in V1 beyond
password hashing.

## Incident considerations
No incident-response runbook exists yet — out of scope for V1 foundation, should be authored before
production deployment (Phase 7).

## Deferred design: password reset (not implemented — FOUND-003)
Not blocked on an email/authentication-provider decision to *design*, only to actually *deliver* the
reset link — so the design below is written now and the delivery mechanism is swapped in later without
changing anything else.

- **Model:** reuse the exact hashed-token pattern already implemented for `Session.tokenHash` and
  `UserInvitation.tokenHash` — a new `PasswordResetToken` model: `id, tenantId, userId, tokenHash (unique),
  expiresAt, usedAt, requestedIp, createdAt`. Same SHA-256-of-random-bearer-token approach; raw token
  never persisted.
- **Request flow:** `POST /api/auth/request-password-reset { tenantSlug, email }`. Always returns 200
  with a generic message regardless of whether the account exists (avoid user enumeration) — mirrors the
  generic-error pattern already used by `/api/auth/login`. If the user exists and is ACTIVE and the
  tenant is ACTIVE, create a `PasswordResetToken` (TTL: 1 hour — shorter than the 7-day invitation TTL,
  since this is a self-service recovery path, not an onboarding path) and hand the raw token to whatever
  the delivery mechanism is.
- **Delivery mechanism (the actually-blocked part):** requires an email provider decision — same gap as
  `INTEGRATIONS.md`'s "Notifications" row. Until chosen, the dev/test behaviour mirrors the invite flow:
  return the raw token directly in the API response so the flow is testable end-to-end without email.
  That fallback must be removed (or gated behind `NODE_ENV !== "production"`) the moment a real provider
  is wired in — flagged here so it isn't missed.
- **Consume flow:** `POST /api/auth/reset-password { token, newPassword }` — validates via the same
  not_found/revoked/expired/tenant_inactive checks as `validateInvitationToken`, sets the new
  `passwordHash`, marks the token `usedAt`, and — this is the part existing session code already
  supports — calls `revokeAllSessionsForUser()` so a stolen old session dies the moment a password is
  reset, not just future logins.
- **Rate limiting:** the request endpoint should be rate-limited per (tenantSlug, email) and per IP once
  a rate-limiting mechanism exists anywhere in the app (none does yet — first real user of that
  infrastructure, tracked as a TODO alongside this).

## Deferred design: reauthentication for sensitive actions (not implemented — FOUND-010)
Not blocked on anything external; deferred only because Phase 1 has no action sensitive enough to need it
yet (suspending a user, inviting a user, etc. are already permission-gated and audit-logged, which the
build brief treats as sufficient for those). This becomes relevant once Phase 3+ adds true point-of-no-
-return actions (e.g. approving a high-severity exception override, exporting biometric evidence).

- **Model:** an "elevated" flag on the existing `Session`, not a separate mechanism — `elevatedUntil:
  DateTime?` column. Re-entering the current password sets `elevatedUntil = now + 5 minutes` (chosen to
  be short enough that walking away from a workstation doesn't leave a standing elevated window, long
  enough to complete one sensitive action without re-prompting mid-flow).
- **Enforcement:** a new guard, `requireElevatedSession(session)`, sitting next to `requireApiPermission`
  in `lib/auth/api-guard.ts`, checked in addition to (not instead of) the normal permission check for a
  short explicit list of actions — the list lives in code next to the guard, not scattered per-route, so
  "which actions need this" stays auditable in one place.
- **Which actions need it:** deliberately not decided yet — will be enumerated when the first real
  candidate (Phase 3+ high-severity exception approval) is built, rather than guessed now.

## Deferred design: MFA (TOTP) — schema-ready, not built
`User.mfaEnabled` / `User.mfaSecret` already exist (Phase 1 schema) so a future TOTP enrolment flow
doesn't need a migration, only new endpoints (`/api/auth/mfa/enroll`, `/api/auth/mfa/verify`) and a login
flow that pauses for a second factor when `mfaEnabled` is true. Not scheduled for a specific phase yet.

## Items requiring professional legal / Information Officer review before production use
- POPIA lawful-basis analysis for storing driver facial reference data and biometric verification
  results.
- Retention periods per data category (current `retentionDays` is a single tenant-wide config; may need
  to be per data category).
- Cross-border storage location if a cloud region outside South Africa is used.
- Data subject access/erasure request process (drivers are data subjects, not just system users).
- Consent/notice wording shown to drivers regarding facial verification and video capture at gates.
- Employee GPS/location tracking (Phase 6): lawful-basis analysis, notice to employees/drivers about
  vehicle tracking, and any restrictions on after-hours or private-use location monitoring — this varies
  by jurisdiction and employment context and has not been assessed.

None of the above are legal conclusions from this document — they are flagged items for professional
review, per the hard rule against providing legal conclusions.

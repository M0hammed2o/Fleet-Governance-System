# SECURITY.md

This is the engineering security checklist. Privacy/legal context lives in `SECURITY_AND_POPIA.md`.

## Phase 11 guarantees

- Every investigation query and write is tenant-scoped; nested resources also require their parent case ID.
- Confidential narratives and restricted notes/evidence are filtered server-side.
- Case outcomes come only from an approved finding; allegation text is always presented separately.
- Notes, finding versions, evidence manifest entries, approvals, and chronology are preserved rather than
  overwritten. Evidence downloads use short-lived signed URLs.
- Investigation holds block retention deletion. Closing a case never releases its hold automatically.
- External auditors have no general tenant visibility: a live exact-case grant, expiry/revocation check,
  role check, and explicit download flag are required on every request. Portal operations are read-only and
  access is logged.
- No biometric template/descriptor is copied into referrals, reports, logs, or external responses.
- Default invitation/notification providers are no-op; no real external message is sent.

## Phase 12 guarantees

- Every analytics repository derives tenant identity from the authenticated session or iterates a single
  explicit tenant inside the authenticated job. Foreign and unknown IDs share the same not-found response.
- Dashboard, indicator, rule configuration, and export have separate server-side permissions. Seed grants
  are conservative; executive view does not imply export, review, configuration, evidence, or confidential
  investigation access.
- Investigation analytics are aggregate-only. Responses/reports never contain case titles, allegations,
  subject identities, notes, evidence, or confidential narratives.
- Supporting-record references are withheld unless the viewer has the underlying resource's VIEW
  permission. No biometric template, descriptor, raw face capture, secret, or provider credential is an
  analytics source or response field.
- Date ranges and configuration values are schema-validated; dashboard/calculation/list/export reads are
  bounded and indexed. Job routes reuse scheduler-token/session authentication and the shared overlap lock.
- Rule changes create audited immutable versions. Review/dismiss/reopen/escalate actions append chronology
  and audit rows; dismissal never deletes evidence. Escalation requires a human and creates/links only a
  same-tenant investigation, never a finding or outcome.
- CSV cells beginning with spreadsheet control characters are prefixed before RFC quoting. Stored reports
  use tenant-owned media and short-lived signed URLs.
- Tracker records are never called live in Phase 12. Missing data is not proof of misconduct; mock/manual/
  incomplete/unavailable sources and limitations are disclosed in UI and reports.

## Reporting a vulnerability

Do not include production secrets or personal information in an issue. Provide the affected route,
tenant/role preconditions, expected boundary, observed result, and a minimal reproduction to the repository
owner through the organisation's approved private security channel. No public channel is configured yet.
# Phase 13A production hardening

Production now has CSP, HSTS, clickjacking/MIME/referrer/permissions headers; same-origin mutation checks in Next.js `proxy.ts`; secure server-side authorization remains mandatory on every route; same-origin payment return URLs; timing-safe rotated scheduler tokens; HMAC session identifiers; hashed login-throttle dimensions and generic failures; short-lived rotated signed media; fail-closed provider selection; structured redaction; minimal public health; authenticated diagnostics; bounded retries/scans; and secret/.env staging checks. Login throttling is 8 failed attempts per tenant/email dimension or 30 per source IP over 15 minutes, with no raw email/IP in the throttle table. Automatic notification retries stop after three.

The 2026-08-11 dependency audit is zero after non-major updates. Outstanding security dependencies are operational: approved HTTPS/reverse proxy, secret manager, WAF/network controls as appropriate, monitoring/alert response, provider webhook specifications, production backup/restore, legal/privacy confirmations and independent penetration/security review before real customer use.

# Phase 14A synthetic-pilot controls

Pilot mutation commands reject production environment flags, non-loopback databases and database names outside the two approved local dev/test targets. Reset requires the fixed tenant id/name/slug and deletes only tenant-prefixed files after resolved-path containment. All addresses use `pilot.example.test`; biometric templates are prohibited and verified at zero. Roles copy the canonical least-privilege sets without expansion. CSV is dry-run only and rejects formulas, biometric columns, duplicates and foreign tenants. Browser checks cover role denial, foreign identifiers, confidential case scope and immediate external-auditor boundary behavior. The candidate gate suppresses credential listings and persists no command output or secret value.

# Phase 15A tracker/staging security review

The simulator has no network client and refuses both `APP_ENV=production` and `NODE_ENV=production`.
Webhooks validate the tenant/connection before raw-body HMAC, use timing-safe comparison and replay state;
invalid/malformed payloads fail closed. Calls have abort timeouts, at most three retries/backoff and bounded
pages. Normalization rejects malformed coordinates, future/invalid event and communication timestamps,
unsupported units, negative speed/odometer and non-finite values; missing booleans remain unknown rather
than being coerced to false. Duplicates are idempotent and late/out-of-order events retain limitations.
Structured simulator correlation IDs are allow-listed to prevent newline/log injection.

Mapping writes require `telematics:CONFIGURE`, tenant-scoped actor/vehicle lookup, composite tenant foreign
keys, partial active uniqueness, effective windows, same-vehicle correction lineage, audit fingerprints
and preserved history. Future mappings cannot ingest early, and the synthetic adapter cannot populate a
live-provider mapping. Unmapped/ambiguous input is quarantined and ordinary responses omit raw asset IDs.
UAT packs bind to the catalogue digest, constrain tester/approver chronology and sign-off, require evidence/
defects and neutralize CSV formulas. Staging rejects local/dev targets, placeholders, local storage and
external providers; production rejects synthetic tracking. External security evidence is still required
for real provider auth/signatures, egress, secret manager, hosting access, incident response and independent
assessment.

# Phase 16A mobile security boundary

Strict bearer tokens reuse hashed revocable sessions. Native storage is Keychain/Keystore-backed and web testing is memory-only. Effective permissions, tenant scope, state, separation of duties, audit actor/time and evidence ownership remain server-enforced. Exact `MOBILE_TRUSTED_ORIGINS` enables native CORS; production password auth remains disabled without approval. Critical actions require database idempotency and ambiguous completion fails closed. There is no provider/database/storage access, raw tracker ID, public evidence URL, automatic GPS, real biometric, offline queue or external notification delivery.

Tests cover identifier/role/deep-link manipulation, cross-tenant results, origin policy, token clearing, unsafe URLs/storage, replay/conflict, evidence abuse, disconnected mutation and provenance. No unresolved Critical/High defect is known, but compromised devices, screenshots/overlays, native permissions and independent assessment remain blockers. See `MOBILE_SECURITY_AND_PRIVACY.md`.

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

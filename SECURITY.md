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

## Reporting a vulnerability

Do not include production secrets or personal information in an issue. Provide the affected route,
tenant/role preconditions, expected boundary, observed result, and a minimal reproduction to the repository
owner through the organisation's approved private security channel. No public channel is configured yet.

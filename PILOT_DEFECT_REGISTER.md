# Pilot defect register

No Critical or High defect may remain open at local pilot acceptance. Record one entry per defect; never place secrets, real personal data or full confidential allegations here.

## Status summary

| Severity | Open | Fixed awaiting retest | Closed |
|---|---:|---:|---:|
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 0 | 0 | 2 |
| Low | 0 | 0 | 0 |

## Entry template

### PILOT-DEF-___ — Summary

- Environment/build commit:
- Role:
- Preconditions:
- Reproduction steps:
  1.
- Expected result:
- Actual result:
- Severity: Critical | High | Medium | Low
- Security/privacy effect:
- Safe workaround:
- Owner:
- Status: OPEN | IN_PROGRESS | FIXED_AWAITING_RETEST | CLOSED | ACCEPTED_MEDIUM_LOW_RISK
- Fix commit:
- Verification evidence:
- Retest result/tester/date:

Severity changes require written rationale. Closing requires independent retest of the original scenario and an adjacent negative/security path. Conditional acceptance is forbidden for Critical/High defects.

## Closed defects

### PILOT-DEF-001 - Investigation list overflowed a phone viewport

- Environment/build commit: local Phase 14A candidate
- Role: Approving Manager
- Preconditions: synthetic pilot tenant, 390 x 844 viewport, two cases
- Reproduction steps: sign in, open Investigations, inspect the case table
- Expected result: the page has no horizontal document overflow and the table remains usable
- Actual result: the uncontained table widened the document by 50 CSS pixels
- Severity: Medium
- Security/privacy effect: none; usability could impede a mobile reviewer
- Safe workaround: use tablet/desktop width
- Owner: Engineering
- Status: CLOSED
- Fix commit: Phase 14A responsive-hardening commit
- Verification evidence: `e2e/pilot-readiness.spec.ts`, four representative gate viewports
- Retest result/tester/date: PASS, automated Chromium pilot suite, 2026-08-12

### PILOT-DEF-002 - Gate configuration refresh rejected without handling when disconnected

- Environment/build commit: local Phase 14A candidate
- Role: Gate Security Officer
- Preconditions: synthetic pilot tenant, gate page loading as browser becomes offline
- Reproduction steps: open Gate, disconnect network before the gate list request settles
- Expected result: an honest failure is announced and no success is implied
- Actual result: the background fetch produced an unhandled browser rejection
- Severity: Medium
- Security/privacy effect: no data loss; confusing failure handling at a safety-critical screen
- Safe workaround: reconnect and reload authoritative state
- Owner: Engineering
- Status: CLOSED
- Fix commit: Phase 14A responsive-hardening commit
- Verification evidence: online-only failure/recovery Playwright scenario and `role=alert`
- Retest result/tester/date: PASS, automated Chromium pilot suite, 2026-08-12

# Pilot onboarding and UAT

## Purpose and boundary

This pack prepares a local release candidate for a future approximately 15-vehicle pilot. It is not deployment approval. The current organisation, people, vehicles, addresses, evidence, billing and tracker records are explicitly fictional. `pilot.example.test` cannot receive mail; tracker/payment/email providers remain mock, no-op or disabled; no biometric template is seeded.

Real customer data may be introduced only after every `MANUAL_CONFIRMATION_REQUIRED` item has an accountable owner, evidence and written approval.

## Environment and synthetic dataset

- Local PostgreSQL and local private storage only; `APP_ENV=development` or `test`.
- Tenant: **Genbridge Synthetic Fleet Pilot** (`genbridge-synthetic-fleet-pilot`).
- 2 sites, 4 gates, 15 vehicles including 2 trailers, 15 drivers, 10 role users and 30 synthetic compliance documents.
- Nine scenarios cover normal return, late return, condition failure, cargo/fuel/odometer discrepancies, unavailable tracker, gate override and unapproved movement.
- Two cases demonstrate independent finding approval, active evidence hold, restricted notes and case-scoped external audit.
- Four indicators demonstrate MOCK, MANUAL, MIXED and UNAVAILABLE quality.

Commands:

```text
npm run pilot:seed
npm run pilot:verify
npm run pilot:test-boundaries
npm run pilot:uat:validate
npm run pilot:import:dry -- vehicles
```

`pilot:reset` deletes only the exact fixed synthetic tenant and its individually validated local evidence paths. It refuses production, non-loopback databases, unapproved database names and identity mismatches.

## Entry criteria

- Release-candidate commit identified; worktree clean; all migrations current/replayed; backup/restore verified.
- `pilot:seed`, `pilot:verify`, UAT catalogue validation and release-candidate checks pass.
- No unresolved Critical or High security/privacy/tenant-isolation defect.
- Test devices/browsers, synthetic participants and evidence directory prepared.
- Provider state confirmed mock/no-op/disabled; production readiness expected to remain blocked.
- Pilot owner, tester roster and test dates: **MANUAL_CONFIRMATION_REQUIRED**.

## Exit criteria

- Every applicable catalogue case is PASS; BLOCKED cases have accepted owner/date/risk and cannot include Critical/High safety, privacy or isolation risk.
- Cross-tenant, role restriction, evidence hold, external-auditor scope and no-external-delivery cases pass.
- Complete automated gate passes twice from stable source; no Critical/High open defect.
- Seven role guides, onboarding checklist, rehearsal outcomes, rollback procedure and support escalation template are acknowledged.
- Go/no-go group records ACCEPTED, CONDITIONALLY_ACCEPTED or REJECTED. Local acceptance never authorises deployment.

## Role matrix

| Role | Responsibilities and screens | Permitted | Forbidden / restricted | Training |
|---|---|---|---|---|
| Company Administrator | Organisation, sites/gates, users, vehicles/drivers, document/retention configuration, external access | Configure tenant; initiate deletion/export; manage grants; view analytics/billing | Cannot approve own deletion; no evidence rewriting; no platform diagnostics | Administrator guide; privacy/retention; support escalation |
| Dispatch and Logistics Officer | Movements and supporting documents | Create/edit/submit movement; view fleet/tracker labels; refer concern | Cannot approve movement, operate gate, resolve exception or view confidential case | Dispatch guide; approval separation; offline boundary |
| Gate Security Officer | Gate queue/event, identity fallback, inspection, evidence | Start/edit event; capture evidence; raise exception/referral; request manual GPS | Cannot approve movements, resolve own serious exception, edit master/billing data or enrol biometrics | Security guide; evidence; device/network failure |
| Security Supervisor / Approving Manager | Movement approvals, exceptions, reconciliations, security dashboard, findings/holds/analytics review | Approve/reject independently; resolve; approve findings; review/escalate indicators | No self-approval of own requests/findings; cannot rewrite original evidence | Approving guide; fairness; separation of duties |
| Accountant / Finance and Compliance Officer | Billing, invoices, reconciliations and compliance | Review billing/reconciliation; approved manual finance actions | No gate operation, case investigation or tenant-wide configuration; no real payment in UAT | Finance workflow plus billing outage rehearsal |
| Fleet and GPS Manager | Fleet, tracker/manual location, policies | Maintain fleet/GPS configuration; review freshness; resolve authorised manual confirmation | Cannot describe mock/stale data as live or infer misconduct | Tracker quality/outage and mapping rehearsal |
| Internal Investigator / Auditor | Investigation dashboard/detail, evidence, notes, tasks, findings, reports | Triage/perform assigned review, submit findings and reports under permissions | Cannot approve own submitted finding; restricted information stays case/role scoped | Investigation guide; fairness/confidentiality |
| External Reviewer | Oversight subset defined by seeded permissions | Review approved operational/investigation information | No general case mutation, platform or tenant configuration | Read-only/confidentiality briefing |
| Executive Read-Only Viewer | Analytics/dashboard/report views | View authorised aggregate governance information and exports if granted | No rule/case/gate/operational mutation; no confidential narratives through aggregates | Indicator limitations and export handling |
| External Auditor (Case-Scoped) | Dedicated external-auditor portal | View only explicitly granted cases; download only when flags allow | Cannot enumerate tenant cases, see restricted notes, mutate, or retain access after expiry/revocation | External-auditor guide |
| Platform Administrator | Platform tenant, readiness, tenant/storage/billing/support dashboards | Platform configuration/diagnostics and audited support workflow | Not an ordinary customer role; support session never silently grants customer writes | Support guide; incident/secret handling |

The established combined roles remain intentional. “Investigation Manager” responsibilities sit with Security Supervisor / Approving Manager; “Internal Auditor” responsibilities sit with Internal Investigator / Auditor. UAT does not broaden permissions for convenience.

## UAT governance

### Roles and schedule template

| Function | Named participant | Date/window | Status |
|---|---|---|---|
| Business pilot owner | MANUAL_CONFIRMATION_REQUIRED | MANUAL_CONFIRMATION_REQUIRED | Pending |
| UAT lead | MANUAL_CONFIRMATION_REQUIRED | MANUAL_CONFIRMATION_REQUIRED | Pending |
| Security/privacy reviewer | MANUAL_CONFIRMATION_REQUIRED | MANUAL_CONFIRMATION_REQUIRED | Pending |
| Role testers | MANUAL_CONFIRMATION_REQUIRED | MANUAL_CONFIRMATION_REQUIRED | Pending |
| Technical/support observer | MANUAL_CONFIRMATION_REQUIRED | MANUAL_CONFIRMATION_REQUIRED | Pending |
| Go/no-go approvers | MANUAL_CONFIRMATION_REQUIRED | MANUAL_CONFIRMATION_REQUIRED | Pending |

### Catalogue and test-case format

The authoritative machine-readable catalogue is `pilot/uat-catalogue.json`. Every case includes unique ID, module, objective, role, preconditions, test data, steps, expected result, actual result, pass/fail, evidence, defect reference, tester, date, retest and approval. Validate with `npm run pilot:uat:validate`. Never place passwords, tokens, personal information or raw confidential narratives in evidence.

### Severity and defect workflow

- **Critical:** unsafe, isolation/privacy breach, data corruption or pilot-blocking; stop testing, contain, notify leads.
- **High:** major security/business workflow failure without safe workaround; pilot cannot pass.
- **Medium:** important failure with controlled documented workaround; owner and retest required.
- **Low:** cosmetic/minor usability issue; prioritise without misrepresenting acceptance.

Tester records evidence and a `PILOT_DEFECT_REGISTER.md` entry. Triage confirms severity/owner, code changes receive focused regression coverage, independent tester retests the original and adjacent paths, and only evidence-backed PASS closes it. Conditional acceptance may cover Medium/Low only with owner, expiry and rollback trigger.

### Evidence and retest

Accept safe screenshots, Playwright traces, redacted JSON/CSV, command exit summaries, case/report references and audit-event identifiers. Store locally in ignored test output and record only a non-sensitive reference. Retest uses the same case/data plus a nearby negative case and updates retest/approval fields; never overwrite initial evidence.

## Scenario-to-case coverage

- Dispatch/approval/gate/return: UAT-DISPATCH-001, UAT-APPROVAL-001, UAT-GATE-001/002.
- Unapproved, defect, override and reconciliation: UAT-GATE-003, UAT-INSP-001, UAT-EXC-001, UAT-RECON-001.
- Tracker/data quality and analytics: UAT-TRACKER-001, UAT-ANALYTICS-001.
- Investigation/hold/external audit: UAT-INV-001, UAT-HOLD-001, UAT-AUDITOR-001.
- Billing/platform/isolation: UAT-BILL-001, UAT-PLATFORM-001, UAT-SEC-001.
- Responsive/accessibility/disconnected/recovery: UAT-RESP-001, UAT-A11Y-001, UAT-OFFLINE-001, UAT-RECOVERY-001.

## Customer onboarding checklist

Every unchecked item is `MANUAL_CONFIRMATION_REQUIRED` for a real pilot:

- [ ] Contracting identity, authorised representative, pilot scope/dates and transition-to-paid terms approved.
- [ ] Pilot owner, project/technical/support/escalation contacts and working/support hours named.
- [ ] Information Officer, privacy/legal contact, PAIA status, lawful bases/notices and breach contacts confirmed.
- [ ] Sites, gates, directions, devices, network assumptions and operating hours signed off.
- [ ] Vehicle/trailer list, tracker ownership/authorisation/mappings and historical-data need approved.
- [ ] Driver list, permitted fields, notices, retention and any biometric lawful basis/opt-out/manual fallback approved.
- [ ] Users, roles, approval chains, delegations and separation-of-duties owners approved.
- [ ] Exception thresholds, analytics-rule owners, operating-hour rules and review cadence approved.
- [ ] Evidence capture, classification, access, holds, export, deletion and final retention periods approved.
- [ ] Provider accounts, DPAs, credentials, sandbox evidence, outage contacts and deletion propagation approved.
- [ ] Validated imports completed under a separately authorised future importer; no ordinary CSV biometrics.
- [ ] Training attendance/acknowledgements and all UAT outcomes signed.
- [ ] Monitoring, incident management, backup RPO/RTO/restore evidence and support/on-call model approved.
- [ ] Pilot acceptance, stop conditions, rollback owner, offboarding/export/deletion evidence and exit criteria approved.

## Outstanding-risk register

| Risk | Current state | Required owner/evidence |
|---|---|---|
| Hosting/database/storage/scheduler/monitoring | NOT_CONFIGURED | Approved architecture, contracts, alerts and restore proof |
| Tracker/email/payment | MOCK_ONLY or NOT_CONFIGURED | Vendor docs, sandbox, authorisation, credentials and contract tests |
| Retention/POPIA/PAIA/biometrics | MANUAL_CONFIRMATION_REQUIRED | Information Officer/legal decisions and notices |
| Offline gate operation | Not implemented | Network resilience plan and business fallback; do not claim offline support |
| Named pilot/support/training owners | MANUAL_CONFIRMATION_REQUIRED | Roster, hours, contacts and acknowledgements |
| Hosted capacity/device variability | Not proven locally | Hosted load test and approved device/browser/camera matrix |

## Go/no-go checklist and sign-off

- [ ] Entry/exit criteria and two stable gates evidenced.
- [ ] Critical/High defects: zero open; Medium/Low risks explicitly reviewed.
- [ ] Isolation, permissions, confidentiality, holds, revocation and rollback evidenced.
- [ ] Synthetic-to-real data transition, imports, providers, monitoring and backup approved.
- [ ] Training/support/incident contacts and pilot stop authority named.
- [ ] Production readiness exits zero in the approved environment (not expected locally).

Decision: `ACCEPTED | CONDITIONALLY_ACCEPTED | REJECTED`

Conditions/expiry: ____________________

Business owner/date: ____________________

Security/privacy owner/date: ____________________
Technical release owner/date: ____________________

Signatures approve only the documented pilot change; they do not waive security controls or authorise unrelated deployment/data processing.

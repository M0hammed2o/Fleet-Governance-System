# Phase 14A local pilot acceptance and readiness report

Date: 2026-08-12

Scope: local engineering release candidate only

Decision: PENDING FINAL DOUBLE GATE; NOT AUTHORISED FOR REAL PILOT OR DEPLOYMENT

## Candidate contents

The fixed `Genbridge Synthetic Fleet Pilot` tenant contains 2 fictional sites, 4 gates, 10 least-privilege role users, 15 drivers, 15 vehicles including trailers, 30 compliance-document records, 9 scenario movements, 14 gate events, 5 reconciliations, 4 exceptions, 6 explainable indicators, 2 investigations, synthetic evidence/holds, one case-scoped external-auditor grant, mock/manual/unavailable tracker states and mock-only past-due billing. All addresses use `pilot.example.test`; all evidence says synthetic; biometric-template count is zero.

Scenarios represent normal dispatch/return, late return, condition denial/hold, cargo/fuel/odometer differences, missing tracker data, two attributed gate overrides, blocked unapproved movement, independently approved investigation, held evidence, scoped external audit, analytics escalation and billing/provider degradation. These fixtures do not claim a live tracker, storage, email or payment provider.

## Acceptance evidence

- Guarded commands: `pilot:seed`, `pilot:reset`, `pilot:verify`, `pilot:test-boundaries`.
- Imports: ten CSV types, dry-run only, actor/result output, row errors, duplicate/tenant/required/formula/biometric checks and no invitations.
- UAT: 27 machine-validated cases with all execution, evidence, defect, retest and approval fields.
- Training: administrator, dispatch, security officer, approving manager, investigation, external auditor and support guides.
- Operations: onboarding checklist, risk/sign-off templates, 21 failure/recovery rehearsals, explicit online-only boundary and local rollback.
- Browser: pilot counts, least privilege, tenant isolation, external-auditor case scope, four gate orientations, keyboard order, names, headings, minimum targets, overflow, failure announcement and reconnect/reload.
- Existing full journeys: dispatch/approval/gate/evidence/reconciliation, exception/referral, investigation approval/holds/report, analytics review/dismiss/reopen/escalate, auditor revoke, billing and readiness.
- Defects: 0 open Critical, 0 open High, 0 open Medium, 0 open Low; two Medium findings were fixed and retested.
- Schema: no Phase 14 migration; the repository remains at 27 immutable migrations.

## Objective gate

Engineering passes only when the clean candidate completes Prisma format/validate/generate/status, empty replay, isolated backup/restore, TypeScript, ESLint, Vitest, production build, Playwright, seed/reset/import/UAT verification, secret scan, dependency audit, performance probe and Git checks twice. Production readiness must remain accurately blocked, the disposable container must run non-root and healthy, and no Critical/High defect may remain.

The final measured command totals and both pass records will be added after the stable committed gate. Local timings are regression evidence only, never a hosted capacity claim.

## External blockers and manual confirmations

Before real data or a real pilot, the business must provide/approve the customer identity and authorised representative; pilot/project/support/security/privacy/technical/escalation owners; real sites, gates, vehicles, trackers, drivers, users and history; hours, chains, thresholds and rule owners; support/SLA/incident/rollback terms; training and UAT signatories; Information Officer/PAIA/lawful bases/notices (including location and any future biometric processing); retention, backup, breach, offboarding, DPA and cross-border decisions; hosting, managed PostgreSQL, durable private storage, monitoring, scheduler, tracker, email and payment providers; sandbox proof, contracts and credentials; and the controlled synthetic-to-real import plan.

## Explicit non-events

No deployment, production migration, production database access, cloud resource, external account, paid service, legal-term acceptance, external message/invitation, payment, tracker connection, real credential, real customer/employee/driver data, real document or recoverable biometric material is part of Phase 14A. Local readiness is not production approval.

# Phase 14A local pilot acceptance and readiness report

Date: 2026-08-12

Scope: local engineering release candidate only

Decision: LOCAL ENGINEERING GATE PASSED; NOT AUTHORISED FOR REAL PILOT OR DEPLOYMENT

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

## Final verification result

The complete 21-step release-candidate gate passed twice at executable candidate commit `9811742`. Gate A ran 14:54:00-15:16:54Z (22.9 minutes): Vitest 275.0 seconds, build 154.9 seconds and Playwright 450.6 seconds. Gate B ran 15:17:09-15:34:16Z (17.1 minutes): Vitest 212.4 seconds, build 87.6 seconds and Playwright 353.0 seconds.

Both passes confirmed package integrity; Prisma format/validate/generate/status; empty replay and isolated restore of all 27 migrations; TypeScript; ESLint; 76 Vitest files / 818 tests; the Next 16.3.0 build with 104/104 generated pages; 19/19 serial Chromium tests; pilot seed/reset/idempotency and invariant counts; all ten imports; all 27 UAT cases; secret/environment scan; zero dependency vulnerabilities; expected fail-closed production readiness; bounded exact-pilot performance; and a clean tree at both ends. The earlier attempted gate correctly failed when the complete investigation workflow exceeded its old 180-second total budget under full-gate load; its locator timeouts stayed bounded, its justified total became 240 seconds, it passed focused at 2.9 minutes, and both full final gates passed afterward.

The separate container smoke built `genbridge-governance:phase14a-local`, ran as `nextjs`, returned `{"status":"ok"}` without a production-data connection, and removed its fixed smoke container. Local pilot queries covered 15 vehicles/drivers, 9 movements, 14 gate events, 4 exceptions, 5 reconciliations, 2 cases, 6 indicators, 30 documents and 3 media records. Warm bounded reads were generally tens to low hundreds of milliseconds; cold connection/setup was slower. These are local regression observations only, never a hosted capacity claim; browser rendering, report/export throughput and concurrency require target-environment testing.

## External blockers and manual confirmations

Before real data or a real pilot, the business must provide/approve the customer identity and authorised representative; pilot/project/support/security/privacy/technical/escalation owners; real sites, gates, vehicles, trackers, drivers, users and history; hours, chains, thresholds and rule owners; support/SLA/incident/rollback terms; training and UAT signatories; Information Officer/PAIA/lawful bases/notices (including location and any future biometric processing); retention, backup, breach, offboarding, DPA and cross-border decisions; hosting, managed PostgreSQL, durable private storage, monitoring, scheduler, tracker, email and payment providers; sandbox proof, contracts and credentials; and the controlled synthetic-to-real import plan.

## Explicit non-events

No deployment, production migration, production database access, cloud resource, external account, paid service, legal-term acceptance, external message/invitation, payment, tracker connection, real credential, real customer/employee/driver data, real document or recoverable biometric material is part of Phase 14A. Local readiness is not production approval.

## Phase 15A addendum — historical Phase 14 evidence unchanged

Phase 15A does not reinterpret the Phase 14A gate or claim human acceptance. It adds a separate digest-bound execution mechanism for the same 27 cases, case-by-case automated/manual/provider/legal/business classifications, a tracker simulator/conformance gate, mapping/provenance controls and a non-deploying staging plan/checker. Human execution events and signatures remain zero until authorized representatives actually run them. Migrations 28–29 are Phase 15 changes and do not alter the recorded 27-migration Phase 14 evidence.

The Phase 15A executable candidate `c9df227` subsequently passed two consecutive 25-step local release
gates: 17:45:48-18:03:57Z and 18:04:56-18:19:20Z. Both passes covered all 29 migrations, 81 Vitest files /
858 tests, 104/104 generated pages, 25/25 provider-conformance checks, the 27-case execution pack with zero
human events, 20/20 Chromium tests, secret and dependency scans, expected fail-closed readiness, local
performance and non-root container liveness. A prior attempted gate was discarded after a transient full-
gate unit-step exit; the same full suite immediately passed standalone without a code change, and the
consecutive count was restarted. This is engineering readiness evidence only: staging remains unprovisioned
and blocked on named approvals/configuration, provider interoperability remains untested, and human UAT
remains unexecuted.

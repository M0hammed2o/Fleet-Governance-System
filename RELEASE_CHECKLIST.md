# Release checklist

## Before approval

- [ ] Change set reviewed; working tree and staged diff contain no unrelated files, `.env`, dumps, reports or secrets.
- [ ] Hosting, managed PostgreSQL, durable private storage, scheduler, monitoring, email, billing and required tracker providers are approved and contracted.
- [ ] Information Officer, PAIA manual, privacy notices/lawful basis, provider DPAs, retention/backup periods, breach contacts and pilot owner are confirmed.
- [ ] Production variables are supplied from a secret manager; current/previous key state is understood.
- [ ] `APP_ENV=production npm run production:check` exits 0 and the authenticated readiness page shows no release blocker.
- [ ] Managed backup succeeded and a recent isolated restore drill is evidenced.

## Verification gate

- [ ] `npm ci` and package/lockfile diff check
- [ ] `npm run security:scan`; no tracked `.env`, key file or client-prefixed private variable
- [ ] `npx prisma format --check`
- [ ] `npx prisma validate`
- [ ] `npx prisma generate`
- [ ] `npx prisma migrate status`
- [ ] `npm run verify:clean-migrations` against disposable local/test PostgreSQL
- [ ] `npm run verify:backup-restore` against explicitly validated local test PostgreSQL
- [ ] `npx tsc --noEmit`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npx playwright test`
- [ ] `npm audit --audit-level=low`
- [ ] `npm run performance:pilot` results reviewed as local regression evidence only
- [ ] Docker build, non-root user and liveness health check verified locally
- [ ] Entire gate passed twice from stable source

## Release

- [ ] Maintenance/change window and rollback owner approved; jobs paused.
- [ ] Pre-release backup reference recorded securely.
- [ ] `npx prisma migrate deploy` run once through direct connection; status verified.
- [ ] Immutable image digest deployed with no build-time secrets; graceful drain configured.
- [ ] Jobs resumed one at a time; duplicate/overlap and provider delivery monitored.

## Post-release smoke test

- [ ] Public liveness and safe readiness return expected status with no sensitive detail.
- [ ] Platform administrator can open authenticated diagnostics; ordinary tenant user receives 403.
- [ ] Login succeeds, invalid login is generic, secure cookie/session expiry/revocation work.
- [ ] Tenant isolation spot-check with approved synthetic/non-sensitive accounts.
- [ ] Create/approve/gate/reconcile workflow and permission denial verified without external messages.
- [ ] Private upload/signed download/expiry/hold behavior verified with approved test content.
- [ ] Tracker source/freshness labels are honest; email/billing synthetic actions are unavailable in production.
- [ ] Billing webhook authenticity/idempotency and amount/currency rejection checks observed in sandbox only.
- [ ] One authenticated idempotent job run succeeds and appears in diagnostics.
- [ ] Logs/alerts/correlation IDs arrive redacted; backup monitoring is healthy.

If any security, isolation, migration, backup, provider-authenticity or data-integrity check fails, stop/roll back under `OPERATIONS_RUNBOOK.md`. Never weaken a control to complete a release.

## Phase 14A local pilot acceptance (not deployment approval)

- [ ] `npm run pilot:rc` passes twice from the same clean commit; expected blocked production readiness is recorded.
- [ ] `npm run pilot:docker:smoke` confirms the disposable image runs non-root and returns minimal liveness.
- [ ] Synthetic counts/invariants, idempotent reset and preservation of unrelated tenants pass.
- [ ] All ten import templates and all 27 UAT catalogue entries validate.
- [ ] Pilot Playwright and the established dispatch/gate/reconciliation, investigation, analytics, external-audit, billing and readiness workflows pass.
- [ ] No Critical/High pilot defect is open; accepted Medium/Low risks have an owner/expiry.
- [ ] Role guides, onboarding checklist, support rehearsals, evidence rules, online-only limitation and rollback criteria are reviewed.
- [ ] Named owners, real pilot facts, legal/POPIA decisions, providers, credentials and human UAT/sign-off remain `MANUAL_CONFIRMATION_REQUIRED` until actually supplied.

## Phase 15A non-deploying staging candidate

- [ ] Approved immutable commit, clean tree and 29-migration forward/rollback plan recorded.
- [ ] `tracker:conformance`, simulator/mapping/provenance/security tests and all 27 rehearsal classifications pass.
- [ ] UAT catalogue and separately initialized execution pack validate; human results/sign-off remain unclaimed.
- [ ] `staging:check` and `production:check` remain accurately blocked until every external approval is evidenced.
- [ ] Synthetic-only data, email/payment/tracker isolation, secrets inventory and no-real-data checks reviewed.
- [ ] `staging:rc` passes twice, including empty replay, restore, build, Playwright, audit, secret scan and non-root container health.
- [ ] Provider matrix/questionnaire/non-response contingency and business/legal decision register reviewed; no draft was sent.

## Phase 16A mobile candidate (not store/deployment approval)

- [ ] Two `npm run mobile:rc` runs pass from one clean immutable commit with all 30 migrations.
- [ ] Mobile TypeScript/lint/tests/config/export and four rendered priority journeys pass.
- [ ] Secure storage, revocation, exact origins, tenant/permission, idempotency, evidence and disconnected denial reviewed.
- [ ] Android/iOS identifiers and signing/privacy/release owners no longer say `MANUAL_CONFIRMATION_REQUIRED`.
- [ ] Android and iOS simulator/device matrices verify permissions, camera/files, storage, links, lifecycle, recovery and large text.
- [ ] Production auth/API origins, privacy/store declarations/assets/accounts/reviewer access and support/rollback are approved.
- [ ] No Critical/High mobile defect; lower risks have owner/expiry.
- [ ] Explicit authority exists before signing material, upload or publication.

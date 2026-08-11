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

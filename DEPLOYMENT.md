# DEPLOYMENT.md

## Phase 17A migration and activation

Migration `20260814143000_phase17a_biometric_lifecycle` is local-only until reviewed deployment authority exists. Roll back application code compatibly and use a new forward migration for corrections; never restore deleted biometric material or edit applied SQL. Production and staging biometric activation remain blocked by `facial:readiness`; the simulator is always refused in production.

## Local development (working as of 2026-07-19)
1. `docker compose up -d` — starts local Postgres 16 on host port **55490** (chosen to avoid colliding
   with other Postgres containers already running on this machine on 5432/55432/5434).
2. `npm install`
3. Copy `.env.example` to `.env` (already done in this repo checkout; values are dev-only, not secrets).
4. `npx prisma migrate deploy` — applies committed migrations to the local DB. **Do not use
   `prisma migrate dev`** to create *new* migrations in a non-interactive shell — it hard-errors. Hand-author
   the migration SQL under `prisma/migrations/<timestamp>_<name>/migration.sql`, then run
   `prisma migrate deploy` to apply and record it. (An interactive terminal can still use `migrate dev`
   normally.)
5. `npm run seed` — loads fictional demo data: platform tenant (`platform`) + demo tenant
   (`acme-logistics`) with one user per role, all sharing password `GateFleet!Dev1` (dev-only).
6. `npm run dev` — starts the app at http://localhost:3000.

Verification commands for a new session to confirm this state before trusting it:
`npm test` (10/10 should pass), `npx tsc --noEmit` (clean), `npm run build` (clean).

## Environment variables (documented in `.env.example`, no real values committed)
- `DATABASE_URL` — Postgres connection string.
- `SESSION_SECRET` — cookie-signing secret (dev placeholder only; real deployments need a generated
  secret managed outside the repo).
- `STORAGE_*` — object storage config (local/dev provider by default).
- `PAYMENT_PROVIDER` / `BILLING_EMAIL_PROVIDER` — Phase 10 billing provider selection; `"mock"` opts into
  the deterministic dev/test provider, any other value (including unset) is the honest no-op. No production
  payment gateway or email vendor is configured — see BILLING_AND_SUBSCRIPTIONS.md.

## Database migrations
Prisma migrations committed to `prisma/migrations/`. Never edit an applied migration file; add a new one.

## Storage configuration
Dev default: local filesystem/MinIO adapter. Production provider not yet chosen (Phase 7).

## Staging / Production
Not yet defined. Requires an explicit hosting/paid-service decision from the user before any account is
created (hard rule — irreversibility/external accounts). Will be filled in once that decision is made.

## Backups
Not yet implemented — no production data exists. Must be defined before any production deployment.

## Monitoring
Not yet implemented. Structured logging conventions to be added alongside the auth foundation (Phase 1).

## Rollback process
Not yet defined — depends on the hosting decision above.

## Phase 11 deployment notes

- Apply all 24 committed migrations with `npx prisma migrate deploy`; the newest adds the nullable unique
  active-referral key. Never edit an applied migration.
- Investigation notification and auditor-invitation providers default to no-op. A real delivery provider
  is a future explicit integration decision; no production message is sent today.
- Job entry points exist for overdue tasks, expiring external access, and failed-notification retry. They
  require `JOB_SCHEDULER_TOKEN`; no production scheduler is configured.
- Reports/evidence use the existing storage provider and signed raw-media route. Configure persistent
  object storage and HTTPS before any non-local deployment.
- Before deployment run Prisma format/validate/generate/status, clean migration replay, TypeScript, lint,
  all 735 tests, production build, and all 11 serial Playwright tests. Seed only local fictional data.
- BUG-010 remains a visible upstream adapter warning; do not suppress it or upgrade database packages
  solely to chase it. Re-run the documented trace after a planned Prisma/adapter upgrade.

## Phase 12 deployment notes

- Apply all 26 migrations in order. The two newest migrations add analytics enums/tables/indexes/foreign
  keys and then make the system-safe-default configurator nullable. They were applied only to local dev/
  test and replayed from empty; no production migration occurred.
- `analytics.calculateIndicators` is callable through `/api/jobs/analytics/calculate-indicators` or
  `npm run job -- analytics.calculateIndicators`. It requires `JOB_SCHEDULER_TOKEN`; no production
  scheduler is configured. Run it at an agreed tenant cadence after migration and monitor per-tenant
  `AnalyticsCalculationRun` results.
- Analytics reports use the existing object-storage provider. Production must supply durable storage,
  HTTPS, signed-URL configuration, backup/restore, and retention policy before customer use.
- Dashboard ranges are capped at 366 days; source queries at 10,000 rows, dashboard/list indicators at
  100, and CSV indicators at 5,000. Do not raise these limits as a substitute for warehouse/snapshot
  design when production volume is known.
- Rollback is application rollback plus a forward corrective migration. Do not drop indicator/rule/history
  tables or the appended enum value if customer review history exists.
- Phase 13 still needs explicit production decisions: hosting/database/storage, scheduler, tracker vendor
  and field semantics, message providers, monitoring/alerting, retention requirements, pilot reporting
  volume, and approved operating hours/threshold owners. No production credentials are present.
# Phase 13A deployment status (2026-08-11)

Provider-neutral artifacts now exist: `Dockerfile`, `.dockerignore`, non-deploying `.github/workflows/ci.yml`, typed runtime validation, `production:check`, health/readiness/authorized diagnostics, guarded backup restore, scheduler manifest, release checklist and operations runbook. `next.config.ts` emits a standalone build. No production environment, account, credential, scheduler or deployment was created.

Use `PRODUCTION_READINESS_AND_PROVIDER_INTEGRATIONS.md`, `OPERATIONS_RUNBOOK.md` and `RELEASE_CHECKLIST.md` as the current instructions; the older “not implemented” backup/monitoring paragraphs above describe the historical baseline. Production remains blocked until an approved durable provider set, legal/pilot confirmations, monitored backup/restore and a zero-exit production readiness report exist. There are 27 migrations; the Phase 13 migration adds privacy-preserving authentication-attempt throttling and bounded notification retry fields/indexes. Rollback is application rollback plus forward corrective migration—never edit applied SQL or drop audit/customer history.

# Phase 14A deployment boundary

Phase 14A adds no migration and deploys nothing. `pilot:seed`, `pilot:reset`, `pilot:test-boundaries`, `pilot:rc` and `pilot:docker:smoke` are local-only tools. Never run the synthetic generator as a substitute for production onboarding and never copy its accounts, password, media or UAT evidence into a hosted tenant. A real pilot requires a clean production checker, approved infrastructure/providers, controlled migration/backup evidence, named owners, completed human UAT and signed privacy/security/business acceptance. Rollback during local UAT is exact synthetic-tenant reset plus return to the last verified commit; a future real pilot needs its own approved data-preserving plan.

# Phase 15A staging boundary

Phase 16A adds an unsigned local Capacitor bundle and migration 30 for mobile receipts/read state; nothing was deployed or published. A future migration follows the normal reviewed forward/backup process and rollback uses compatible application rollback plus forward correction—never edited SQL or dropped history.

Native generation stays blocked until Android/iOS identifiers are approved. Production requires HTTPS `VITE_API_BASE_URL`, exact `MOBILE_TRUSTED_ORIGINS`, approved auth/redirects, privacy/store material, managed signing, Android SDK/JDK and macOS/Xcode for iOS. No signing secret belongs in Git. `mobile:export` is not an APK/AAB/IPA. Follow `MOBILE_RELEASE_CHECKLIST.md`.

# Phase 16B Android deployment boundary

The generated Android source and an ignored local debug APK now exist. This changes no deployment status.
`za.co.genbridge.fleet` is local-only; release tasks deliberately reject it and debug mixed-content/logging.
No AAB, managed signing, store account, hosted API, native production authentication or publication was
created. Before any Android release, approve the final ID and HTTPS/native CORS, run a production-mode sync,
inspect the merged release manifest/AAB, complete native device/security/privacy/UAT gates and use signing
material only from the approved secret system. Follow `ANDROID_DEVELOPMENT_SETUP.md` and
`MOBILE_RELEASE_CHECKLIST.md`.

`STAGING_ENVIRONMENT_PLAN.md` is design only. `APP_ENV=staging` validates hosted HTTPS, explicitly staging-named managed PostgreSQL URLs, TLS, strong secrets, durable private storage and isolated/disabled providers. `npm run staging:check` remains non-zero until manual approvals/evidence exist; `npm run staging:rc` is a local non-deploying verification gate. Migrations 28–29 add mapping/provenance and hard constraints/backfill. Apply later only via reviewed `prisma migrate deploy`; rollback is compatible application rollback plus forward correction, never editing applied SQL or deleting mapping/event history.

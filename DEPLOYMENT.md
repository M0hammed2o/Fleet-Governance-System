# DEPLOYMENT.md

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

# Gate Fleet Governance

Multi-tenant SaaS platform that controls and records vehicle entry/exit at business sites: driver/vehicle
identity verification, pre-approved movement authorisation, guided vehicle inspection, photo/video
evidence, exception/approval workflows, and (planned) departure-vs-return reconciliation and governance
reporting.

This README is an entry point. For anything beyond "how do I run this locally," read the project memory
docs — they are the source of truth, not this file:

- **`PROJECT.md`** — product identity, current status, how to resume work in a new session
- **`ARCHITECTURE.md`** — stack, tenant-isolation strategy, auth, audit, gate-operations/media architecture
- **`DATA_MODEL.md`** — every entity, migration history
- **`PRODUCT_REQUIREMENTS.md`** — requirement IDs, acceptance criteria, implementation status, role matrix
- **`TESTING.md`** — mandatory security gates and their current pass/fail status, how to run tests
- **`TODO.md`** — the live task list (Now / Next / Later / Blocked)
- **`WORKLOG.md`** — session-by-session log of what was actually done
- **`DECISIONS.md`** — every non-obvious design decision and why
- **`SECURITY_AND_POPIA.md`** — security controls, data classification, items flagged for legal review
- **`DEPLOYMENT.md`** — environment variables, local dev setup, migration workflow

## Local development

Prerequisites: Node.js, Docker (for local Postgres).

```bash
docker compose up -d              # starts local Postgres on host port 55490
npm install
cp .env.example .env               # dev-only placeholder values, no real secrets
npx prisma migrate deploy          # apply committed migrations
npm run seed                       # fictional demo tenant, 9 roles, drivers/vehicles/movements/gate events
npm run dev                        # http://localhost:3000
```

`prisma migrate dev` does not work in a non-interactive shell in this environment — see `DATA_MODEL.md`
"Note for future schema changes" for the workaround (hand-author the migration SQL, then
`prisma migrate deploy`).

Seeded accounts all share the dev-only password `GateFleet!Dev1` (see `prisma/seed.ts` — this script
refuses to run against anything that isn't `localhost`/`127.0.0.1` or with `NODE_ENV=production`).

## Verification

```bash
npx tsc --noEmit    # TypeScript
npm run lint        # ESLint
npm test            # Vitest — spins up a separate test DB via the pretest hook
npm run build       # production build
```

No feature in this codebase is reported complete without these four passing, plus a manual live
verification of the actual workflow (see `WORKLOG.md` entries for what "manually verified" means in
practice — real `curl` calls against a running dev server, not simulated output).

## Status

See `PROJECT.md` "Current project status" and `TODO.md` for what's actually built versus planned. In
short: Foundation, Master Data, Gate Operations, Evidence/Media, and role realignment (Phases 1-5A) are
built and tested. Reconciliation, dispatch enhancements, telematics foundation, and the platform
support-access view (Phases 5B-7) are in progress or planned.

Phase 15A now provides provider-independent tracker simulation/conformance, effective-dated mapping/provenance, separate human UAT execution support and non-deploying staging preparation. See `PROJECT.md`, `TRACKER_PROVIDER_REQUIREMENTS_AND_ONBOARDING.md`, `HUMAN_UAT_EXECUTION_GUIDE.md` and `STAGING_ENVIRONMENT_PLAN.md`. No live provider or deployment is configured.

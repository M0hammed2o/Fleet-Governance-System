# PROJECT.md — Gate Fleet Governance

## Product identity
**Gate Fleet Governance** is the first product of a new software company building governance-focused
enterprise applications for large businesses and large family-owned companies. It controls and records
vehicle entry and exit at business sites: driver/vehicle identity verification, approved-movement
matching, guided vehicle inspection, photo/video evidence, departure-vs-return reconciliation,
exception/approval workflows, and a governance layer (risk register, control register, audit history).

## Business purpose
Replace ad-hoc gate logbooks and unverifiable paper inspections with a system that produces a complete,
tamper-evident record of who inspected what, what was found, who approved exceptions, and whether a
vehicle was cleared or denied — usable as evidence in operational, safety, and compliance reviews.

## User types
Platform-side: Platform Administrator, Platform Support Analyst (Phase 7). Customer-side, six primary
roles: Company Administrator, Dispatch and Logistics Officer, Gate Security Officer, Security Supervisor /
Approving Manager, Fleet and GPS Manager, Accountant / Finance and Compliance Officer. Plus three
additional non-daily profiles: Internal Investigator / Auditor, External Reviewer, Executive Read-Only
Viewer. See `PRODUCT_REQUIREMENTS.md` "Roles — nine-role structure" and DECISIONS.md D-015 for the full
mapping and rationale (remapped 2026-07-23 from an earlier 8-role set).

## High-level product boundaries
- Multi-tenant SaaS: each tenant is a company; strict data isolation between tenants is a release-blocking
  requirement (see `SECURITY_AND_POPIA.md`).
- The system assists authorised humans with decisions. It does **not** make automated legal, disciplinary,
  or safety conclusions, and does not run a custom facial-recognition or damage-detection model — those
  are external provider integrations behind adapter interfaces (see `INTEGRATIONS.md`).
- Movement/delivery authorisation happens *before* the gate; gate security verifies against the approved
  record rather than re-capturing cargo/delivery data.

## Current project status
**Phases 1–8 complete** — Phase 8 (Pilot Hardening, Cost-Efficient Evidence Storage and Retention
Management: 8A engineering hardening, 8B cost-efficient object-storage architecture, 8C retention/archive/
deletion, 8D platform and customer storage dashboards) finished 2026-07-26. See WORKLOG.md Sessions 13-16
and TODO.md "Now" for current detail — the paragraph below is a stale narrative snapshot from an earlier
phase, kept for history; WORKLOG.md/TODO.md are the source of truth. Next planned work: Phase 9 (on-device
one-to-one facial verification and basic liveness with a cloud fallback interface).
Repository was empty (greenfield) as of 2026-07-19. Foundation (auth/permissions/audit), master data
(drivers/vehicles/documents/tyre config/movement authorisation), gate operations (GateEvent state
machine, guided inspection, exceptions, security dashboard), evidence/media (secure upload, signed-URL-
only reads, checksum + idempotency protection), and the nine-role structure (DECISIONS.md D-015) are all
built and tested — 294/294 automated tests passing as of 2026-07-23. First Git checkpoint created
2026-07-23 (`c5e5d33`, then subsequent commits — see `git log`); the repository had zero commits before
that session despite four phases of prior work. Target: a controlled real-customer V1 pilot by October
2026, per the user's 2026-07-23 instruction, which also authorised extending scope with a telematics
foundation, vehicle-use policies, dispatch enhancements, and a platform support-access view (Phases
5C/6/7) — see `PRODUCT_REQUIREMENTS.md` and `DECISIONS.md` D-015/D-016. See `WORKLOG.md` for the
session-by-session log and `TODO.md` for the live task list — those two files are the source of truth for
"what's actually done" over this document's narrative summary, which is not kept current every session.

## How a new Claude session should resume work
1. Read this file, then `TODO.md` (Now/Next/Blocked sections) and the tail of `WORKLOG.md`.
2. Check `DECISIONS.md` for architecture/scope decisions already made — do not re-litigate them.
3. Run the verification commands in `TESTING.md` / `DEPLOYMENT.md` (local dev section) to confirm the
   repo is in the state WORKLOG.md claims before making changes.
4. Continue from the "Remaining work" / "Exact recommended next action" of the last WORKLOG.md entry.
5. Follow the phase sequence in this file's product boundaries section and in the original build brief —
   do not jump ahead to later phases while earlier-phase acceptance criteria are unmet.

## Repository anomaly (informational)
On 2026-07-19 the git repo actually rooted at the user's Windows home directory (`C:/Users/junsm`) was
found to be empty of commits but tracking the entire profile. This project uses its own dedicated git
repo initialised at the project root (`Enterprise Governance Platform/.git`) instead; the home-directory
repo was left untouched. Not this project's concern unless it recurs.

## Current status addendum — 2026-08-11

**Phases 1–11 are complete.** Phase 11 adds tenant-scoped investigation and internal-review case
management, immutable operational-record referrals, evidence holds, append-only notes and chronology,
versioned findings with independent approval, stored PDF reports, scheduled notification entry points,
and a dedicated case-scoped external-auditor portal. The canonical operating guide is
`INVESTIGATIONS_AND_EXTERNAL_AUDIT.md`; Session 21 in `WORKLOG.md` records verification evidence.

The Phase 11 gate was 64 Vitest files / 735 tests, a clean Next 16 production build, and 11 Playwright
tests, including the complete investigation lifecycle and referral/source-immutability workflows.

**Phase 12 is complete.** It adds a permission-controlled executive/operational analytics dashboard,
tenant-local filters, 12 configurable deterministic risk rules, immutable version/threshold snapshots,
materialised explainable indicators, append-only review/dismissal/reopen/escalation chronology, aggregate
investigation analytics, explicit mock/manual/unavailable tracker classification, bounded CSV/PDF exports,
and an idempotent tenant-by-tenant calculation job. The canonical guide is
`GOVERNANCE_ANALYTICS_AND_RISK_INDICATORS.md`. No production provider, scheduler, deployment, or opaque
accusation model was added.

The Phase 12 final gate is 68 Vitest files / 765 tests, a clean Next 16 production build with 103/103
static pages, and 14 Playwright tests. The complete gate passed twice after the final code change.
# Phase 13A checkpoint (2026-08-11)

Provider-neutral production readiness is implemented locally: typed fail-closed configuration, terminal readiness report, safe health/diagnostics and platform UI, managed-PostgreSQL connection controls, guarded backup/restore proof, durable-storage contract, tracker/email/payment contracts, authenticated bounded jobs, structured redaction, login throttling, security headers/CSRF, non-deploying CI and non-root container artifacts. Real hosting/providers, legal confirmations, credentials, production migration and pilot approval remain external blockers; see `PRODUCTION_READINESS_AND_PROVIDER_INTEGRATIONS.md`.

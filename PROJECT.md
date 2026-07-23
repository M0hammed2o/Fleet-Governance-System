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
Platform Administrator, Company Administrator, Security Manager, Gate Security Officer, Fleet Manager,
Approving Manager, Risk/Compliance Manager, Internal Auditor, Executive Viewer. See
`PRODUCT_REQUIREMENTS.md` for granular permissions per role.

## High-level product boundaries
- Multi-tenant SaaS: each tenant is a company; strict data isolation between tenants is a release-blocking
  requirement (see `SECURITY_AND_POPIA.md`).
- The system assists authorised humans with decisions. It does **not** make automated legal, disciplinary,
  or safety conclusions, and does not run a custom facial-recognition or damage-detection model — those
  are external provider integrations behind adapter interfaces (see `INTEGRATIONS.md`).
- Movement/delivery authorisation happens *before* the gate; gate security verifies against the approved
  record rather than re-capturing cargo/delivery data.

## Current project status
**Phases 1–4 complete; Phase 5 (Reconciliation) not yet started.** Repository was empty (greenfield) as of
2026-07-19. Foundation (auth/permissions/audit), master data (drivers/vehicles/documents/tyre config/
movement authorisation), gate operations (GateEvent state machine, guided inspection, exceptions,
security dashboard), and evidence/media (secure upload, signed-URL-only reads, checksum + idempotency
protection) are all built and tested — 286/286 automated tests passing as of 2026-07-22. See `WORKLOG.md`
for the session-by-session log and `TODO.md` for the live task list — those two files are the source of
truth for "what's actually done" over this document's narrative summary, which is not kept current every
session.

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

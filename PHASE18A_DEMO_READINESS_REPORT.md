# Phase 18A demo readiness report

Date: 2026-08-17. Baseline: `6fd692712cb823738f37273df8d7595a97383587` on `master` with matching private `origin/master`.

## Baseline assessment

The system already had tenant-scoped custom sessions and RBAC; Company, User, Role, Site/Gate, Driver and Vehicle records; compliance documents; private `MediaAsset` storage and short-lived signed reads; gate/inspection/exception/reconciliation/investigation/audit workflows; deterministic analytics; synthetic tracker provenance; and synthetic facial-verification/fallback controls. It did not have self-service demo provisioning, saved company onboarding, declared-fleet reconciliation, effective-dated driver assignments, guard approval/placement metadata, profile/vehicle media lifecycle, the requested richer master-data fields, a driver rating presentation, or the customer-ready management dashboard.

## Fully implemented for the controlled demo

- Atomic registration of tenant, role catalogue, first approved administrator, session, onboarding and audit, with generic duplicate handling and existing login throttling.
- Eight-step resumable onboarding, declared-versus-loaded fleet reconciliation and readiness summary.
- Expanded vehicle categories and conditional fields/validation; richer driver/licence/permit data.
- Private driver/vehicle/staff images and compliance-document attach/view/replace/delete with tenant checks, signature/extension/size validation, path rejection, image re-encoding/metadata removal and audit.
- Effective-dated, serializable, database-constrained assignments; explicit reassignment, reasons and immutable history.
- Local staff invitation, existing role summaries, guard site/gate placement, independent approval with mandatory reason, self-approval prevention and gate-duty enforcement.
- Responsive management dashboard, driver/vehicle drill-down, accessible textual/icon states, deterministic explainable rating rule and action guidance.
- Deterministic synthetic seed/reset with multiple categories, two truck capacities, green/yellow/red drivers, two guard states, staff roles, expiry, gate/exception/investigation and tracker fixtures.

## Demonstration/synthetic only

Registration, sample accounts/data, images, tracking and all facial scenarios are controlled demonstration facilities. External email remains disabled. The facial simulator is not recognition and uses no face-derived material. Tracking labels distinguish synthetic/manual/unavailable data and never imply a live provider.

## Requires physical-device testing

Phase 18A changes are web/backend master-data and dashboard work, not a new Android guard workflow. No connected physical Android result is claimed here. Existing Phase 17B device-install and native interaction checks remain required before any device claim.

## Requires tracking-provider access

Live position, webhook interoperability, provider asset mapping and commercial service levels require a separately approved provider sandbox/account and conformance run. No provider was connected.

## Requires legal or operational approval

Production terms, privacy notices, POPIA roles, retention, document/identity handling, guard approval policy, rating governance, incident response, provider contracts and real-data authorization require named business/legal owners.

## Not production-ready

Self-service registration is deliberately production-disabled. CSV import is intentionally deferred so it cannot weaken the manual demonstration. Real email, production identity/federation, provider tracking, real facial verification, hosted capacity/backup/monitoring evidence, final Android signing/identity and physical-device acceptance are not included. No deployment or publication occurred.

## Verification record

Phase 18A adds focused tests for environment refusal, registration/provisioning/rollback, onboarding reconciliation, conditional vehicle and licence rules, upload identity, tenant isolation, assignments/history, guard separation, rating states/explanations and UI warning/accessibility/responsive contracts. Final command results and immutable commit hashes are appended to `TESTING.md` and the completion report only after execution; a stopped local Docker service must never be misreported as a passing database gate.

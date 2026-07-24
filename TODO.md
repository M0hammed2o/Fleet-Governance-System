# TODO.md

## Now
- [ ] Begin Phase 7 (Platform support-access view): SUPPORT-001 (platform customer list with health/status
      summary — subscription/payment status, sites/gates/vehicle/user counts, open critical exceptions,
      GPS/facial-verification provider status, storage usage, failed integrations, last activity,
      onboarding status, support notes, real DB-backed), SUPPORT-002 (`SupportAccessSession` model —
      auditable actor/customer tenant/reason/ticket ref/start/end, time-limited, see DECISIONS.md D-016),
      SUPPORT-003 (controlled support view — banner, read-only by default, mandatory reason, immediate
      exit, no credential/session exposure, no default biometric/investigation-case access), SUPPORT-004
      (tenant isolation + access-expiry tests). This is the last phase in the current run — subscription
      billing and full investigation-case management are explicitly out of scope, next planned work after
      this. | Priority: high | Deps: none — Phase 6 is complete

## Revised build order (2026-07-23, per user instruction — target: October 2026 pilot)
Phase 5A (role realignment) — **done**, see WORKLOG.md Session 7. Phase 5B (Reconciliation) — **done**, see
WORKLOG.md Session 9 / DECISIONS.md D-017/D-018. Phase 5C (Dispatch workflow enhancements) — **done**, see
WORKLOG.md Session 10. Phase 6 (Telematics foundation + basic geofencing) — **done**, see WORKLOG.md
Session 11 / DECISIONS.md D-019/D-020. Next and final phase of this run: Phase 7 (Platform support-access
view — SUPPORT-001..004). Subscription billing and full investigation-case management are explicitly out
of scope for this run — next planned work after Phase 7. Full requirement detail in
PRODUCT_REQUIREMENTS.md.

## Next
- [ ] Driver-portrait and compliance-document-attachment upload UI — both are fully wired end-to-end at the
      API layer (`PATCH /api/drivers/[id]` with `portraitMediaAssetId`, `POST
      /api/compliance-documents/[id]/attachment`) and curl-verified, but there's no admin-page form yet
      (only the gate check-in inspection-evidence upload got a UI affordance in Phase 4, per the brief's
      explicit scope — see DECISIONS.md D-012) | Priority: medium | Deps: none
- [ ] Extend audit-on-read beyond MediaAsset to other Restricted-classified reads (e.g. viewing a Driver's
      licence/PDP detail) — SECURITY_AND_POPIA.md flags this as a general target; Phase 4 only closed the
      gap for media (DECISIONS.md D-014) | Priority: low | Deps: none
- [ ] Gate check-in UI polish: the guided-inspection page (`/gate/events/[id]`) is functionally complete (every state, every action, including Phase 4's per-item evidence upload) but has no dedicated Playwright e2e spec yet — `playwright.config.ts` has been wired since Phase 1 for exactly this and still has zero specs; worth adding one full-lifecycle spec now that a stable UI exists to drive | Priority: medium | Deps: none
- [ ] Inspection template admin UI — API routes exist and are tested (`/api/admin/inspection-templates`, `.../new-version`) but there's no admin page yet to create/version templates or manage the `ExceptionType` catalogue (`/api/admin/exception-types`); currently only usable via curl/API or the one seeded default template | Priority: medium | Deps: none
- [ ] Vehicle create/edit UI: tyrePositionConfigId picker and inline tyre (VehicleTyre) editing on the vehicle detail page — API routes already exist and are tested (`POST /api/vehicles/[id]/tyres`), just no UI affordance yet | Priority: low | Deps: none
- [ ] Per-trip distance accumulation for the vehicle-use-policy km-limit check — `evaluateVehiclePolicyCompliance()` currently passes `tripKmSoFar: null` (no trip-boundary tracking wired up yet), so `kmLimitPerTrip` never actually fires; needs a trip-start reference (likely the vehicle's last EXIT GateEvent or last policy-reset point) to compute a real running total — see ARCHITECTURE.md "Telematics architecture" and DECISIONS.md D-020's revisit condition | Priority: medium | Deps: none
- [ ] Manual GPS confirmation and geofences UI affordance on the vehicle detail page itself (currently reachable via `/admin/geofences`, `/admin/vehicle-use-policies`, and the API directly, but not from the vehicle detail page where a Fleet/GPS Manager would naturally look) | Priority: low | Deps: none
- [ ] MediaAsset retention-purge / hard-delete mechanism (POPIA erasure) — no delete path exists yet for any owner kind; `StorageProvider.delete()` is implemented but unwired to any route | Priority: low | Deps: legal review of retention granularity (see existing "Retention-purge scheduled job" item below)
- [ ] FOUND-003 — Password reset flow | Priority: medium | Deps: none to build (dev-mode token-in-response, same pattern as invite), email provider only needed for production delivery | Design: SECURITY_AND_POPIA.md
- [ ] FOUND-010 — Reauthentication requirement for defined sensitive actions | Priority: low | Deps: first genuinely sensitive Phase 3+ action to attach it to (e.g. high-severity exception override) | Design: SECURITY_AND_POPIA.md
- [ ] SEC-2 — Add Postgres RLS as defense-in-depth on top of app-layer tenant scoping | Priority: medium | Deps: hosting decision
- [ ] Break-glass audited support-access mechanism for Platform Administrator (explicitly NOT granted by default — see DECISIONS.md D-005) | Priority: medium | Deps: none, but should land before any real customer tenant is onboarded
- [ ] Automated test asserting the audit_logs UPDATE/DELETE Postgres trigger actually fires (currently only manually verified via psql) | Priority: low | Deps: none
- [ ] Rate-limiting infrastructure (first real caller would be password-reset request endpoint once built) | Priority: low | Deps: none
- [ ] Scheduled job to auto-transition APPROVED movements past `expectedDepartureAt` to EXPIRED (repository function `expireMovement` exists and is tested; nothing calls it on a schedule yet) | Priority: low | Deps: none

## Later
- [ ] GATE-003 production — production facial-verification vendor integration (interface + mock already done, now wired into the gate flow too) | Deps: vendor selection (blocked)
- [ ] Object-storage production vendor integration (interface + local-filesystem dev implementation already done, Phase 4) | Deps: vendor selection (blocked)
- [ ] GOV-001..003 — Governance module | Deps: none (can start once Foundation is stable)
- [ ] Retention-purge scheduled job honouring `Tenant.retentionDays` | Deps: legal review of retention granularity
- [ ] MFA (TOTP) enrolment/verification | Deps: none — schema already ready (`User.mfaEnabled`/`mfaSecret`)
- [ ] Promote `Driver.department` from a plain string to a real Department entity if department-level reporting/permissions are ever needed (D-006) | Deps: none, only if requested

## Blocked
- [ ] Facial-verification production provider selection | Needs: user decision on vendor + budget approval
- [ ] Telematics production provider selection | Needs: user decision on vendor + budget approval
- [ ] Production hosting/deployment | Needs: user decision on Supabase vs self-managed, paid-service approval

## Completed recently
- [x] Phase 6: Telematics foundation, basic geofencing, vehicle-use policies (GPS-001..006/GPS-BLOCKED,
      POLICY-001/002) — `TelematicsProvider`/`MockTelematicsProvider` (provider-neutral, GPS-BLOCKED
      recorded), `ManualGpsConfirmation` (mirrors facial-verification fallback), `Geofence` (simple
      circle), `VehicleUsePolicy`/`VehicleUsePolicyVehicle` (full POLICY-001 field list), pure
      `geofence-engine.ts` compliance evaluation, `Exception.gateEventId` made nullable +
      `Exception.vehicleId` added so telematics/policy violations reuse the same Exception table/workflow
      (D-020) — 374/374 tests passing (41 new), tsc/lint/build clean, live curl verification incl. a real
      geofence-violation Exception raised end-to-end and a provider-unavailable 503 (not a raw 500) —
      2026-07-24
- [x] Phase 5C: Dispatch workflow enhancements (DISPATCH-001..005) — `MovementType` extended
      (SALES_VISIT/SERVICE/AUTHORISED_PRIVATE_USE), sender/recipient fields, `MOVEMENT_DOCUMENT` MediaAsset
      owner type reusing the existing upload/signed-URL routes unchanged, plain nullable
      `vehicleUsePolicyId` (upgraded to a real FK once VehicleUsePolicy exists in Phase 6), dispatch UI
      improvements (movements list create form + detail-page document upload/list, no separate screen) —
      333/333 tests passing (11 new), tsc/lint/build clean, live curl verification incl. the
      mediaAsset:VIEW visibility boundary (Executive Read-Only Viewer sees zero documents) — 2026-07-24
- [x] Phase 5B: Reconciliation (RECON-001..003) — `Reconciliation`/`ReconciliationDiscrepancy` models,
      chronological (not hardcoded-direction) departure/return pairing with duplicate/reversed/mismatched
      protection (DECISIONS.md D-017), pure discrepancy-comparison engine generic over the existing
      InspectionSection/unit taxonomy, HIGH discrepancies raise a real Phase 3 Exception (D-018), mandatory-
      explanation resolve workflow, reconciliation list/detail admin UI, auto-build wired into
      `completeGateEvent`, manual retry API — 322/322 tests passing (28 new), tsc/lint/build clean, full
      live curl verification incl. two-different-gates pairing, wrong-role/missing-explanation/already-
      resolved/suspended-user 4xx paths (no 500s) — 2026-07-24
- [x] Phase 5A: remapped the 8 seeded roles onto 9 (six primary customer roles + three additional
      profiles, DECISIONS.md D-015) — `prisma/seed.ts` TENANT_ROLE_DEFINITIONS rewritten, fictional demo
      users/emails updated, local dev DB dropped/recreated to clear orphaned old-role rows, 8 new
      segregation-of-duties tests (`tests/role-segregation.test.ts`), live curl regression check that
      Fleet and GPS Manager (ex-"Fleet Manager") can no longer create movements — 294/294 tests passing,
      tsc/lint/build clean — 2026-07-23
- [x] Recovery checkpoint: completed the interrupted Phase 4 independent verification (corrected
      `checksumSha256` column name, confirmed file/checksum match, full tsc/lint/test/build re-run) and
      created the repository's first two Git commits (`c5e5d33` baseline, `7e2a455` docs) — the repo had
      zero commits despite four completed phases — 2026-07-23
- [x] Phase 4: MediaAsset model (polymorphic ownerType/ownerId, DECISIONS.md D-011), StorageProvider
      interface + local-filesystem dev implementation, HMAC-signed time-limited read URLs
      (`lib/storage/signed-url.ts`), secure upload endpoint with server-side file-type/size validation and
      server-computed SHA-256 checksums, idempotency-key retry protection (EVID-003), `mediaAsset`
      permission resource with a differentiated 8-role matrix, audit-on-read at signed-URL-mint time
      (DECISIONS.md D-014) — 2026-07-22
- [x] Phase 4: all four dev-mode placeholder evidence fields upgraded to real MediaAsset-backed uploads —
      `GateEventInspectionItem.evidenceRef`, `ManualFacialVerificationFallback.evidenceRef`,
      `Driver.portraitUrl`, `ComplianceDocument.attachmentUrl` (DECISIONS.md D-012); gate check-in UI
      (`/gate/events/[id]`) gained a real file-input upload affordance per inspection item — 2026-07-22
- [x] Phase 4: 1 migration (`20260722090000_phase4_media_assets`), 27 new automated tests (7 signed-url
      unit cases, 15 media-asset-repository cases, 5 media-tenant-isolation cases) — 286/286 total
      passing — 2026-07-22
- [x] Phase 4: full live curl verification — secure upload, unauthorised-role block (403), signed-URL
      mint+serve returning exact original bytes, tampered-signature rejection (403), expired-URL rejection
      (410), direct filesystem-style path not served (404), cross-tenant signed-URL-mint block (403),
      idempotent retry (same MediaAsset id, confirmed 1 DB row), three deliberate precondition-violation
      paths all returning typed 4xx (not 500) — 2026-07-22
- [x] Independent re-verification of the Phase 3 work (delegated agent stalled before it could report
      back) + found and fixed BUG-003 (5 untyped Error throws in gate-event-repository.ts → 500 instead
      of 409/404) + 4 regression tests — 259/259 passing — 2026-07-22
- [x] Phase 3: GateEvent state machine (11 states, own pure transition table), configurable
      InspectionTemplate/InspectionItem engine with immutable-row versioning, GateEventInspectionItem
      results recording with automatic exception raising on FAIL, ExceptionType tenant-configurable
      catalogue + Exception raise/escalate/resolve workflow with a hard (non-tenant-configurable)
      self-approval rule, driver identity verification wired into the gate flow (mock provider + manual
      fallback), real DB-backed security dashboard, tablet-friendly gate check-in/check-out UI
      (`/gate` → `/gate/events/[id]`) — 2026-07-21
- [x] Phase 3: 1 migration (`20260721160000_phase3_gate_operations`), permission catalogue extended
      (`gateEvent`, `inspectionTemplate`, `exception`), all 8 tenant roles' permission matrix updated with
      a deliberately differentiated slice (Gate Security Officer: raise exceptions but not resolve;
      Security Manager: resolve but didn't raise — mirrors the movement CREATE/APPROVE separation
      pattern) — 2026-07-21
- [x] Phase 3: 159 new automated tests (134 state-machine matrix cases, 19 gate-event-repository cases,
      2 tenant-isolation cases, 4 inspection-template-versioning cases) — 255/255 total passing — 2026-07-21
- [x] Phase 3: full live curl verification of the entire gate lifecycle across 5 roles, including the
      self-approval-block, escalation-required, duplicate-gate-event-idempotency, and vehicle-lockout
      defense-in-depth checks — 2026-07-21
- [x] MD-004 finish — expiring-documents now surfaced on the Phase 3 security dashboard — 2026-07-21
- [x] Phase 2: organisation/site/gate admin UI, driver register, vehicle register (server-side VIN/
      registration uniqueness), compliance documents + tenant-configurable expiry rules, tyre-position
      configuration, movement authorisation with full approval state machine, gate-facing read-only
      lookup, facial-verification interface + mock provider + manual fallback — 2026-07-21
- [x] Phase 2: 51 new automated tests across 7 files (state machine, eligibility, self-approval,
      cross-tenant isolation, VIN/registration uniqueness, document expiry, gate lookup/authorization,
      facial-verification fallback) — 96/96 total passing — 2026-07-21
- [x] Phase 2: full live curl verification of create→submit→approve movement lifecycle, locked-vehicle
      rejection, self-approval rejection, gate officer search + forbidden-to-modify — 2026-07-21
- [x] Phase 1 security closure: user invitation workflow (invite/accept, dev-mode link since no email provider) — 2026-07-20
- [x] Phase 1 security closure: account suspension/reactivation, existing sessions revoked on suspend — 2026-07-20
- [x] Phase 1 security closure: session-expiry unit tests + suspension-revokes-sessions integration test — 2026-07-20
- [x] Phase 1 security closure: extra cross-tenant-admin-access tests via real site/gate/user repositories — 2026-07-20
- [x] Phase 1 security closure: Platform Administrator narrowed to an explicit, audited `platformTenant` permission (D-005) — 2026-07-20
- [x] Phase 1 security closure: seed script refuses to run outside localhost / with NODE_ENV=production — 2026-07-20
- [x] Phase 1 security closure: audit_logs append-only enforced at the Postgres level (trigger), not just convention — 2026-07-20
- [x] Phase 1 security closure: found and fixed BUG-001 (ForbiddenError → 500 instead of 403) and BUG-002 (login/accept-invitation didn't check tenant status) — 2026-07-20, see KNOWN_BUGS.md
- [x] Password-reset and reauthentication designs documented (D-004), deliberately not built yet — 2026-07-20
- [x] Project memory documentation set created — 2026-07-19
- [x] Dedicated git repo initialised at project root — 2026-07-19
- [x] Next.js 16 + TS strict + Tailwind app scaffolded, builds clean — 2026-07-19
- [x] Prisma schema + migrations (Tenant/Site/Gate/User/Role/Permission/RolePermission/
      UserPermissionOverride/Session/ApprovalDelegation/AuditLog) against local Docker Postgres — 2026-07-19
- [x] Auth foundation: bcrypt password hashing, DB-backed hashed-token sessions, permission evaluation
      (role/override/delegation), audit logging on login/logout — 2026-07-19
- [x] Seed script: platform tenant + demo tenant with 8 roles and one fictional user each — 2026-07-19
- [x] Manual end-to-end verification of login/logout/session-expiry/audit-logging via curl — 2026-07-19

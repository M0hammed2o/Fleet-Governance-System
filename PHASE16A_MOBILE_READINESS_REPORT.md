# Phase 16A mobile readiness report

Status: **local engineering foundation complete; native/store/staging/production release blocked**.

## Delivered

React 19 + TypeScript + Vite + Capacitor 8 provides one Android/iOS-ready client workspace with shared API
contracts and UI. It reuses the Next backend, PostgreSQL schema, sessions, permissions, tenant scoping,
audit repositories, gate state machine, media storage, tracker provenance, movement approval and automatic
reconciliation. Migration 30 adds tenant/user-scoped mutation receipts and notification read state only.

Guard workflows cover secure synthetic sign-in, site/gate selection, queue/search, vehicle/driver and
authorization confirmation, tracker disclosure, identity/checklist/readings, explicit synthetic evidence,
exception/escalation/reasoned clear-or-deny, departure/return finalization and server outcome. Owner
workflows cover fleet metrics, overdue/approval/exception/indicator counts, tracker quality, recent gate/
reconciliation activity, permission-filtered investigation summaries, notifications and movement
decisions. Connectivity is honestly online-only and critical offline mutations are blocked.

## Security and findings

Protected APIs enforce bearer session validity, effective permissions and tenant scope. Exact native CORS
origins are configuration-gated. Completed mutations replay safely; ambiguous receipt completion fails
closed. Private evidence returns no storage URL; raw tracker IDs, secrets and confidential investigation
content are omitted. Production password auth, push, direct providers, biometrics and offline queues remain
disabled.

The initial preferred Expo/React Native experiment produced 21 audit advisories (14 High, 7 Moderate) with
no compatible fixes and was fully removed before source commit. Capacitor reports zero advisories. Rendered
E2E testing found and fixed a browser host-function `fetch` binding fault and missing exact authorization
for root `home`/`guard`/`owner` routes. No unresolved Critical or High Phase 16A defect is known.

## Verification status

Focused evidence: 5 mobile Vitest files / 13 tests and 4 mobile Playwright journeys pass; root/mobile
TypeScript and ESLint pass; the Vite bundle exports 39 modules (about 231 KB JS / 72 KB gzip); configuration
validation and secret scan pass; npm audit reports zero. Browser viewports cover small/large phone portrait,
phone landscape and tablet portrait/landscape with 44-point navigation and no document overflow.

The executable candidate was `d9276d3`. Two consecutive 30-step `npm run mobile:rc` gates passed from that
same clean commit. Gate A ran 2026-08-13 09:05:13–09:25:31Z (20.3 minutes): full Vitest 212.4s, Next build
102.9s, Playwright 369.1s and Docker 182.2s. Gate B ran 09:25:54–09:40:39Z (14.8 minutes): Vitest 220.3s,
build 61.0s, Playwright 359.6s and cached Docker 14.9s.

Each passed package/lock integrity; Prisma format/validate/generate/status; empty replay and isolated
restore of all 30 migrations; root/mobile TypeScript and ESLint; **86 Vitest files / 871 tests** (including
**5 mobile files / 13 tests**); the Next build with **112 generated pages/routes**; pilot boundaries,
fixtures/imports and 27-case UAT pack validation; tracker conformance **25/25**; mobile config and the 39-
module Vite bundle; **24/24 Playwright tests** (20 established + 4 mobile); secret scan; npm audit with zero
vulnerabilities; expected non-zero fail-closed production/staging readiness; performance; non-root Docker
liveness; required documents and clean Git state. No emulator, simulator, physical device, APK/AAB,
IPA/archive, deployment or store submission is claimed.

Phase 16A commits are `47c13a4` (Capacitor workspace/client), `9c115a3` (workspace dependency exclusion),
`cff2f68` (mobile API/migration), `2221724` (workflow/security tests), `7476563` (readiness/runbooks) and
`d9276d3` (workspace-aware container). This report is the documentation-only closeout after the verified
executable candidate.

## Remaining blockers

MANUAL_CONFIRMATION_REQUIRED: Android/iOS identifiers, ownership/versioning/deep-link decisions, native
project generation, signing, Apple/Google accounts, HTTPS API/native origins, production identity provider,
legal/privacy materials, managed-device/screenshot/device-loss policy, push decision, native camera/secure-
storage/app-link/device matrix, store assets/declarations/review accounts and explicit release authority.
Production and staging also retain all Phase 13–15 provider, infrastructure, human-UAT and business gates.

Most administration, detailed owner drill-down/reconciliation/exception/investigation work and safe export
configuration remain web-only. Evidence is synthetic; tracking is simulator/manual/unavailable; notifications
are generated in-app and no external delivery occurs. Recommended next action: approve identifiers, privacy/
security ownership and a synthetic native-device UAT matrix, then generate un-signed native projects and
test on Android plus macOS/Xcode without connecting a real provider or real data.

## Phase outcome

Phase 16A is complete at the safe local engineering scope. There are zero unresolved Critical, High or
Medium defects attributed to the phase; BUG-010 remains the documented Low upstream Prisma adapter warning.
No deployment/publication, developer account, paid service, external message/push, provider connection,
real credential, customer/person/vehicle/location data or biometric was used. No signing key, certificate,
profile, token or secret was committed.

## Phase 16B continuation note

Phase 16B supersedes only the historical native-project limitation above. The provisional Android identity
`za.co.genbridge.fleet` and deep-link scheme `genbridgefleet` were authorized for local work, so a hardened
Android project and ignored debug APK now exist. The Phase 16A gates/results remain unchanged. Native app
installation still did not complete because the API 35 AVD repeatedly became offline during ADB install;
final identity, signing, production configuration, physical-device testing and release authority remain
blocked. See `PHASE16B_ANDROID_READINESS_REPORT.md`.

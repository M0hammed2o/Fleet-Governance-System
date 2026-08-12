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

The two complete final `npm run mobile:rc` results, full regression totals, commit list and durations are
recorded in the Phase 16A closeout entry after stable-source execution. No emulator, simulator, device,
APK/AAB, IPA/archive, deployment or store submission is claimed.

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

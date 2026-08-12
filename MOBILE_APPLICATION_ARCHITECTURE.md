# Mobile application architecture

Status: Phase 16A local foundation, 2026-08-12. This is not a staging or production release.

## Decision

The application uses React 19, TypeScript, Vite and Capacitor 8 under `apps/mobile`, with workspace packages
for the provider-neutral API client, shared response contracts and mobile UI. It is a genuine Android/iOS
application foundation: Capacitor packages the verified web bundle inside native shells and supplies native
secure storage, network, camera and app-link boundaries. The existing Next.js application remains the only
backend and complete administration interface.

React Native with Expo was evaluated first because it fit the TypeScript stack. The current Expo 57 / React
Native 0.87 dependency graph introduced 21 npm advisories, including 14 High findings in Expo/Metro/React
Native, with no compatible fixed release reported by npm. It was removed before commit. Capacitor reached
zero audit findings and reuses the established React model without duplicating business rules.

Final Android and iOS application identifiers are `MANUAL_CONFIRMATION_REQUIRED`. Native project folders
are deliberately not generated until those identifiers, signing ownership and privacy materials are
approved. `capacitor.config.ts` fails closed without `MOBILE_APP_ID`.

## Boundaries

- The Next.js/PostgreSQL backend is authoritative for identity, tenant, permissions, state, actor and time.
- Native sign-in creates the same hashed, revocable `Session` record used by web sessions. The raw opaque
  token exists only in the response and platform secure storage; browser simulation uses memory only.
- Android/iOS storage uses the OS Keystore/Keychain-backed secure-storage plugin. No token is written to
  `localStorage`, `sessionStorage`, SQLite or source configuration.
- Mobile routes accept strict Bearer authorization. Expiry, revocation, suspended users and tenants are
  evaluated through the existing session logic on every request.
- Canonical permissions are queried server-side, including overrides and active delegations. Navigation is
  derived from returned capabilities, but routes/repositories independently enforce every permission.
- Every query is tenant-scoped. Record identifiers never select a row without the session tenant.
- No mobile connection exists to PostgreSQL, object storage, tracker, payment or notification providers.
- Raw tracker asset identifiers are not returned. Source, freshness, mapping state, synthetic state and
  limitations are safe projections from the Phase 15 provenance model.

## Navigation and state

The hash-based internal router supports deterministic Capacitor app links without open redirects. Deep
links pass a capability policy before a screen renders and then encounter server authorization on data
load. Guard areas are exposed only with `gateEvent:VIEW` + `CREATE` + `EDIT`; owner overview requires canonical
analytics visibility or movement approval. Investigation summaries require `investigationCase:VIEW` and do
not include confidential content. In-memory component state holds form input and the current gate choice.
There is no offline transaction queue or cross-launch form persistence.

## Error, connectivity and retry behaviour

Network loss displays a persistent warning and prevents critical mutations before `fetch`. A successful
result is displayed only after a 2xx server response. Every critical JSON mutation carries a bounded
idempotency key. The database stores operation and request digests plus a safe completed response; an exact
retry returns that response, while changed content or an in-progress duplicate returns 409. Timeouts and
network failures are retryable; 401 clears the local session. Server errors are generic and logging uses the
existing redaction boundary.

The remote native API is cross-origin from its WebView. `MOBILE_TRUSTED_ORIGINS` is an exact allowlist for
Capacitor/HTTP(S) origins; the API proxy handles bounded preflight and response headers only for a match.
Production remains unusable until an approved origin is configured. Wildcards are not supported.

## Evidence and facial verification

Camera/file selection is explicit. The client previews metadata, permits removal, validates type, empty
files, 25 MB size and hostile filename characters, and uploads only on a separate action. The existing
private media repository validates tenant/entity ownership, content and idempotency and returns metadata,
never a storage URL. GPS is neither requested nor included automatically. Phase 16A uses synthetic files.

Driver facial recognition/liveness is not added. The future interface remains an authorized server action
that accepts a provider-neutral capture reference and returns a decision/provenance object. Device
biometrics may later unlock the local secure session but must never be represented as driver identity proof.

## Mobile API readiness matrix

| Capability | Endpoint | Canonical permission | Tenant/audit/idempotency | Readiness |
|---|---|---|---|---|
| Native sign-in/out | `/api/mobile/auth/login`, `/logout` | eligibility/session | generic auth, audited; production disabled by default | Ready locally |
| Principal, roles, sites/gates | `/api/mobile/bootstrap` | effective permission projection | active session tenant; no-store | Ready |
| Gate queue/search | `/api/mobile/gate/queue` | `gateEvent:VIEW` | tenant-scoped, paged | Ready |
| Movement/authorization/tracker | `/api/mobile/movements/[id]` | `movement:VIEW`; tracker separately filtered | tenant-scoped; raw provider ID omitted | Ready |
| Start/inspect/exception/exit/return | `/api/mobile/gate/events`, `/events/[id]/actions` | gate/exception/facial canonical permissions | repository audit + mutation receipt | Ready for synthetic UAT |
| Evidence | `/api/mobile/evidence/upload` | `mediaAsset:CREATE` | tenant/entity validation + upload idempotency | Synthetic only |
| Reconciliation | existing automatic completion and `/api/reconciliations` | canonical reconciliation permissions | tenant-scoped, repository audit | Reused; mobile manual resolution remains web-only |
| Executive dashboard | `/api/mobile/owner/overview` | analytics view or movement approval | tenant-scoped aggregate; confidential fields absent | Ready |
| Movement decision | `/api/mobile/movements/[id]/decision` | `movement:APPROVE` | separation of duties + receipt + audit | Ready |
| Indicators/reports | existing analytics endpoints | independent indicator/export permissions | tenant-scoped/audited where required | Linked summaries; detailed administration web-only |
| Investigation | owner overview summary | `investigationCase:VIEW` | no confidential detail | Summary only |
| Notification centre | `/api/mobile/notifications`, `/[id]/read` | source-record permissions | tenant/user state, paged, idempotent read | Ready locally |
| Push delivery | none | n/a | disabled/fail-closed | Future external decision |
| Tenant switching | none | n/a | current data model gives each user one tenant | Not supported honestly |

## Testing and builds

Vitest covers token parsing/storage, expiry clearing, secure URLs, disconnected mutation prevention,
idempotency/replay, evidence validation and permission-derived deep links. Mobile TypeScript/lint/config
checks and a credential-free Vite export run locally. Playwright renders the bundle at representative phone
and tablet viewports. No Android emulator, iOS simulator or physical device was used in Phase 16A.

Android generation/build requires the approved application ID, JDK/Android SDK, Gradle and approved signing
configuration. iOS requires macOS, Xcode, an approved bundle ID and Apple signing team. Neither signing
secret nor generated native project is committed. Store accounts, privacy/data-safety declarations,
screenshots, review credentials, policy URLs and publishing authority remain external requirements.

## Known limitations

Online-only; no offline critical mutation queue. No push provider. No production native authentication,
tenant switching, background sync, device-biometric unlock, driver facial verification, native emulator or
device evidence, final identifiers, signing or store submission. Most administration remains web-only by
design.

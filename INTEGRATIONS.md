# INTEGRATIONS.md

| Integration | Status | Mode |
|---|---|---|
| Facial verification | **Interface + mock built (2026-07-21)**, no vendor selected | mock only |
| Telematics (GPS) | Interface planned (Phase 6), no vendor selected. October pilot needs one production provider selected | mock only |
| Object storage | **Interface + local-filesystem dev implementation + R2-compatible configuration boundary built (2026-07-26, Phase 8B)**, no Cloudflare account created | dev mode only |
| Notifications (email/SMS) | Not started | — |
| Hardware/device (barrier, ANPR camera, ticket printer) | Not started, deferred item | — |

## FacialVerificationProvider (built — `src/lib/facial-verification/provider.ts`)
```ts
type FacialVerificationResult =
  | "VERIFIED" | "NOT_VERIFIED" | "LIVENESS_FAILED"
  | "PROVIDER_UNAVAILABLE" | "MANUAL_FALLBACK_REQUIRED";

interface FacialVerificationProvider {
  verifyDriver(driverId: string, capturedImageRef: string): Promise<{
    result: FacialVerificationResult;
    providerReference: string;
    confidence?: number;
    verifiedAt: Date;
    failureReason?: string;
  }>;
}
```
Dev implementation (`mock-provider.ts`): deterministic, returns `VERIFIED` unless `capturedImageRef`
contains a `force:<outcome>` marker (`force:not_verified`, `force:liveness_failed`, `force:unavailable`,
`force:fallback`) — no test fixtures or randomness needed to exercise every branch. Exercised via
`POST /api/drivers/[id]/facial-verification/mock-verify` and the driver detail page's dev-only buttons.

Manual fallback is a separate first-class model, `ManualFacialVerificationFallback`
(`lib/repositories/facial-verification-repository.ts`): a Gate Security Officer requests one (reason
required), a Security Supervisor / Approving Manager or Company Administrator resolves it
(APPROVED/DENIED); the resolver cannot be the same person who requested it
(`SelfApprovalNotAllowedError`); every step is audit-logged. Now wired into the GateEvent identity step
(Phase 3) via `relatedGateEventId`.

**Blocked:** production vendor selection is a major decision requiring the user's input before any
account/credential is created. The interface's shape should not need to change once one is chosen —
`verifyDriver()` is the only method a real adapter needs to implement.

## TelematicsProvider (planned interface, Phase 6 — see PRODUCT_REQUIREMENTS.md GPS-001..006)
Same adapter pattern as `FacialVerificationProvider`/`StorageProvider`: one interface, a
`MockTelematicsProvider` for dev, a `ManualGpsConfirmationProvider` fallback (mirrors the manual
facial-verification fallback — request/resolve, audited, self-approval blocked), and real vendor adapters
(Netstar/Cartrack/Tracker/MiX/other) built later behind the same interface without changing call sites.
Provider-neutral by design — must not hardcode the application to one tracking company. No undocumented
vendor endpoints will be invented or scraped; a real adapter is only built against that vendor's
published, authorised API documentation and sandbox credentials.
```ts
interface TelematicsProvider {
  testConnection(): Promise<{ ok: boolean; message?: string }>;
  listVehicles(): Promise<Array<{ providerVehicleId: string; label?: string }>>;
  getLatestReading(providerVehicleId: string): Promise<{
    lastCommunicationAt: Date | null;
    gpsActive: "ACTIVE" | "INACTIVE" | "UNKNOWN";
    location?: { lat: number; lng: number };
    ignitionOn?: boolean;
    odometerKm?: number;
    speedKmh?: number;
  } | null>;
  listGeofences?(): Promise<Array<{ providerGeofenceId: string; name: string }>>;
}
```
For the October pilot scope, one production provider matched to the pilot customer's existing tracker is
the target — still requires the user's vendor decision, budget approval, and credentials before that adapter
can be built or tested against a real sandbox. **Blocked** until then; the interface/mock/manual-fallback
are not blocked and will be built in Phase 6 regardless.

## VehicleUsePolicy (planned model, Phase 6 — see PRODUCT_REQUIREMENTS.md POLICY-001/002)
Not a provider integration itself, but depends on `TelematicsProvider` data (location, ignition, odometer)
to evaluate geofence/after-hours/mileage violations. Violations raise an `Exception` through the existing
Phase 3 workflow — never an automatic fraud/theft/crime conclusion (SECURITY_AND_POPIA.md), always subject
to human review.

## ObjectStorageProvider (built — `src/lib/storage/provider.ts`, extended Phase 8B)
```ts
interface ObjectStorageProvider {
  store(tenantId, category: MediaCategory, fileName, data: Buffer, contentType): Promise<{ storageKey, checksumSha256, fileSizeBytes }>;
  createPresignedUpload(tenantId, category, fileName, contentType, expiresInSeconds): Promise<PresignedUpload>;
  confirmUpload(storageKey): Promise<{ exists: boolean; fileSizeBytes: number | null }>;
  getSignedReadUrl(storageKey, expiresInSeconds): Promise<string>;
  read(storageKey): Promise<{ data: Buffer; contentType } | null>;
  delete(storageKey): Promise<void>;
}
```
Dev implementation (`local-filesystem-provider.ts`): writes to the gitignored `.data/media/` directory
(`STORAGE_LOCAL_PATH`); `getSignedReadUrl()`/`createPresignedUpload()` mint HMAC-SHA256-signed, time-limited,
*purpose*-distinct (read vs upload) URLs (`lib/storage/signed-url.ts`, keyed by `MEDIA_URL_SIGNING_SECRET`)
served through `GET /api/media/raw` / `PUT /api/media/raw-upload`, never a static/public path.

**R2CompatibleStorageProvider (built, blocked — `src/lib/storage/r2-compatible-provider.ts`):** a real
`@aws-sdk/client-s3` client pointed at Cloudflare R2's S3-compatible endpoint shape (`https://
<accountId>.r2.cloudflarestorage.com`), not a hand-rolled stub — the same class works against a real R2
bucket once credentials exist, no code change, only environment variables. **Blocked: no Cloudflare account
has been created for this project** (hard rule — paid third-party account requires explicit sign-off first,
same status as facial-verification/telematics vendor selection). Every method throws
`R2NotConfiguredError` unless `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET_NAME` are
all set — none are set anywhere in this repo. Presigned-URL generation (pure local SigV4 signing, no network
call) is unit-tested against a fake, non-real config; `store`/`read`/`delete`/`confirmUpload` make a real
network call and are therefore unverified against an actual bucket — same "interface + mock, real vendor
connection blocked" pattern as `FacialVerificationProvider`/`TelematicsProvider`.

## RetentionNotificationProvider (built — `src/lib/retention/notification-provider.ts`, Phase 8E-003)
```ts
interface RetentionNotificationProvider {
  readonly channel: "DEV_CONSOLE" | "NOOP" | "EMAIL";
  send(batch: RetentionNotificationBatch): Promise<{ delivered: boolean; failureReason?: string }>;
}
```
Same "interface + working dev/mock implementation, real vendor deferred" pattern as every other provider
above. `DevConsoleRetentionNotificationProvider` logs the notice; `NoOpRetentionNotificationProvider` is
silent. Both are used today via `lib/repositories/retention-notification-repository.ts`'s idempotent
generate/deliver functions (a real 90/60/30/7/0-day retention-expiry notice is genuinely generated and
"delivered," deduplicated by a hard DB uniqueness constraint — see ARCHITECTURE.md "Retention notifications
and automatic assignment") — but nothing reaches a real customer inbox yet. **Blocked: no email/SMS vendor
has been selected or contracted** — paid service, requires the user's sign-off before selection, same status
as every other unselected vendor above. A future `EmailRetentionNotificationProvider` (SES/SendGrid/etc,
whichever is chosen) implements this same interface and is a drop-in swap for whichever provider is
configured today.

## StorageBillingHookProvider (built, no-op — `src/lib/retention/storage-billing-hook.ts`, Phase 8C)
```ts
interface StorageBillingHookProvider {
  reportUsage(report: StorageBillingUsageReport): Promise<void>;
}
```
`NoOpStorageBillingHookProvider` is the only implementation — no real billing/payment integration exists
(subscription billing is explicitly out of scope for this build run, see TODO.md). Called both per-action
(`moveAssetsToArchive()`) and on a schedule (`reportArchiveUsageForAllTenants()`, Phase 8E-004) — the
periodic call skips any tenant with zero archived bytes entirely, never reporting a phantom R0 usage line.

## Background-job scheduler boundary (Phase 8E-004 — see ARCHITECTURE.md "Background job architecture")
No production scheduler (cron, queue, managed trigger) is wired into this codebase — that's an explicit,
intentional gap pending the hosting decision (TODO.md "Blocked"). What exists and is fully tested is the
boundary such a scheduler would call through: eight job endpoints under `src/app/api/jobs/*`, authorized
via a shared `x-job-scheduler-token` header (`JOB_SCHEDULER_TOKEN`, fail-closed if unset) or an
authenticated Platform Administrator session, each with a hard database-level guarantee against running
twice concurrently. Whichever scheduler the hosting decision implies (a platform-native cron trigger, a
queue worker, a simple external cron hitting these routes with the token) needs no application-code change
— only the token configured as a secret and something pointed at these eight URLs on a schedule.

## Hardware/device integration
Explicitly deferred per build-brief section 8 (no custom GPS/ANPR hardware in V1). Any future barrier or
ANPR integration would sit behind its own adapter interface, following the same pattern as the above.

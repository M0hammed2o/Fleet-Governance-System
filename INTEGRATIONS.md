# INTEGRATIONS.md

| Integration | Status | Mode |
|---|---|---|
| Facial verification | **Interface + mock built (2026-07-21)**, no vendor selected | mock only |
| Telematics (GPS) | Interface planned (Phase 6), no vendor selected. October pilot needs one production provider selected | mock only |
| Object storage | **Interface + local-filesystem dev implementation built (2026-07-22)**, no production vendor selected | dev mode only |
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

## StorageProvider (built — `src/lib/storage/provider.ts`)
```ts
interface StorageProvider {
  store(tenantId, fileName, data: Buffer, contentType): Promise<{ storageKey, checksumSha256 }>;
  getSignedReadUrl(storageKey, expiresInSeconds): Promise<string>;
  read(storageKey): Promise<{ data: Buffer; contentType } | null>;
  delete(storageKey): Promise<void>;
}
```
Dev implementation (`local-filesystem-provider.ts`): writes to the gitignored `.data/media/` directory
(`STORAGE_LOCAL_PATH`); `getSignedReadUrl()` mints an HMAC-SHA256-signed, time-limited URL
(`lib/storage/signed-url.ts`, keyed by `MEDIA_URL_SIGNING_SECRET`) served through
`GET /api/media/raw`, never a static/public path. No MinIO/S3/Supabase Storage adapter was built — the
interface is designed so one can be added later without changing any call site in
`lib/repositories/media-asset-repository.ts`. **Blocked:** production object-storage vendor selection is a
major decision requiring the user's input (same status as facial verification/telematics) — deferred to
Phase 7 alongside hosting, per DECISIONS.md's open-items list.

## Notification integration
Not designed yet. Will follow the same adapter pattern once a channel (email/SMS provider) is chosen —
paid service, so requires the user's sign-off before selection.

## Hardware/device integration
Explicitly deferred per build-brief section 8 (no custom GPS/ANPR hardware in V1). Any future barrier or
ANPR integration would sit behind its own adapter interface, following the same pattern as the above.

# INTEGRATIONS.md

| Integration | Status | Mode |
|---|---|---|
| Facial verification | **Interface + mock built (2026-07-21)**, no vendor selected | mock only |
| Telematics (GPS) | Interface planned (Phase 3), no vendor selected | mock only |
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
required), a Security Manager/Company Administrator resolves it (APPROVED/DENIED); the resolver cannot be
the same person who requested it (`SelfApprovalNotAllowedError`); every step is audit-logged. Not yet tied
to a GateEvent (Phase 3 doesn't exist) — `relatedGateEventId` is a forward-compatible nullable field, same
pattern as `AuditLog`'s.

**Blocked:** production vendor selection is a major decision requiring the user's input before any
account/credential is created. The interface's shape should not need to change once one is chosen —
`verifyDriver()` is the only method a real adapter needs to implement.

## TelematicsProvider (planned interface, Phase 3)
```
interface TelematicsProvider {
  getLatestReading(vehicleId): Promise<{
    lastCommunicationAt: Date | null;
    gpsActive: boolean;
    location?: { lat: number; lng: number };
  } | null>
}
```
Dev implementation: mock returning static/randomised fixture data. **Blocked:** production vendor
selection is a major decision.

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

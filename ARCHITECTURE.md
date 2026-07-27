# ARCHITECTURE.md

## Stack decision (Decision D-001, see DECISIONS.md)
- **App framework:** Next.js (App Router), TypeScript strict mode, React, Tailwind CSS. Single
  deployable app serving both UI and API (route handlers / server actions). Actual installed version is
  whatever `npm install` resolved at scaffold time (currently Next.js 16 / React 19) — npm always pulls
  latest on a fresh install, so don't assume Next 14/15-era API shapes; check `node_modules/next/dist/docs`
  for the bundled version's docs before relying on training-data assumptions (params/cookies/searchParams
  are async as of this version — see WORKLOG.md 2026-07-19).
- **Database:** PostgreSQL, accessed via **Prisma ORM**. Chosen over the raw Supabase JS client so the
  data layer stays provider-agnostic (works against local Docker Postgres, Supabase-hosted Postgres, or
  any managed Postgres without code changes) — satisfies the "must not tightly couple to Supabase" rule
  in the build brief. Local dev DB runs in Docker (see `docker-compose.yml`), bound to a non-default host
  port to avoid colliding with other projects' Postgres containers already running on this machine.
- **Validation:** Zod, enforced server-side on every mutating route handler / server action. Client-side
  validation is a UX convenience only, never the security boundary.
- **Auth:** custom session-based auth (bcrypt password hashing + server-side session records, signed
  httpOnly cookie holding an opaque session ID — not a JWT, so sessions are revocable server-side).
  MFA-ready: `User` has `mfaEnabled`/`mfaSecret` columns wired but no TOTP flow in V1. See Decision D-002.
- **Testing:** Vitest (unit/integration), Playwright (e2e). Tenant-isolation and permission tests are
  mandatory gates, not optional coverage (`TESTING.md`).

## Tenant-isolation strategy
Defense in depth, two layers:
1. **Application layer (primary, enforced now):** every tenant-owned Prisma model carries a required
   `tenantId`. All repository/service functions accept the authenticated session's `tenantId` and inject
   it into every `where` clause; there is no code path that queries a tenant-owned table without a
   tenant filter. A lint-level convention (see `lib/db/tenant-scope.ts`) wraps Prisma delegates so raw
   `prisma.<model>.findMany()` without a tenant filter is not the blessed access path.
2. **Database layer (defense in depth, added once we're on Postgres RLS-capable hosting):** Postgres Row
   Level Security policies keyed on a session-local `app.tenant_id` GUC. Deferred to Phase 7 hardening
   because RLS needs a connection-pooling strategy (`SET LOCAL` per request) that's easier to get right
   once the app-layer contract is stable. Tracked as TODO item SEC-2.

Cross-tenant data leakage is a release-blocking defect per the build brief; tenant-isolation tests are
mandatory before any module is marked done (`TESTING.md`).

## Authentication and authorisation
- Session record in DB (`Session` table): id, userId, tenantId snapshot, createdAt, expiresAt, ip,
  userAgent, revokedAt. Cookie holds only the session id.
- Authorisation is **permission-based, not role-name-based**. `Role` has many `Permission`s
  (`resource` + `action`, e.g. `driver:approve`); a `User` has one primary `Role` plus optional
  `UserPermissionOverride` grants/revokes for edge cases. Every server action/route handler calls
  `requirePermission(session, resource, action)` before touching data — see `lib/auth/authorize.ts`.
- Approval delegation (`ApprovalDelegation`: delegator, delegate, permission scope, startAt, expiresAt) is
  checked at authorisation time; expired delegations are excluded by a time-bound query, not a cron job,
  so there's no window where an expired delegation still works.

## Audit architecture
Append-only `AuditLog` table. No application code path exposes UPDATE/DELETE on it — the Prisma client
used by the audit-write helper is the only writer, and it only exposes `create`. Every sensitive
mutation goes through a single `recordAudit()` helper (tenant, userId, action, entityType, entityId,
before/after JSON, reason, correlationId) so the call site can't forget a field. Stronger tamper-evidence
(hash chaining / external WORM sink) is deferred — documented in `SECURITY_AND_POPIA.md`.

## Media/video architecture (Phase 4 — implemented, see PRODUCT_REQUIREMENTS.md EVID-001..004)
Object storage sits behind a `StorageProvider` adapter interface (`lib/storage/provider.ts`: `store()`,
`getSignedReadUrl()`, `read()`, `delete()`), the same "interface + working dev implementation, production
provider stays swappable and unselected" pattern already used for `FacialVerificationProvider`. The dev
implementation (`lib/storage/local-filesystem-provider.ts`) writes to the gitignored `.data/media/`
directory (`STORAGE_LOCAL_PATH`); no Supabase/S3 adapter is built — that stays unselected per
INTEGRATIONS.md, exactly like the facial-verification and telematics vendors, and swapping one in later
means implementing this interface, not changing any call site.

**No public bucket access, ever.** There is no static/public route that serves `.data/` — it isn't under
Next's `/public`, and no route handler exposes a raw filesystem path. The only way to read a MediaAsset's
bytes is: (1) `GET /api/media/[id]` — permission-checked (`mediaAsset:VIEW`) and tenant-scoped
(`mintSignedUrlForMediaAsset()`, `lib/repositories/media-asset-repository.ts`) — mints a short-lived
(`SIGNED_URL_DEFAULT_EXPIRY_SECONDS` = 300s) signed URL and audit-logs the grant; then (2)
`GET /api/media/raw?key=...&expires=...&sig=...` — verifies the HMAC-SHA256 signature and expiry
(`lib/storage/signed-url.ts`, pure/DB-free, directly unit-tested), re-checks the requesting session's
tenant against the asset's tenant (defense in depth beyond the signature alone), and only then streams the
bytes. Both an expired signature and a signature whose resource key was tampered with are rejected with
distinct, typed reasons (`expired` → 410, `invalid_signature` → 403) — see
`InvalidOrExpiredSignedUrlError`.

**MediaAsset** (`prisma/schema.prisma`) is one reusable, polymorphic model for every evidence-capture point
in the system (DECISIONS.md D-011) — an `ownerType` discriminator (`GATE_EVENT`,
`GATE_EVENT_INSPECTION_ITEM`, `MANUAL_FACIAL_VERIFICATION_FALLBACK`, `DRIVER_PORTRAIT`,
`COMPLIANCE_DOCUMENT`) + plain `ownerId` string (same shape as `AuditLog`'s `entityType`/`entityId`, not N
nullable FK columns), capturing user/time, file type/size, an opaque tenant-namespaced `storageKey`, and a
SHA-256 `checksumSha256` computed server-side on receipt — never trusts a client-supplied value (an
optional client-supplied checksum, if present, is only used as an extra integrity cross-check). A
client-generated `idempotencyKey`, unique per `(tenantId, idempotencyKey)`, makes retrying an upload over
flaky gate connectivity safe: `uploadMediaAsset()` returns the existing row unchanged on a genuine retry
(same key, same content), and rejects with a typed `IdempotencyKeyConflictError` (409) if the same key is
reused with different content — satisfying EVID-003.

**Upload** (`POST /api/media/upload`, multipart/form-data, `mediaAsset:CREATE` permission) validates file
type (images: jpeg/png/webp/heic; video: mp4/quicktime/webm) and size (25MB image / 200MB video — see
DECISIONS.md D-013 for why these numbers) server-side before ever calling the storage provider, and
confirms the `ownerId` genuinely belongs to the caller's tenant (`assertOwnerExistsInTenant()`) before
attaching evidence to it — every violation is a typed error (`InvalidFileTypeError`, `EmptyFileError`,
`FileTooLargeError`, `MediaOwnerNotFoundError`, `ChecksumMismatchError`, `IdempotencyKeyConflictError`)
mapped to the correct 4xx status, following the same discipline BUG-001/002/003 established (see
KNOWN_BUGS.md) — nothing here falls through to a generic 500.

**Wired into existing capture points** (DECISIONS.md D-012): `GateEventInspectionItem.evidenceMediaAssetId`
and `ManualFacialVerificationFallback.evidenceMediaAssetId` replaced their old dev-mode placeholder string
fields; `Driver.portraitMediaAssetId` and `ComplianceDocument.attachmentMediaAssetId` were upgraded the
same way (both update-only — evidence is uploaded after the owning record exists, then linked via a
dedicated attach endpoint/function). The `/gate/events/[id]` guided-inspection UI has a real file-input
upload affordance per inspection item.

**Audit on read** (SECURITY_AND_POPIA.md): `mintSignedUrlForMediaAsset()` writes one `AuditLog` row per
signed-URL mint (`mediaAsset.readAccessGranted`) — the point where read access is actually authorised, not
every subsequent raw-byte fetch (DECISIONS.md D-014).

## Object-storage architecture (Phase 8B, see PRODUCT_REQUIREMENTS.md MEDIA-001..012)
Extends the Phase 4 `StorageProvider` interface into `ObjectStorageProvider` (`lib/storage/provider.ts`) —
same adapter shape, plus presigned upload, upload confirmation, and category-aware storage keys. Every key
is `${tenantId}/${category}/${uuid}-${fileName}`, never a bare filename, so per-tenant/per-category storage
usage is always attributable even without a provider's own billing dashboard.

**Providers.** `LocalFilesystemStorageProvider` (dev, fully working — extended from Phase 4 with
`createPresignedUpload()`/`confirmUpload()`) and `R2CompatibleStorageProvider` (`lib/storage/
r2-compatible-provider.ts`) — a real `@aws-sdk/client-s3` client pointed at Cloudflare R2's S3-compatible
endpoint shape, not a stub. **No Cloudflare account exists for this project** — every method throws
`R2NotConfiguredError` unless `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET_NAME` are
all set, none of which appear anywhere in this repo's `.env*` files, so this provider is never actually
reachable today — same "blocked pending vendor decision" status as `FacialVerificationProvider`/
`TelematicsProvider` (INTEGRATIONS.md). Presigned-URL generation is pure local SigV4 signing (no network
call), so it's directly unit-tested against a fake (non-real) config without ever touching a real account.

**Presigned direct-to-storage upload (MEDIA-002).** `initiatePresignedUpload()` reserves a storage key,
creates a `PENDING` MediaAsset row immediately (so an abandoned upload leaves a discoverable, cleanable
trace, not a silent orphan), and mints a presigned upload URL. The client PUTs bytes straight to that URL —
for the real S3/R2 provider this bypasses this app's request thread entirely (ARCHITECTURE.md "Technical
constraints"); for local dev, `PUT /api/media/raw-upload` is a self-hosted analogue that verifies an
upload-purpose signed token before writing. `confirmPresignedUpload()` then verifies the object actually
exists (`provider.confirmUpload()` — never trusts the client's own claim), reads it back, runs the same
compression pipeline the direct-upload path uses, and moves the row PENDING → READY (or FAILED, typed,
never a raw 500).

**Compression pipeline and checksum ordering (MEDIA-004/MEDIA-012).** Compression always runs *before* the
checksum is computed — the recorded `checksumSha256` is a hash of the bytes actually persisted, never the
client's original upload (`tests/media-asset-repository.test.ts` asserts these differ). Images: real WebP
conversion via `sharp` (`lib/storage/image-compression.ts`), resized so the longest side never exceeds
1920px (never upscaled), quality 75-82% depending on category (`MEDIA_CATEGORY_RULES`'s
"standard"/"high-quality" profile). `DAMAGE_EVIDENCE`/`INVESTIGATION_EVIDENCE` use the high-quality profile
and additionally preserve the original, uncompressed bytes under `MediaAsset.originalStorageKey` — every
other category only ever stores the compressed copy. A thumbnail (≤320px, WebP) is generated for every
image and stored under `thumbnailStorageKey`. Videos: `lib/storage/video-compression.ts` defines the full
target policy (720p, H.264/MP4, 24-30fps, 30-60s max, target bitrate) and a `VideoCompressionProvider`
interface, but ships only `PassthroughVideoCompressionProvider` — real H.264 transcoding needs an external
binary (ffmpeg) not installed in this environment; storing an untranscoded original and recording the
*intended* profile is the honest choice over silently claiming video compression works. A documented gap
(TODO.md), verified by name in TESTING.md, not silently assumed correct.

**Ten evidence categories (MEDIA-011).** `MediaCategory` is orthogonal to `MediaAssetOwnerType` — ownerType
says which *record* owns this evidence (a GateEvent, a Driver, ...); category says what *kind* of evidence
it is for storage/retention/billing purposes (a GateEventInspectionItem's evidence could be
`VEHICLE_INSPECTION_PHOTO` or `DAMAGE_EVIDENCE` depending on content, not derivable from ownerType alone).
`category` defaults to `OTHER_DOCUMENT` for any caller not yet updated to pass one explicitly — a documented
simplification (TODO.md), not a silent miscategorisation, since existing Phase 4-era call sites (gate
inspection evidence, manual facial-verification fallback evidence) haven't all been updated to pass a
specific category in this pass.

**Upload-status lifecycle and cleanup (MEDIA-006/MEDIA-008).** `MediaUploadStatus`: `PENDING` (presigned
URL minted, not yet confirmed) → `PROCESSING` (confirmed, compression running) → `READY` (usable) or
`FAILED` (never completed, or processing errored). `cleanupFailedUploads()` deletes any `PENDING`/`FAILED`
row older than a configurable age (default 24h) — best-effort deletes the underlying storage object too,
then removes the DB row entirely (a never-completed upload has no evidentiary value to keep as a
tombstone), audit-logging the cleanup before it happens.

**Storage usage accounting (MEDIA-010).** `getStorageUsageForTenant()` — real DB `groupBy` aggregate query
by category, `READY` rows only (a `PENDING` row's real bytes-on-disk aren't reliably known without an extra
provider call per asset; a `FAILED` one is cleanup-eligible, not billable) — same "no static/mock values"
discipline as `security-dashboard-repository.ts`/`support-access-repository.ts`. Feeds the Phase 8D storage
dashboards, not built as a route/UI in this subphase.

## Retention architecture (Phase 8C, see PRODUCT_REQUIREMENTS.md RETAIN-001..010)
Replaces the single tenant-wide `Tenant.retentionDays` assumption (never actually enforced — no purge job
existed, and no code ever read it) with per-`MediaCategory` `RetentionPolicy` rows, falling back to a
hardcoded 12-month (365-day) default when a tenant hasn't overridden a category
(`getEffectiveRetentionPolicy()`, `lib/repositories/retention-policy-repository.ts`).

**Deletion eligibility (`lib/retention/deletion-rules.ts`, pure, DB-free — same family as
`gate-events/state-machine.ts`).** `evaluateDeletionEligibility()` blocks deletion for three conditions this
codebase can actually evaluate: `MediaAsset.legalHold`, `MediaAsset.investigationHold`, and an unresolved
`Exception` linked to the evidence's `GateEvent` (traversed via the existing `ownerType`/`ownerId` pair for
`GATE_EVENT`/`GATE_EVENT_INSPECTION_ITEM` evidence). The brief's other three conditions — insurance claim,
dispute, open audit — have no corresponding data model in this codebase (`MVP_SCOPE.md` explicitly scopes
full investigation-case management out) and are **not** programmatically enforced; a disclosed gap
(TODO.md), not a silent omission.

**Deletion request workflow (dual-control, three-layer defense in depth).** `DeletionRequest` scopes a
*batch* (category/date-range), not a single asset — matching the deletion-certificate requirement to record
"categories, date range, volume" as one unit. `createDeletionRequest()` (Company Administrator,
`retention:CREATE`) snapshots every currently-eligible matching asset into `DeletionRequestAsset`, silently
excluding ineligible ones (reported as `excludedCount`) rather than failing the whole batch.
`approveDeletionRequest()` (`retention:APPROVE`, a deliberately separate permission grant — see D-026)
enforces the hard, unconditional rule that the approver can never be the request's own initiator
(`SelfApprovalNotAllowedError`, same family as D-008/D-020), and re-checks eligibility for every linked
asset a second time (a hold applied between creation and approval excludes that asset, not the whole
request) before setting `recoveryExpiresAt` (default 30 days) and moving eligible assets to
`PENDING_DELETION`. `completeDeletionRequest()` re-checks eligibility a *third* time — an asset that gained
a hold during the recovery window is skipped, not deleted — deletes each remaining asset's storage
object(s) (primary, thumbnail, original), sets `binaryDeletedAt`/`retentionStatus: DELETED`, and issues an
immutable `DeletionCertificate` with a `checksumManifest` (computed from each asset's own recorded checksum
before its bytes are removed). **The MediaAsset row itself survives permanently as a structured metadata
record even after its binary is gone** (ARCHITECTURE.md's own "preserve structured operational records
separately from large media files" requirement) — never claim the *binary* is recoverable after this point,
but the *fact that it existed and what it was* remains auditable forever via the row + certificate.
`completeDeletionRequest()`/`completeDueDeletionRequests()` are wired as an idempotent background job
(`retention.completeDueDeletions`, Phase 8E-004 — see "Background job architecture" below) as well as
callable on demand via `POST /api/retention/deletion-requests/[id]/complete` or the cross-tenant batch
`POST /api/admin/retention/process-due-deletions` (platform-admin-gated, since it operates across every
tenant by design) — no *production scheduler* (cron/queue) actually invokes the job on a timer yet
(TODO.md), but the job itself, its concurrency guarantee, and its auth boundary all exist and are tested.

**Export request ("export and then delete").** `createExportRequest()` builds a signed manifest — per-file
metadata plus a 24-hour expiring signed download URL (`ObjectStorageProvider.getSignedReadUrl()`) — rather
than a server-generated zip archive: avoids adding a heavy archive-generation pipeline for a batch that
could be very large, while still giving the customer a complete, checksum-verifiable export before deletion
proceeds.

**Archive and retention extension.** `moveAssetsToArchive()` sets `retentionStatus: ARCHIVED` for eligible
assets (respecting the category's `RetentionPolicy.archiveEligible` flag) and reports the resulting usage
through `StorageBillingHookProvider` — a boundary for a future real billing system, same "interface +
no-op, real integration blocked" pattern as every other unselected vendor; payment collection is explicitly
not implemented. `extendRetention()` pushes `scheduledDeletionAt` out, audit-logged.

**Archive pricing (`lib/retention/archive-pricing.ts`).** Configuration data, not scattered UI literals —
`ARCHIVE_PRICING_TIERS` (R149/R1,500 up to 100GB through R899/R9,000 for 501GB-1TB, custom quotation beyond
1TB, all ZAR excluding VAT) and `getArchiveTierForBytes()`.

**Retention-expiry notifications.** `currentRetentionMilestone()` (pure) computes which of 90/60/30/7/0
days-before-expiry applies to a given `scheduledDeletionAt`; `getDueRetentionNotifications()` finds every
`ACTIVE` asset currently due (unchanged, used by the storage dashboard). Phase 8E-003 built the actual
generation/delivery layer on top — see "Retention notifications and automatic assignment" below.

## Retention notifications and automatic assignment (Phase 8E-001/8E-003, see PRODUCT_REQUIREMENTS.md RETAIN-010)

**Automatic `scheduledDeletionAt` assignment.** Phase 8C computed retention dates only where a
retention-repository function happened to be called; Phase 8E-001 guarantees every MediaAsset gets one the
moment it reaches `READY` — both `uploadMediaAsset()` (direct upload) and `confirmPresignedUpload()`
(presigned-upload confirmation) now compute `computeScheduledDeletionAt(capturedAt,
effectivePolicy.retentionDays)` inline, so "not yet computed" (`scheduledDeletionAt: null`) can no longer
happen for ordinary new evidence. A new `MediaAsset.retentionExtendedAt` marker (set only by
`extendRetention()`) distinguishes a policy-derived value from a deliberate human override — automatic
(re)assignment and the backfill below both skip any asset with this set, never silently reverting a manual
extension. `backfillMissingScheduledDeletionAt()` is the same logic exposed as a callable, re-runnable
repository function (idempotent — only ever targets `scheduledDeletionAt IS NULL` rows) for pre-existing
data; the one-time production backfill runs as SQL directly inside migration
`20260727090000_phase8e_retention_extension_and_backfill`.

**Idempotent notification generation and delivery (`lib/repositories/retention-notification-repository.ts`,
`lib/retention/notification-provider.ts`).** `generateDueRetentionNotifications()` scans for the
90/60/30/7/0-day milestone currently due on every `ACTIVE` asset and creates one
`RetentionNotificationRecord` per (asset, milestone, `scheduledDeletionAt`) — the table's own unique
constraint on that triple is the actual idempotency guarantee (a duplicate `create()` attempt is caught as
the expected "already generated" outcome, not an error), not application-level deduplication logic.
`deliverPendingRetentionNotifications()` groups PENDING/FAILED records by (tenant, category, milestone) into
one `RetentionNotificationBatch` per group — a tenant crossing a milestone on many assets in one day gets
one outbound message, not one per asset — and calls a provider-neutral `RetentionNotificationProvider`
(`DevConsoleRetentionNotificationProvider` logs; `NoOpRetentionNotificationProvider` is silent; a real
email/SMS implementation is a documented future boundary — no vendor selected, no paid account created, see
INTEGRATIONS.md). Every batch identifies category, the scheduled-deletion date range, total storage amount,
and the available customer actions (extend/archive/export/request-deletion) — deliberately never a file
name, signed URL, or anything else that would let the notification itself reveal restricted evidence
content. A FAILED delivery is retried on the next invocation (included in the same PENDING/FAILED scan),
not stuck forever.

## Background job architecture (Phase 8E-004)

`lib/jobs/` provides the idempotent-job execution layer every scheduled/batch operation in this codebase
now goes through. `runJob(jobName, fn)` wraps a job function with:
- **A `JobRun` audit record** — RUNNING at start, then SUCCEEDED (with the job's own return value as
  `resultSummary`) or FAILED (with the error message) at the end.
- **A hard concurrency guarantee, not a best-effort check.** A partial unique index on `job_runs`
  (`WHERE status = 'RUNNING'`, applied directly in the migration SQL since Prisma's schema DSL has no
  `WHERE` clause for `@@unique`) means at most one RUNNING row can exist per `jobName` at the database
  level — two overlapping invocations of the same job collide on a real Postgres unique-constraint
  violation (`JobAlreadyRunningError`), not a race between two application-level checks.

Eight jobs are wired (`lib/jobs/jobs.ts`): retention-notification generation and delivery, due
deletion-request completion, failed-upload cleanup, export-link expiry (`expireOldExportRequests()` —
marks lapsed `ExportRequest` rows `EXPIRED`), archive-usage reporting (`reportArchiveUsageForAllTenants()`
— reports through `StorageBillingHookProvider`, skipping any tenant with zero archived bytes entirely,
directly applying the 8E-002 "never a phantom zero-byte charge" lesson), support-access-session expiry
(`expireDueSupportAccessSessions()` — closes out `endedAt` for TTL-lapsed `SupportAccessSession` rows that
were previously only ever treated as inactive *lazily*, at check time, never actually marked closed), and
storage-summary recalculation (`recalculateStorageUsageSummaries()` — a scheduled correctness sweep; there
is no persisted snapshot table to actually invalidate, since these dashboards are always computed live by
design, see "Storage dashboard architecture" below).

**Auth boundary (`lib/jobs/service-auth.ts`).** Two independent paths authorize a job-endpoint request,
either sufficient: a valid `x-job-scheduler-token` header checked against `JOB_SCHEDULER_TOKEN` (fails
closed — every request is refused, including ones bearing a token, if the env var isn't configured), or an
authenticated session holding `platformTenant:CONFIGURE`. A normal customer-tenant administrator has
neither — "do not rely on a normal customer administrator manually calling a sensitive processing
endpoint" is enforced structurally, not by convention. Each job has a route under `src/app/api/jobs/*`
(all sharing one `runJobRoute()` helper for consistent auth/error-status mapping); `npm run job -- <name>`
is a local-dev CLI — deliberately a thin HTTP client against the already-running dev server, not a direct
import of the job functions, because every repository function is guarded by `import "server-only"` and
cannot execute under plain Node outside Next's server context. **No production scheduler (cron/queue)
actually calls these endpoints on a timer yet** — that's the one piece intentionally left for the hosting
decision (TODO.md), everything up to and including the auth boundary and CLI is built and tested.

## Storage dashboard architecture (Phase 8D, see PRODUCT_REQUIREMENTS.md DASH-001..003)
`storage-dashboard-repository.ts` computes both the platform-admin (every tenant) and customer-admin (one
tenant) dashboards from the same underlying function, `computeDashboardRows()` — the platform view just
doesn't filter to one tenant. Real DB aggregate queries only, same discipline as
`security-dashboard-repository.ts`/`support-access-repository.ts`.

**Deliberately batched, never a per-tenant loop.** `getPlatformStorageDashboard()` runs a fixed ~10 `groupBy`
queries across every tenant *at once* (vehicle counts, storage-by-category, two 30-day windows for growth,
assets-approaching-expiry, hold counts, export-request counts, deletion-request counts, archived bytes,
failed-upload counts), then assembles per-tenant rows from those grouped results in-process — never one
query per tenant. This is a direct application of the lesson from KNOWN_BUGS.md BUG-004 (Phase 8A): an
unbounded per-tenant fan-out saturates the connection pool and produces slow/incorrect dashboards exactly
as the platform grows the number of tenants this dashboard is meant to scale across.

**"Current storage" vs "archived storage" are mutually exclusive (BUG-005, found via live verification this
phase).** `MediaAsset.uploadStatus` (upload lifecycle) and `retentionStatus` (retention/deletion lifecycle)
are independent fields — a permanently deleted asset keeps `uploadStatus: READY` (it uploaded successfully;
that's not what changed) but moves to `retentionStatus: DELETED`. The dashboard's "current storage" queries
filter on both `uploadStatus: "READY"` *and* `retentionStatus: { in: ["ACTIVE", "PENDING_DELETION"] }` — a
`DELETED` asset's bytes are excluded entirely (the binary is actually gone), and an `ARCHIVED` asset's bytes
are excluded from "current" and counted only in the separate `archivedBytes` stat, so a customer reading
both numbers never has to wonder whether they overlap.

**Monthly storage growth is an approximation**, not a true historical ledger — no `StorageUsageSnapshot`-
style time-series table exists (deliberately not built for Phase 8B/8C, see those phases' scope notes).
Computed as bytes uploaded in the last 30 days minus bytes uploaded in the preceding 30 days, both from
`MediaAsset.capturedAt` — good enough for a dashboard trend indicator, not a billing-grade historical record.

**Archive plan / estimated charge** reuses Phase 8C's `getArchiveTierForBytes()` against the tenant's current
`archivedBytes` total — the same pricing configuration `RetentionPolicy`/`moveAssetsToArchive()` already use,
so the dashboard's number and the actual archive-workflow pricing can never drift apart.

**Read-only, no new elevation path.** Neither dashboard exposes a mutating action — both are aggregate views
only. Phase 7's `SupportAccessSession` audited-elevation mechanism (the only sanctioned path for platform
staff to gain any deeper access to a customer tenant) is entirely unchanged by this phase; there is no new
"platform admin can act on a customer's evidence" capability introduced here (DASH-003).

## Retention management UI (Phase 8E-005)

`/admin/retention` is the customer-admin surface for every Phase 8C/8E retention action the API layer
already supported but had no dedicated page for: retention policies by category (view + edit), an evidence
browser, legal/investigation holds, retention extension, archive selection, export requests, and the
dual-control deletion-request workflow (create → approve/reject/cancel → recovery status → certificate).

**Evidence browsing without exposing binary content.** `listEvidenceInTenant()`
(`lib/repositories/retention-repository.ts`) and `GET /api/retention/evidence` back the evidence browser —
deliberately metadata-only (id, category, fileName, fileSizeBytes, capturedAt, retentionStatus,
scheduledDeletionAt, hold flags, extension marker). It never returns `storageKey`, `checksumSha256`,
`thumbnailStorageKey`, or `originalStorageKey`, so browsing this list can never itself be used to fetch raw
bytes — an actual signed URL still requires a separate `mintSignedUrlForMediaAsset()` call, with its own
audit-on-read (EVID-002), unchanged.

**Separation of duties, enforced server-side, not just hidden in the UI.** The deletion-request approve/
reject buttons are always rendered for a `PENDING_APPROVAL` request regardless of who initiated it — the
UI does not attempt to guess whether the current user "shouldn't" see the button, because
`approveDeletionRequest()`/`rejectDeletionRequest()` already unconditionally reject a self-approval attempt
server-side (`SelfApprovalNotAllowedError`, same family as D-008/D-020) and the UI surfaces that error if
it happens; hiding the button client-side would be a weaker, spoofable control, not a stronger one.

**Platform-admin summary, unchanged.** The existing `/platform/storage-dashboard` already showed
aggregate-only counts (no file names, no evidence content, no signed URLs) before this phase — it needed
no change to satisfy "platform-admin summary views without exposing restricted evidence content".

## Video-capture cost controls (Phase 8E-006, see PRODUCT_REQUIREMENTS.md MEDIA-001..012)

`components/video-capture-recorder.tsx` (`VideoCaptureRecorder`) is an in-browser capture control using the
browser's native `MediaRecorder` — no client-side transcoding library is bundled (same "no ffmpeg in this
environment" constraint as the server-side `PassthroughVideoCompressionProvider`, D-024). Enforces the
policy already defined server-side (`lib/storage/video-compression.ts`: 720p, 24-30fps, 30-60s configurable,
configurable target bitrate) on the client, before a byte is ever uploaded:
- Requests `{width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: maxFps, max: maxFps}}` from
  `getUserMedia` — deliberately `ideal`, not a hard `min`, for frame rate (a hard minimum throws
  `OverconstrainedError` and refuses to open the camera at all on any device that can't guarantee it; found
  live against Chromium's own fake-camera device during this phase's verification, see WORKLOG.md Session
  17). Whatever the browser actually negotiates is what gets reported afterward — never assumed to match
  the request.
- A visible countdown during recording and an automatic `MediaRecorder.stop()` at the configured maximum
  duration (30-60s, clamped by `clampMaxDurationSeconds()`).
- A live estimated-file-size display during recording (`estimateFileSizeBytes()`, duration × target
  bitrate) and a real policy check against the *actual* encoded blob size once recording stops
  (`checkCapturedVideoAgainstPolicy()`) — a recording that ends up over the size or duration limit is
  rejected with a re-record path, never silently uploaded anyway. The client-side size ceiling mirrors the
  server's own `MAX_VIDEO_BYTES`, but the server re-validates independently regardless — the client check
  exists for immediate user feedback, not as the only enforcement layer.
- **Honest capture metadata, never a false claim of transcoding.** `CapturedVideoMetadata` records the
  actual negotiated width/height/frame-rate (from `MediaStreamTrack.getSettings()`), actual duration, actual
  bitrate (computed from the real encoded size), actual file size, and the actual `mimeType` `MediaRecorder`
  used (`pickSupportedMimeType()` prefers `video/mp4;codecs=h264` but falls back to whichever VP9/VP8/WebM
  variant the browser actually supports — Chromium/Firefox mostly cannot record mp4/h264 at all — and
  reports whichever one was genuinely selected, never the preferred one if a fallback was actually used).
  `actualCompressionApplied` is always `false`: this component's job is policy-constrained *capture*, not
  policy-verified transcoding — that distinction remains the server's `PassthroughVideoCompressionProvider`,
  whose own `transcoded: false` is unchanged by this phase.

Wired into the gate inspection evidence-capture flow (`/gate/events/[id]`) as a "Record video" alternative
alongside the pre-existing plain file picker (kept as the fallback for unsupported browsers/denied camera
permission) — attaches `category: VEHICLE_INSPECTION_VIDEO` and the capture metadata on upload, which
required extending `uploadMediaAssetFormSchema`/`POST /api/media/upload` to accept a JSON-encoded
`captureMetadata` form field (multipart/form-data has no native nested-object field type), mirroring the
JSON-body presigned-upload path's pre-existing support for the same field.

## Movement authorisation architecture (Phase 2)
`MovementAuthorisation` has its own state machine — a pure, DB-free transition table in
`lib/movements/state-machine.ts` (`isValidMovementTransition`, `assertValidMovementTransition`), the same
"pure decision function, DB-free, directly unit-tested" pattern already used for `evaluateSession()`.
DRAFT → SUBMITTED → APPROVED → IN_PROGRESS → COMPLETED is the happy path; REJECTED/CANCELLED/EXPIRED are
terminal. Every write goes through `movement-repository.ts`'s `transition()` helper, which checks the
table before writing and audit-logs before/after status. Self-approval (`approveMovement`) is blocked
unless `Tenant.allowSelfApproveMovement` is explicitly true (default false) — checked against
`requesterUserId === approverUserId`, not against role, so it holds even if a future role grants both
CREATE and APPROVE to the same person.

The gate-facing lookup (`searchMovementsForGate`, `/api/gate/movements/search`) is read-only by
construction: that route file only exports `GET`, there is no PATCH/PUT/DELETE handler anywhere under
`/api/gate/`, and DRAFT movements are excluded from results (a draft isn't a real request yet). A Gate
Security Officer's seeded role has `movement:VIEW` only — no EDIT/CREATE/APPROVE/REJECT/DELETE — so even
if a future refactor accidentally added a mutating gate endpoint, that role couldn't call it without an
explicit new permission grant.

## Gate operations architecture (Phase 3)
`GateEvent` models a vehicle's actual presence/processing at a gate — distinct from
`MovementAuthorisation`'s own pre-gate approval state machine (done in Phase 2). Its own pure, DB-free
transition table lives in `lib/gate-events/state-machine.ts` (`isValidGateEventTransition`,
`assertValidGateEventTransition`), same pattern as `lib/movements/state-machine.ts`. States: `EXPECTED →
INSPECTION_STARTED → IDENTITY_PENDING → IDENTITY_VERIFIED → VEHICLE_CHECKS_IN_PROGRESS → (EXCEPTION_RAISED
→ SUPERVISOR_REVIEW)* → CLEARED | DENIED → COMPLETED`, with `CANCELLED` reachable from every non-terminal,
non-decided state. `EXCEPTION_RAISED` can resolve directly back to `VEHICLE_CHECKS_IN_PROGRESS` (a
non-serious exception the officer clears themselves) or escalate to `SUPERVISOR_REVIEW` (a serious one);
`SUPERVISOR_REVIEW` resolves back to checks or terminates the event at `DENIED`. Every write goes through
`gate-event-repository.ts`'s `transitionGateEvent()` helper, which checks the table before writing and
audit-logs before/after status, identically to `movement-repository.ts`'s `transition()`.

`startGateEvent()` combines "start" and "begin inspection" into one call (`EXPECTED` →
`INSPECTION_STARTED`) so the officer's single tap starts the record — see D-010. It is idempotent: a
second call for the same `movementAuthorisationId` while one GateEvent is still open (non-terminal) returns
the existing row rather than creating a duplicate. It also re-checks driver/vehicle availability at gate
time (not just trusting the earlier movement approval) — defense in depth, since a driver/vehicle can be
suspended/locked *after* a movement was approved but before the vehicle physically reaches the gate; the
same re-check happens again in `clearGateEvent()` immediately before a CLEARED decision is recorded.

**Inspection engine (GATE-006).** `InspectionTemplate` (tenant-scoped, versioned via immutable new rows —
see D-009) holds an ordered `InspectionItem[]` grouped by `InspectionSection` (driver/authorisation,
vehicle identity, exterior condition, lights, tyres/wheels, operational info, load verification).
`getActiveTemplateForCategory()` picks the tenant's active category-specific template, falling back to a
generic (`vehicleCategory: null`) one — `startGateEvent()` calls this once, at creation, and stores the
chosen `inspectionTemplateId` on the `GateEvent` permanently. `GateEventInspectionItem` records the actual
answer (`PASS`/`FAIL`/`NOT_APPLICABLE`/`UNABLE_TO_VERIFY`, plus a reading value/unit for `READING`-type
items) against one item for one gate event; `evidenceRef` is a dev-mode placeholder URL string only, same
as `Driver.portraitUrl`/`ComplianceDocument.attachmentUrl` — no real upload until Phase 4.

**Exceptions and approvals (GATE item 3, GATE-005 for GateEvent).** A `FAIL` outcome on an inspection item
whose `InspectionItem.defaultExceptionSeverity`/`requiresSupervisorApprovalOnFail` are set automatically
raises an `Exception` (`raiseException()`) tied to that result, and moves the GateEvent to
`EXCEPTION_RAISED`; an officer can also raise one ad hoc. `ExceptionType` is the tenant-configurable
category catalogue (code/label/default severity/default outcome/`requiresSupervisorApproval`) — same shape
and purpose as `DocumentExpiryRule`. `resolveException()` enforces a **hard, non-tenant-configurable**
self-approval rule whenever `requiresSupervisorApproval` is true: the officer who raised it can never be
the one who resolves it, regardless of role/permission (see D-008 for why this deliberately doesn't reuse
`Tenant.allowSelfApproveMovement`'s opt-out pattern) — and it must first be explicitly escalated to
`SUPERVISOR_REVIEW` (`escalateExceptionToSupervisor()`) before it can be resolved at all. Resolution outcome
actions split into two groups: `WARNING`/`CLEARED_WITH_OBSERVATION`/`MANUAL_REVIEW`/`SUPERVISOR_APPROVAL`
return the GateEvent to `VEHICLE_CHECKS_IN_PROGRESS`; `WORKSHOP_LOCKOUT`/`SECURITY_HOLD`/`DENIED` terminate
it at `DENIED`. In the seeded permission matrix, `exception:CREATE` (raise) and `exception:APPROVE`
(resolve) are deliberately granted to different roles (Gate Security Officer vs Security Supervisor /
Approving Manager) so the
authorization boundary is meaningfully testable — the hard self-approval rule inside the repository
function is the actual, unconditional guarantee, independent of that role split (same "defense in depth,
not role-name-based" principle as D-007).

**Driver verification wiring (GATE item 5).** `verifyIdentityForGateEvent()` calls the existing
`FacialVerificationProvider` (mock in dev — no new mechanism built) against the driver on the linked
`MovementAuthorisation`; a `VERIFIED` result advances `IDENTITY_PENDING → IDENTITY_VERIFIED` automatically,
any other result records the attempt and leaves the officer to retry, request the existing
`ManualFacialVerificationFallback` flow, or raise an exception. Once a supervisor approves a manual
fallback request, `markIdentityVerifiedManually()` confirms it against the GateEvent.

**Security dashboard (GATE-002).** `security-dashboard-repository.ts`'s `getSecurityDashboardData()` is the
single place the dashboard's numbers are computed — real DB aggregate queries only (counts, `findMany`),
no static/mock values. It reuses `evaluateDocumentExpiry()` (Phase 2) for the expiring-documents panel,
closing the "no dedicated dashboard yet" gap flagged in TODO.md since MD-004.

## Reconciliation architecture (Phase 5B, see PRODUCT_REQUIREMENTS.md RECON-001..003)
`Reconciliation` pairs one movement's departure and return `GateEvent` and compares what each recorded.
"Departure" and "return" are assigned by chronological `completedAt` order, not a hardcoded
`ENTRY`/`EXIT` assumption — this works identically for a fleet vehicle leaving-then-returning (`EXIT`
then `ENTRY`) and a visiting vehicle entering-then-leaving (`ENTRY` then `EXIT`); the two legs are only
required to be in *opposite* directions, never the same one.

**Pairing (`reconciliation-repository.ts` `buildReconciliation()`).** Idempotent by construction, same
pattern as `startGateEvent()`: a repeat call for an already-paired movement (or an already-paired explicit
gate-event pair) returns the existing row unchanged. Validation order: same-event check (a malformed
request can't be masked by the idempotency lookup) → idempotency lookup → duplicate-pairing check (a
`GateEvent` can be the departure or return leg of at most one `Reconciliation`, ever — enforced by a DB
`@unique` constraint on each column, not just application code) → both legs `COMPLETED`/`CLEARED` → same
movement → same vehicle (defense in depth — always true given the first check, kept anyway) → opposite
directions → departure not completed after return. Auto-triggered best-effort from
`completeGateEvent()` (not fatal if the other leg doesn't exist yet — the common case, since this fires on
the departure leg too); also exposed as `POST /api/reconciliations` for a manual retry
(`reconciliation:CREATE`).

**Comparison (`lib/reconciliation/discrepancy-engine.ts`).** Pure, DB-free, unit-tested in isolation (same
family as `lib/gate-events/state-machine.ts` and `lib/documents/expiry-rules.ts`). Reads the departure and
return `GateEventInspectionItem` answers keyed by `inspectionItemId` and categorises purely off the
existing tenant-configurable `InspectionSection`/`unit` taxonomy — `OPERATIONAL_INFO`+`km` → odometer,
`OPERATIONAL_INFO`+`%` → fuel, `TYRES_WHEELS` → tyre, `EXTERIOR_CONDITION` → vehicle condition,
`LOAD_VERIFICATION` → cargo/seals/tools/equipment/passengers. A tenant's own custom inspection items are
compared automatically with no engine change ("where configured" in RECON-001) since nothing is keyed off
a specific item label. `MovementAuthorisation.expectedDistanceKm` (optional) is the only reconciliation-
specific input outside the inspection answers — set at dispatch time, compared against actual
`kmTravelled` for the "excess mileage" check; null skips that one check rather than treating it as zero.

**Discrepancies (RECON-002).** `ReconciliationDiscrepancy` never concludes fraud/theft/criminal conduct —
only a factual departure-vs-return delta plus a severity (`LOW`/`MEDIUM`/`HIGH`, reusing
`ExceptionSeverity`; the auto-engine never assigns `CRITICAL` itself). A `HIGH` discrepancy raises a real
`Exception` against the *return* `GateEvent` directly (not via `gate-event-repository.ts`'s
`raiseException()` — that would also attempt a `GateEvent` state transition, meaningless once both legs
are terminal/`COMPLETED`, and importing it would create a circular dependency between the two repository
modules) — RECON-002's "via the existing Phase 3 exception workflow rather than a parallel mechanism",
satisfied by writing to the same `Exception` table gate operations already use, not a second one. Human
review/explanation/resolution is one step (`resolveDiscrepancy()`): a mandatory `resolutionNotes`
explanation plus an optional `correctiveAction`, `reconciliation:APPROVE`-gated, separate from
`reconciliation:EDIT` (adding notes without the authority to close it out) the same way `exception:CREATE`
and `exception:APPROVE` are split. `Reconciliation.status` is derived, not independently settable:
`NO_DISCREPANCIES` at build time if none were found, `OPEN` while any discrepancy remains `OPEN`,
`RESOLVED` once every discrepancy on it reaches `RESOLVED`.

## Telematics architecture (Phase 6, see PRODUCT_REQUIREMENTS.md GPS-001..006/GPS-BLOCKED, POLICY-001/002)
`TelematicsProvider` (`lib/telematics/provider.ts`) is the adapter boundary a real GPS vendor plugs into —
same shape and purpose as `FacialVerificationProvider`/`StorageProvider`. Only `MockTelematicsProvider`
exists (deterministic, `force:<outcome>` markers in the provider vehicle id — `force:unavailable`,
`force:offline`, `force:ignition-off`, `force:at:<lat>,<lng>`); production connection is blocked
(GPS-BLOCKED, INTEGRATIONS.md).

**Sync (GPS-001/003, `telematics-repository.ts` `syncVehicleTelematics()`).** Pulls one snapshot from the
provider for a vehicle already carrying `gpsDeviceReference` (the tracker mapping itself was already
possible via Phase 2's generic `updateVehicle`), records a `TelematicsEvent`, and updates
`Vehicle.gpsStatus`/`gpsLastCommunicationAt`. A snapshot older than 30 minutes (`lastCommunicationAt`) is
never trusted as current — `gpsStatus` goes `INACTIVE` and geofence/policy compliance is not evaluated
against it (GPS-006 "stale data is flagged, not silently trusted" — an unreliable position must not
generate a false violation). A provider failure (`TelematicsProviderUnavailableError`) is caught, marks the
vehicle `INACTIVE`, and re-thrown as a typed error the calling route maps to 503, never a raw 500.

**Manual GPS confirmation (GPS-002, `ManualGpsConfirmation`).** A direct mirror of
`ManualFacialVerificationFallback`/`facial-verification-repository.ts` — office staff record a manual
confirmation of a vehicle's whereabouts by phone/radio when the (mock) provider is offline; a different
user resolves it (hard, unconditional self-approval block, same as facial verification's equivalent — see
D-008's reasoning, applied here without a tenant-configurable opt-out for the same "integrity isn't
optional" principle).

**Geofencing and policy compliance (GPS-004, POLICY-001/002,
`lib/telematics/geofence-engine.ts` + `evaluateVehiclePolicyCompliance()`).** `Geofence` is deliberately a
simple circle (center + radius), not a polygon/map-drawing tool — "basic geofence monitoring" is the
explicit GPS-004 scope. `VehicleUsePolicy` (POLICY-001's full field list: named driver, one-or-more
assigned vehicles via the `VehicleUsePolicyVehicle` join table, effective dates, permitted days/hours,
approved destination/geofence, km limits per trip/day/week/month, after-hours/weekend/private-use flags,
expected return time, a named approving manager, status, override reason) starts `DRAFT` and only the named
`approvingManagerUserId` can move it to `ACTIVE` (`approveVehicleUsePolicy()` — if no manager was named at
creation, the first `vehicleUsePolicy:APPROVE`-holder to approve becomes the manager of record).
Every non-stale `TelematicsEvent` for a vehicle with an `ACTIVE` policy assignment is compared against it
via the pure `evaluatePolicyCompliance()` — geofence deviation, day/hour restrictions, distance-limit
breaches — never concluding fraud/theft/criminal conduct (POLICY-002/GPS-005), only naming which configured
rule a reading fell outside of.

**Timezone-aware evaluation (Phase 8A, HARD-004).** Day-of-week/hour/weekend checks are evaluated in the
tenant's configured IANA timezone (`Tenant.timezone`, a Phase 1 field that sat unused until this phase —
default `Africa/Johannesburg`), not the server's local/UTC clock — `getWallClockParts()` uses
`Intl.DateTimeFormat` with `hourCycle: "h23"` against the target `timeZone` rather than `Date.getDay()`/
`getHours()`. A reading recorded late at night UTC can already be the next calendar day locally; evaluating
against the wrong clock would silently misjudge permitted-day/hour compliance.

**Real distance accumulation (Phase 8A, HARD-005, closing the TODO.md gap this phase).**
`lib/telematics/distance-engine.ts` is a second pure module (same "pure, DB-free" family as
`geofence-engine.ts`) that computes trip/daily/weekly/monthly distance travelled from a vehicle's ordered
`TelematicsEvent` odometer readings: **trip** distance is measured from the most recent ignition-off→on
transition found in the lookback window (falling back to the earliest available reading if ignition has
been on throughout, or `null` if no ignition signal exists at all — never guessed); **daily/weekly/monthly**
distance is measured from the last known odometer reading at/before the start of that calendar
day/week/month **in the tenant's timezone** to the latest reading, clamped to zero rather than reported
negative on an odometer rollback/vehicle swap. A missing baseline (no reading exists before the window
started) returns `null`, not zero — a fabricated zero could silently mask a real violation.
`evaluateVehiclePolicyCompliance()` fetches a 45-day lookback of `TelematicsEvent` rows (wide enough to
always contain a full month) and feeds them to `computeDistanceSoFar()` before calling the geofence engine,
so all four of `kmLimitPerTrip/Day/Week/Month` are now real checks, not the previous hardcoded `null`.

**GPS-exception deduplication (Phase 8A, HARD-006).** Before this phase, every `syncVehicleTelematics()` call
that found a violation created a brand-new `Exception` row — a vehicle stuck outside its approved geofence
for a week of hourly syncs would raise ~168 open exceptions for the same underlying fact.
`reconcileTelematicsViolations()` (`telematics-repository.ts`) instead treats each violation type as an
*episode*: `Exception.violationType` (new column, nullable — only telematics/policy exceptions set it)
identifies which `PolicyViolationType` an open row is tracking; a repeat sync that still finds the same
violation type updates that same row (`observationCount++`, `lastObservedAt`) instead of creating a
duplicate; a violation type no longer present in the latest sync's results is automatically resolved
(`resolvedAt` set, `resolutionNotes: "Automatically cleared — vehicle telemetry showed compliance..."`,
audit-logged as `telematics.policyViolationCleared` — distinct from a human resolving it) — including when
the vehicle's policy assignment is removed/suspended/expired entirely, since "nothing left to violate" is
itself a return to compliance. A violation re-observed across `ESCALATION_OBSERVATION_THRESHOLD` (3)
consecutive syncs is escalated to `HIGH`/`requiresSupervisorApproval: true` even if it started `MEDIUM`
(audit-logged as `telematics.policyViolationEscalated`) — a continuing violation deserves escalated human
review, not indefinite silent repetition at its original severity. A gate-event/reconciliation exception
(`violationType: null`) is never touched by this reconciliation.

**Reusing (not parallelling) the Exception model (GPS-005/POLICY-002, see DECISIONS.md D-020).**
`Exception.gateEventId` became nullable and a new `Exception.vehicleId` was added — a telematics/policy
exception is created directly against the vehicle, with no GateEvent involved (unlike every Phase 3/5B
exception, which always sets `gateEventId`). Written directly via `prisma.exception.create()` in
`telematics-repository.ts` rather than through `gate-event-repository.ts`'s `raiseException()`, for the
same reason as D-018's reconciliation exceptions: that function also attempts a meaningless GateEvent state
transition, and importing it would create a circular dependency risk given how tightly the two repository
modules would otherwise couple. Unlike reconciliation, telematics sync is *not* currently auto-triggered
from any GateEvent lifecycle hook — it's triggered by an explicit `POST /api/vehicles/[id]/telematics/sync`
call, matching how a real GPS vendor would push/poll independently of gate activity, not tied to a vehicle
physically being at a gate.

## Platform support-access architecture (Phase 7, see PRODUCT_REQUIREMENTS.md SUPPORT-001..004)
A new, separately-scoped, fully audited mechanism for platform staff to read a customer tenant's data —
deliberately **not** an extension of `platform-tenant-repository.ts` (that file's own comment already
anticipated this: "If a future support-access feature needs to read a customer tenant's business data, it
must be a new, separately-scoped, similarly audited mechanism — not an extension of this file", D-005).
Everything lives in `support-access-repository.ts` instead, with two distinct trust levels:

**Level 1 — the customer list (SUPPORT-001).** `getCustomerHealthSummaries()` is gated by the existing
`platformTenant:VIEW` alone — no support session needed — because it only ever returns *aggregate counts*
(sites, gates, vehicles, users, open HIGH/CRITICAL exceptions, GPS-active vehicle count, storage bytes,
last-activity timestamp, a derived onboarding status), never an individual business record. This is the
same "safe to browse before deciding whether to open a support session" tier as a real support-ops
dashboard.

**Level 2 — the support session and view (SUPPORT-002/003/004).** A `SupportAccessSession` is a
*permission window* layered on top of an already-authenticated platform session — not the same thing as
`Session` (that's the actor's own login, unaffected). Starting one (`startSupportAccessSession()`) requires
a mandatory `reason`, is time-limited (60 minutes, `SUPPORT_ACCESS_SESSION_TTL_MINUTES`), and is fully
audited. `getSupportViewForCustomer()` — the actual "controlled support view" — refuses to return anything
at all unless `getActiveSupportAccessSession(actorUserId, customerTenantId)` finds a matching, unexpired,
unended row; this check is scoped to *both* the specific actor *and* the specific customer tenant, so a
session opened against Tenant A grants zero access to Tenant B (SUPPORT-004 tenant isolation) and an
expired session is rejected on the very next request, the same "re-check live, don't trust a cached
decision" principle as `evaluateSession()`. The view itself is a bounded, read-only summary (site/gate
names, aggregate vehicle/driver counts, open exceptions, recent movements, support notes) — deliberately
excluding facial-verification enrolment detail, raw `MediaAsset` content, and investigation-case data (that
module doesn't exist yet regardless), satisfying "no default biometric/investigation-case access."

**Exit and elevation (SUPPORT-003).** `endSupportAccessSession()` is the "immediate exit action" — only
the actor who started a session may end it, and doing so revokes support-view access to that customer
immediately (verified in tests, not just assumed). `elevateSupportAccessSession()` is a second, deliberate,
separately-permissioned (`supportAccessSession:CONFIGURE`) action recording an elevation reason and
timestamp — but, per D-021, it currently only *records* elevated intent/audit trail; it does not itself
unlock a write path on any customer resource (movements, drivers, vehicles, ...). Building that out is
explicitly deferred until a real "platform support needs to make an authorised change" use case exists,
rather than speculatively wiring a cross-cutting elevated-write mechanism into every existing repository
function ahead of need.

**Platform-side roles.** Platform Administrator gets full `supportAccessSession` (VIEW/CREATE/CONFIGURE)
alongside its existing `platformTenant` grants; a new "Platform Support Analyst" role (D-016) gets
`platformTenant:VIEW` (to browse the customer list) plus `supportAccessSession:VIEW`/`CREATE` but
deliberately not `CONFIGURE` — elevation stays an Administrator-only action.

## Facial verification architecture (Phase 9, see PRODUCT_REQUIREMENTS.md FACE-001..009, FACIAL_VERIFICATION_LICENSING.md)

Extends, does not replace, the existing `FacialVerificationProvider` adapter and
`ManualFacialVerificationFallback` human-in-the-loop workflow (both unchanged) — Phase 9 adds a real
on-device recognition/liveness pipeline behind that same "verify one specific driver" boundary.

**Commercial licensing verified before any model was added (Phase 9B).** Two libraries, two strictly
separated purposes, both traced to a primary source, not a secondary summary: `@mediapipe/tasks-vision`
(Apache-2.0, both code and models per Google's own published model cards) for face detection, 478-point
landmarks, and liveness geometry — never identity, per that model's own stated scope; `@vladmandic/face-api`
(MIT wrapper) for the recognition descriptor only, using its bundled `face_recognition_model` (a dlib
ResNet-34 derivative whose weights Davis King explicitly released into the public domain). face-api.js's own
face-detection and 68-point-landmark/alignment models are never loaded — the landmark model's training
dataset (iBUG 300-W) explicitly excludes commercial use. Full verification, exact versions, checksums, and
known limitations: `FACIAL_VERIFICATION_LICENSING.md`.

**Enrolment (9C, `lib/repositories/facial-enrolment-repository.ts`).** 3-5 guided captures, each checked
client-side for one-face-in-frame/lighting/blur/size/position
(`lib/facial-verification/capture-quality.ts`, pure) before being accepted; the accepted captures'
descriptors are averaged into one canonical template (`meanDescriptor()`) after confirming they're mutually
consistent (each within `MAX_INTRA_CAPTURE_DISTANCE` of the mean — rejects a batch that doesn't look like
one person). The template — a ~512-byte float array, never an image — is encrypted at rest
(`lib/facial-verification/template-encryption.ts`, AES-256-GCM, key from an environment variable never
stored in this database) before being written to `DriverFacialTemplate`. Re-enrolment revokes the previous
ACTIVE row in the same transaction as creating the new one; a partial unique index
(`driver_facial_templates_one_active_per_driver`, `WHERE status = 'ACTIVE'`) enforces at the database level
that at most one template is ever ACTIVE per driver, the same pattern already used for `JobRun`. Gated by a
restricted `facialTemplate:CREATE`/`VIEW`/`DELETE` permission — a separate resource from ordinary
`driver:EDIT`, granted to Company Administrator only in the seed data. `getFacialEnrolmentStatus()`/
`listFacialTemplateHistoryForDriver()` never return template bytes, only status metadata.

**One-to-one matching (9D, `runOnDeviceFacialVerificationAttempt()` in
`lib/repositories/gate-event-repository.ts`).** Compares a live descriptor — computed client-side, sent to
the server as plain numbers, never raw image/video bytes — against exactly the one driver assigned to the
gate event's own `MovementAuthorisation`, via `getActiveTemplateDescriptorForDriver()`
(tenant-scoped, driver-scoped) — never a global search across every enrolled driver. `evaluateMatch()`
(`lib/facial-verification/descriptor-math.ts`, pure) returns a three-tier outcome from Euclidean distance:
MATCH (≤0.5), REVIEW_REQUIRED (0.5-0.6), NO_MATCH (>0.6) — the same LFW-benchmark-tuned 0.6 threshold dlib's
own documentation recommends. A `FacialVerificationAttempt` audit row is written for every attempt
regardless of outcome (MATCH/NO_MATCH/REVIEW_REQUIRED/NOT_ENROLLED/CAPTURE_FAILED/LIVENESS_FAILED/
PROVIDER_UNAVAILABLE), recording confidence, threshold, template/model version, capture quality, liveness
result, gate, device label, and the security officer — the gate event's state machine only advances to
IDENTITY_VERIFIED on a genuine MATCH; every other outcome leaves it in IDENTITY_PENDING for the officer to
retry or fall back to the existing manual workflow. Rate-limited server-side (5 attempts per gate event per
5-minute window, `TooManyVerificationAttemptsError` → HTTP 429) so repeated attempts must escalate to a
supervisor rather than retrying indefinitely, enforced independent of whatever the client itself does.

**Basic on-device liveness (9E, `lib/facial-verification/liveness-challenge.ts`, pure).** A random active
challenge (blink / turn head left / turn head right / move closer), evaluated against a stream of per-frame
signals (blendshape eye-blink scores and an approximate head-yaw heuristic from MediaPipe's landmarks — see
that file's own docstring for exactly how, and its documented imprecision). A single still frame can never
complete a challenge (`minContinuousFrames`); every frame in the window being identical is classified as
`FAILED_STATIC_INPUT`, distinct from merely "no progress yet" — the two together are what actually prevent
a static printed photo from passing. A FAILED liveness result short-circuits the matching step entirely in
`runOnDeviceFacialVerificationAttempt()` — a spoofed capture whose descriptor happens to be close to the
enrolled template still cannot produce MATCH. **Explicitly documented as basic landmark-geometry liveness,
not a specialised commercial anti-spoofing product** — no depth sensing, no infrared, no trained
spoof-detection model; it raises the bar against the simplest attacks, it is not proof against a
sufficiently determined one. The security officer physically present at the gate remains responsible for
observing the person — this challenge is a supporting check, never a replacement for that.

**Cloud liveness fallback (9F, `lib/facial-verification/cloud-liveness-provider.ts`,
`lib/repositories/cloud-fallback-repository.ts`).** Same "interface + honest no-op, real vendor deferred"
pattern as every other unselected provider — `NoOpCloudLivenessProvider` always returns
`PROVIDER_UNAVAILABLE` with a stated reason, never a fabricated result. No AWS/Azure/GCP or other paid
biometric-liveness account exists (`FACIAL_VERIFICATION_LICENSING.md`). Every invocation attempt — intended
trigger conditions: REVIEW_REQUIRED, repeated on-device failures, a high-risk tenant policy, random
sampling, or a supervisor's explicit request — is still recorded in `CloudFallbackInvocation`, tracked per
tenant, so a future real integration has usage history to bill against from day one.

**Security and privacy (9G).** Biometric templates encrypted at rest with a key that lives outside this
database (`template-encryption.ts`); never logged, and no route ever returns template bytes (verified by
dedicated tests). Every lookup is tenant-scoped via the existing `tenantWhere()` convention. Camera frames
captured during enrolment/verification exist only as transient in-memory canvas elements, garbage-collected
after the descriptor is computed — no raw enrolment video or verification-capture image is stored anywhere
by default. Verification attempts are rate-limited server-side; repeated failures are the client-side
trigger for supervisor escalation (`shouldEscalateAfterFailure()`). The existing manual-fallback workflow is
completely unchanged and still available at every step. Facial matching alone can never approve an
unapproved movement: it only ever transitions a `GateEvent` already inside an already-`APPROVED`
`MovementAuthorisation`'s check-in flow from IDENTITY_PENDING to IDENTITY_VERIFIED — one gate among several
(inspection, exceptions, the officer's own clearance decision) before a vehicle is actually cleared, not a
sole final action.

**Gate-tablet interface (9H).** `components/gate-facial-verification.tsx` shows large, simple states
(instruction → verifying → "Verified"/"Not verified") — never a raw numeric confidence score on this
screen. Handles denied camera permission, an unsupported browser, and a model-load failure
(`providerUnavailable`) by surfacing a clear message and pointing at the existing manual-fallback path,
never a silent hang. `components/driver-facial-enrolment.tsx` shows the biometric-processing notice and
requires an explicit consent acknowledgement before the camera is ever requested.

## Integration boundaries
`FacialVerificationProvider` (`lib/facial-verification/provider.ts`) has a deterministic mock
implementation (`mock-provider.ts`, driven by `force:<outcome>` markers in the capture reference — see its
docstring) and a separate `ManualFacialVerificationFallback` model/repository for the human-in-the-loop
path (request → supervisor approve/deny, self-approval blocked, every step audit-logged) — both unchanged
by Phase 9's real on-device recognition/liveness pipeline layered alongside them (see "Facial verification
architecture" above). `TelematicsProvider` is built (Phase 6, mock only). No facial-recognition-vendor
*cloud* API, telematics vendor, or cloud-liveness vendor is selected yet (blocked pending decision — see
`INTEGRATIONS.md`); the on-device recognition model itself (dlib-derived, CC0) required no such decision —
its licensing was independently verified (Phase 9B). Provider selection must not require changing call
sites.

## Deployment topology (target, not yet built — Phase 7)
Single Next.js app + managed Postgres + object storage, behind HTTPS, environment-driven config. Local
dev: Next.js dev server + Dockerised Postgres. Staging/production topology to be finalised in
`DEPLOYMENT.md` once a hosting decision is made (flagged as a major decision when we reach Phase 7).

## Technical constraints
- All timestamps stored UTC; tenant timezone is a display concern only.
- No secrets in the repo; `.env.example` documents required variables with placeholder values.
- Large media uploads must not block the main request thread — uploads go direct-to-storage via
  presigned URLs where the provider supports it, with server-side verification after upload completes.

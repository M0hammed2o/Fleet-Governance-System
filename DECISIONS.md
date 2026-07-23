# DECISIONS.md

## D-001 — 2026-07-19 — Data layer: Prisma over raw Supabase SDK
**Context:** Build brief allows Supabase for managed Postgres/auth/storage but requires the architecture
not be tightly coupled to it.
**Decision:** Use Prisma ORM against plain PostgreSQL. Local dev = Docker Postgres. Supabase, if adopted
later, is used purely as a hosted Postgres endpoint (connection string swap), not its SDK/RLS-via-client
features.
**Alternatives considered:** Supabase JS client directly (rejected — couples business logic to one
vendor); raw `pg` + hand-written SQL (rejected — slower to build tenant-scoped repositories safely).
**Consequences:** Need to hand-build Row Level Security policies later if wanted, rather than getting them
free from Supabase's client-side auth context. Acceptable — tracked as TODO SEC-2.
**Revisit condition:** If we choose Supabase Storage for media, its access-control model needs its own
review at that time.

## D-002 — 2026-07-19 — Auth: custom session store, not NextAuth/Supabase Auth
**Context:** Need MFA-ready, revocable, tenant-aware sessions with a permission model driven by
`Role`/`Permission` tables rather than provider-specific claims.
**Decision:** Custom auth: bcrypt password hashing, DB-backed `Session` table, opaque session id in a
signed httpOnly cookie. No third-party auth library in V1.
**Alternatives considered:** NextAuth.js (rejected for V1 — its session/JWT model fights a DB-revocable,
tenant-scoped permission system; would need heavy customisation anyway); Supabase Auth (rejected — same
coupling concern as D-001, and its RBAC doesn't map cleanly to our granular resource+action permissions).
**Consequences:** We own password reset, session expiry, and (future) MFA flows ourselves — more code,
but full control over tenant isolation at the auth layer.
**Revisit condition:** If SSO/enterprise IdP becomes a near-term requirement, revisit — likely add an
OIDC adapter alongside, not replace, the session store.

## D-003 — 2026-07-19 — Dedicated git repo scoped to the project folder
**Context:** The only pre-existing git repo on this machine was rooted at the Windows user home
directory (`C:/Users/junsm`), with zero commits but already staged to track the entire profile
(AppData, registry hives, OneDrive, etc.) — not a usable repo for this project.
**Decision:** `git init` a new repo directly inside the project folder; leave the home-directory repo
untouched (not this project's data to modify without being asked).
**Consequences:** None — home repo had no commits, nothing was at risk of being lost.
**Revisit condition:** None; purely informational, flagged to the user in the Phase 0 report.

## D-004 — 2026-07-20 — Password reset and reauthentication designs documented but not built
**Context:** Phase 1 security closure asked to close out user invitation, suspension, and related items
without letting password reset or sensitive-action reauthentication block Phase 2, since both eventually
need an external decision (email provider) or a concrete Phase 3+ sensitive action to attach to.
**Decision:** Design both fully in `SECURITY_AND_POPIA.md` ("Deferred design" sections) — schema-ready,
reusing the same hashed-bearer-token pattern as `Session`/`UserInvitation` — but implement neither now.
**Alternatives considered:** Building password reset now with the token returned directly in the API
response (same as invitation, no email dependency) — rejected for this pass because it isn't blocking
anything on the request, and the reauthentication design has no real caller yet (nothing in Phase 1/2 is
sensitive enough to need it) — building it now would be speculative.
**Consequences:** FOUND-003 and FOUND-010 stay `todo` in PRODUCT_REQUIREMENTS.md with a written design to
implement against later, not a blank slate.
**Revisit condition:** Implement password reset the moment either (a) an email provider is chosen, or (b)
the user asks for it explicitly regardless of email (dev-mode token-in-response, same pattern as invite).
Implement reauthentication when Phase 3+ introduces its first genuinely sensitive action.

## D-005 — 2026-07-20 — Platform Administrator given a dedicated `platformTenant` permission resource, not blanket access
**Context:** Build brief says Platform Administrator "manages tenant organisations" but also "cannot
silently access tenant evidence" — these two requirements don't fit the ordinary tenant-scoped
Role/Permission model, which otherwise has no way to express "spans tenants" at all.
**Decision:** Platform Administrator users live in their own system "platform" tenant and are granted a
new cross-tenant-only permission resource, `platformTenant` (view/create/edit/configure), which governs
exactly one thing: `Tenant` rows themselves (name/slug/status). Every function that uses it
(`platform-tenant-repository.ts`) is both permission-checked and audit-logged inline, so there is no code
path that grants cross-tenant reach without leaving a record. No permission grants Platform Administrator
access to any tenant's business data (drivers, vehicles, sites, users, evidence, ...).
**Alternatives considered:** A boolean `isPlatformAdmin` flag bypassing tenant scoping entirely — rejected,
directly contradicts "cannot silently access tenant evidence" and the brief's general preference for
granular permissions over role-name/flag checks.
**Consequences:** If a future "support access to a customer tenant's data" feature is needed, it must be a
new, separately-scoped, similarly audited mechanism (tracked in TODO.md as "break-glass") — this decision
deliberately does not provide a shortcut to that.
**Revisit condition:** Before onboarding any real (non-fictional) customer tenant, since that's when the
lack of a support-access mechanism first has real operational cost.

## D-006 — 2026-07-21 — No dedicated Department entity in Phase 2
**Context:** Build brief section 7.1 lists "Departments" alongside Sites/Gates as org structure, but the
Phase 2 instructions' explicit implementation order only named "Organisation, site and gate
administration" — Department wasn't scoped into that list, and no Phase 2 test references it.
**Decision:** `Driver.department` is a plain string field, not a foreign key to a Department entity.
**Alternatives considered:** Full Department model with its own CRUD, nested under Site — rejected as
scope creep beyond what was asked for in this pass; a string field satisfies "captured" without the
entity/relationship overhead.
**Consequences:** No department-level reporting or permission scoping is possible yet.
**Revisit condition:** If a future phase needs department-level access control or reporting, promote the
string to a real entity then — noted in TODO.md.

## D-007 — 2026-07-21 — Movement/document business rules live in the repository layer, not routes
**Context:** Self-approval prevention, driver/vehicle eligibility checks, and state-machine enforcement
all needed a decision: put the check in the API route (like tenant-ownership checks already are) or in
the repository function itself.
**Decision:** Business rules that must hold no matter who calls the function (self-approval, eligibility,
valid transitions) live in `movement-repository.ts` / `facial-verification-repository.ts` themselves, not
just the route. Tenant-ownership-of-a-foreign-key checks (e.g. "does this vehicleId belong to my tenant")
stay in the route, since they need the caller's session/tenant context that the repository function
receives as a plain tenantId parameter anyway.
**Alternatives considered:** Route-only enforcement (rejected — a bug was found this exact way: an
eligibility check that started in the route was untestable via the existing repository-level test
pattern, and moving it down made it both defense-in-depth and directly unit-testable; see
tests/movement-repository.test.ts).
**Consequences:** Slightly more repository code, but every business rule has a direct test that doesn't
need a fake HTTP request/session to exercise.
**Revisit condition:** None — this is now the intended pattern for new business rules going forward.

## D-008 — 2026-07-21 — Exception self-approval is a hard rule, not a tenant-configurable toggle (unlike movement self-approval)
**Context:** GATE-005 required "gate officer cannot approve their own serious exception," and
`MovementAuthorisation.approveMovement()` already has a precedent for a self-approval rule —
but it's gated by `Tenant.allowSelfApproveMovement` (default false, tenants may opt in). The Phase 3
build brief for exceptions doesn't mention an equivalent toggle anywhere.
**Decision:** `resolveException()` in `gate-event-repository.ts` enforces
`exception.raisedByUserId !== actorUserId` unconditionally whenever `exception.requiresSupervisorApproval`
is true — there is no `Tenant` flag that can disable this, and none was added. This applies regardless of
which permissions a role holds, exactly mirroring how `approveMovement()`'s check is keyed on user ids, not
role names, so it holds even against a future role that happens to be granted both `exception:CREATE` and
`exception:APPROVE`.
**Alternatives considered:** Reusing `Tenant.allowSelfApproveMovement` for exceptions too — rejected: a
serious gate-side exception (safety/damage/identity) is a materially different integrity boundary than a
delivery-movement approval, and the brief gives no signal a tenant should ever be allowed to weaken it.
Adding a new `Tenant.allowSelfApproveException` toggle — rejected for the same reason: nothing in scope
asked for it, and adding an unused escape hatch is speculative scope, not a requirement.
**Consequences:** A tenant cannot loosen this rule via configuration. If a genuine future business need for
an opt-out appears, it needs its own explicit decision and its own build-brief-level justification, not a
silent reuse of the movement flag.
**Revisit condition:** If a real tenant reports this as a blocking operational problem post-launch — not
before.

## D-009 — 2026-07-21 — InspectionTemplate versioning is immutable-row, not in-place edit
**Context:** GATE-006 requires templates to be "configurable" and to vary "by vehicle type/version" —
`GateEvent.inspectionTemplateId` is set once, at gate-event start, and inspection results elsewhere in the
system are expected to remain a faithful historical record (same append-only spirit as `AuditLog`).
**Decision:** Editing a published template never mutates its row. `createNewTemplateVersion()` creates a
brand-new `InspectionTemplate` row with `version` incremented and the same `name`, then sets the previous
version's `isActive` to `false`. `getActiveTemplateForCategory()` only ever selects `isActive: true` rows,
so new gate events pick up the latest version automatically, while every existing `GateEvent` keeps
pointing at the exact template (and exact `InspectionItem` rows) that were actually used at the time —
see `tests/inspection-template-repository.test.ts` ("a GateEvent that already references an old version
keeps pointing at it after a new version is published").
**Alternatives considered:** In-place mutation of `InspectionItem` rows under a stable `templateId` —
rejected: would silently rewrite what a past inspection was actually asked, which is exactly the kind of
retroactive record change this codebase avoids everywhere else (audit logs, movement history).
**Consequences:** Old template versions accumulate in the table indefinitely (no hard delete) — acceptable,
same tradeoff already accepted for `AuditLog` growth; deactivated versions are simply excluded from
`isActive` queries and from the admin "create new version" default list.
**Revisit condition:** None expected; this is the intended pattern for any future versioned-configuration
entity.

## D-010 — 2026-07-21 — GateEvent linkage to MovementAuthorisation: one open event per movement, best-effort lifecycle wiring
**Context:** TESTING.md's mandatory gate "duplicate submissions do not create duplicate gate events" needed
a concrete rule, and GateEvent's relationship to the existing MovementAuthorisation lifecycle
(APPROVED → IN_PROGRESS → COMPLETED) needed to be decided without redoing Phase 5 (departure/return
reconciliation, explicitly out of scope until Phase 5).
**Decision:** `startGateEvent()` first calls `findOpenGateEventForMovement()` (any GateEvent for this
`movementAuthorisationId` whose status is not `CANCELLED`/`COMPLETED`) and returns it unchanged if found,
rather than creating a second row — idempotent by construction, not by a database unique constraint
(Postgres can't cleanly express "unique while non-terminal" without a generated column/partial index this
schema doesn't need yet). Separately, `clearGateEvent()` on an `ENTRY` event calls the existing
`startMovement()` (APPROVED → IN_PROGRESS) if the movement is still APPROVED, and `completeGateEvent()` on
an `EXIT` event whose decision was CLEARED calls the existing `completeMovement()` (IN_PROGRESS →
COMPLETED) if applicable. Both calls are best-effort/no-op if the movement is already past that state.
**Alternatives considered:** A DB partial unique index on `(movementAuthorisationId)` filtered by status —
rejected as unnecessary complexity for a rule that's simple and correctly enforced at the one call site
that creates GateEvents. Full departure/return reconciliation logic here — explicitly out of scope
(Phase 5); this is only enough wiring to keep the existing movement state machine honest, not a
reconciliation feature.
**Consequences:** A movement's IN_PROGRESS/COMPLETED transitions are now partly driven by gate-side
decisions, not only by direct API calls to the movement routes — documented here so a future session
doesn't "fix" `clearGateEvent`/`completeGateEvent` by removing what looks like an unrelated side effect.
**Revisit condition:** Phase 5 (RECON-001/002) will need to look at this again once real departure-vs-return
matching exists — the current wiring is a minimal placeholder, not the final reconciliation design.

## D-011 — 2026-07-22 — MediaAsset uses a plain (ownerType, ownerId) pair, not N nullable FK columns
**Context:** Phase 4 needed one reusable evidence/media model covering five different owning-record kinds
(a GateEvent's general walk-around evidence, a specific GateEventInspectionItem's evidence, a
ManualFacialVerificationFallback's evidence, a Driver's portrait, a ComplianceDocument's attachment). The
build brief pointed at `ComplianceDocument` (Phase 2) as the precedent for "one reusable model with an
ownerType discriminator, not five near-duplicate tables."
**Decision:** `MediaAsset` uses a plain `ownerType` enum + `ownerId` string pair (no FK constraint), not
`ComplianceDocument`'s pattern of exactly-one-of-two-nullable-FK-columns. `AuditLog` already established
this exact shape (`entityType` + `entityId`) for a similar "many possible kinds of thing" problem, and is
the closer precedent once there are five owner kinds, not two — five nullable FK columns would be
unwieldy and would need a new column (and migration) every time a sixth evidence-capture point is added.
Owner-existence-in-tenant is enforced in `assertOwnerExistsInTenant()` (media-asset-repository.ts, a
`switch` over `ownerType`) rather than by the database, mirroring `ComplianceDocument`'s own
application-layer "exactly one owner" enforcement note in DATA_MODEL.md.
**Alternatives considered:** Following `ComplianceDocument` literally (five nullable FK columns, one per
owner kind) — rejected as unwieldy at this owner count and less extensible. A single polymorphic FK via
Prisma's (unsupported) generic relations — Prisma has no first-class polymorphic-association feature, so
this was never actually available.
**Consequences:** No DB-level referential integrity from MediaAsset to its owning record (same tradeoff
`AuditLog` already accepted) — a deleted owning record does not cascade-delete or null out orphaned
MediaAsset rows automatically; acceptable since evidence should generally outlive the record it was
captured against (append-only spirit), and no owning-record delete path exists yet for any of the five
owner kinds in this codebase.
**Revisit condition:** If a future owner kind needs strict referential integrity (e.g. hard-deleting a
Driver must also hard-delete their portrait for POPIA erasure), revisit at that time — not before, since no
hard-delete path exists yet for any MediaAsset owner.

## D-012 — 2026-07-22 — All four dev-mode placeholder fields upgraded to real MediaAsset-backed uploads, not just the two explicitly named
**Context:** The Phase 4 brief explicitly required replacing `GateEventInspectionItem.evidenceRef` and
`ManualFacialVerificationFallback.evidenceRef` with real uploads, and separately asked to *decide* (after
re-reading DATA_MODEL.md's existing notes) whether `Driver.portraitUrl` and `ComplianceDocument.attachmentUrl`
should get the same treatment in this pass or be explicitly deferred. Both fields' existing schema comments
already said "real upload is Phase 4" (written during Phase 2), which is a clear signal they were always
intended to land in this phase, not deferred again.
**Decision:** All four fields were fully replaced (old string/URL column dropped, not kept alongside a new
one) with a nullable, `@unique` FK to `MediaAsset`: `Driver.portraitMediaAssetId`,
`ComplianceDocument.attachmentMediaAssetId`, `GateEventInspectionItem.evidenceMediaAssetId`,
`ManualFacialVerificationFallback.evidenceMediaAssetId`. For the two update-only fields
(`portraitMediaAssetId`, `attachmentMediaAssetId`), a chicken-and-egg problem exists — the MediaAsset's
owner-existence check needs the driver/document id to already exist, so it can't be uploaded in the same
call as creating the driver/document. Resolved by making these **update-only**: `portraitMediaAssetId` was
removed from `createDriverSchema` (create-time) and only appears in `updateDriverSchema`; a new
`POST /api/compliance-documents/[id]/attachment` route + `attachAttachmentToComplianceDocument()` and a new
`POST /api/drivers/[id]/facial-verification/manual-fallback/[fallbackId]/evidence` route +
`attachEvidenceToManualFallback()` link previously uploaded evidence onto an already-existing record.
`GateEventInspectionItem.evidenceMediaAssetId` avoids the same problem differently: evidence is uploaded
with `ownerType=GATE_EVENT_INSPECTION_ITEM, ownerId=<gateEventId>` (the GateEvent already exists; the
specific `GateEventInspectionItem` row is only upserted when the result is recorded), then the returned
MediaAsset id is passed into `recordInspectionResult()`, which validates it belongs to that same gate event
before linking it.
**Alternatives considered:** Keeping the old placeholder columns alongside the new FK (dual source of
truth) — rejected: this codebase already carries one deliberate, documented duplication
(Driver.licenceExpiry vs ComplianceDocument, see DATA_MODEL.md) and adding a second, undocumented one here
serves no purpose now that a real upload path exists. Deferring `portraitUrl`/`attachmentUrl` — rejected
per the schema comments' own "Phase 4" signal referenced above; no test in the existing 259-test baseline
referenced either field (confirmed via search before removing), so the removal carried no regression risk.
**Consequences:** No admin-page UI was built for uploading a driver portrait or a compliance-document
attachment in this pass (the brief only explicitly required a UI affordance for gate check-in inspection
evidence) — both are fully wired and independently curl-verifiable end-to-end via the API, just without a
dedicated form yet. Tracked as a follow-up in TODO.md, not a defect.
**Revisit condition:** Build the driver-portrait and compliance-document-attachment upload UI when admin
pages are next revisited (currently no ETA).

## D-013 — 2026-07-22 — File type/size limits (25MB image / 200MB video) and signed-URL expiry (5 minutes) are new, documented conventions
**Context:** EVID-001 requires server-side file-type/size validation; ARCHITECTURE.md and SECURITY_AND_POPIA.md
both say media reads must go through "short-lived" signed URLs, but neither document (nor any other in the
repo) previously specified numbers. The build brief said to pick sensible defaults and document the choice
if no existing convention exists.
**Decision:** Images: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, max 25MB. Video: `video/mp4`,
`video/quicktime`, `video/webm`, max 200MB (gate walk-around clips are short but phone/tablet camera video
at reasonable quality can easily exceed tens of MB). Signed read URLs expire in 300 seconds (5 minutes) —
long enough for a browser to load an `<img>`/`<video>` `src` in one round trip (including a slow gate-side
connection), short enough that a leaked/logged URL stops working quickly. Constants live in
`lib/repositories/media-asset-repository.ts` (`MAX_IMAGE_BYTES`, `MAX_VIDEO_BYTES`,
`SIGNED_URL_DEFAULT_EXPIRY_SECONDS`), not scattered per-route.
**Alternatives considered:** No hard limit on video length/size — rejected, contradicts EVID-001's explicit
"size validated" requirement and risks unbounded disk usage on the dev filesystem adapter. A much shorter
signed-URL expiry (e.g. 30 seconds) — rejected as needlessly fragile for slower gate-side network
conditions, which the build brief explicitly calls out ("flaky gate connectivity") elsewhere.
**Consequences:** These are dev-mode defaults with no configuration surface yet (not per-tenant, not an
env var) — acceptable for now since no requirement asked for tenant-configurable limits.
**Revisit condition:** If a real tenant reports either limit as operationally wrong (e.g. dashcam-quality
video routinely exceeding 200MB), revisit with real usage data, not speculatively now.

## D-014 — 2026-07-22 — Audit-on-read is logged at signed-URL mint time, not at every raw-byte fetch
**Context:** SECURITY_AND_POPIA.md already flagged "Structured audit logging for sensitive record access...
not just for writes" as a target for biometric/identity-adjacent evidence, but didn't specify at what
granularity a "read" should be logged — every raw HTTP fetch of the underlying bytes, or the point where
access is actually authorised.
**Decision:** `mintSignedUrlForMediaAsset()` (the one function that runs the mediaAsset:VIEW permission +
tenant check) writes exactly one `AuditLog` row per mint (`action: "mediaAsset.readAccessGranted"`).
`serveRawMediaAsset()` — the raw-byte-serving path — does **not** write its own audit row.
**Alternatives considered:** Auditing every raw-byte fetch too — rejected: a single `<img>` tag load can
trigger multiple browser-level requests (retries, range requests, prefetch), which would multiply audit
rows without adding real investigative value; the meaningful security event is "who was granted access to
this evidence and when," which mint time already captures exactly once per grant. Auditing neither —
rejected, contradicts SECURITY_AND_POPIA.md's explicit existing target for this data class.
**Consequences:** If a signed URL is minted once and then fetched many times before expiry (e.g. a slow
connection retrying), only one audit row exists for that whole access window, not one per fetch — accepted
as the right granularity for "who was granted access," not "how many bytes were transferred."
**Revisit condition:** If a future compliance requirement needs literal byte-fetch-level audit granularity
(not just grant-level), revisit — no such requirement exists today.

## Open / not yet decided (tracked, not blocking)
- **Facial-verification provider** — blocked, no vendor selected. Interface + mock built regardless.
- **Telematics provider** — blocked, no vendor selected. Interface + mock built regardless.
- **Production hosting (Supabase vs self-managed Postgres, storage provider, deploy target)** — deferred
  to Phase 7; will be raised as a major decision (paid third-party service) before any account is created.

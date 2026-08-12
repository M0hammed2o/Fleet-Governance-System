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

## D-015 — 2026-07-23 — Remapped the 8 seeded roles onto 9 (six primary customer roles + three additional profiles)
**Context:** The user supplied an authoritative, more detailed role specification: six primary daily
customer roles (Company Administrator, Dispatch and Logistics Officer, Gate Security Officer, Security
Supervisor / Approving Manager, Fleet and GPS Manager, Accountant / Finance and Compliance Officer) plus
three additional non-daily profiles (Internal Investigator/Auditor, External Reviewer, Executive
Read-Only Viewer). The prior 8-role set (Company Administrator, Security Manager, Gate Security Officer,
Fleet Manager, Approving Manager, Risk/Compliance Manager, Internal Auditor, Executive Viewer) didn't map
1:1.
**Decision:** Merge old "Security Manager" + "Approving Manager" → "Security Supervisor / Approving
Manager" (gate CONFIGURE moves to Company Administrator, who already had it — no longer duplicated).
Split old "Fleet Manager" into "Dispatch and Logistics Officer" (gets `movement:CREATE/EDIT`, loses
driver/vehicle master-data rights) and "Fleet and GPS Manager" (keeps driver/vehicle master-data rights,
loses `movement:CREATE/EDIT`, drops to `movement:VIEW`). Rename "Risk/Compliance Manager" →
"Accountant / Finance and Compliance Officer" (same permission set — review-only across the board, no
resource beyond VIEW/AUDIT, matching "must not edit original inspections/GPS/photos/videos/audit
events"). Rename "Internal Auditor" → "Internal Investigator / Auditor" and "Executive Viewer" →
"Executive Read-Only Viewer" (unchanged permissions). Add new "External Reviewer" — same read-only
evidence access as the internal profile, but no `user:VIEW` and no `auditLog:EXPORT` (an external party
shouldn't see internal staff lists or bulk-export audit history).
**Alternatives considered:** Keep "Security Manager" as a distinct gate-configuration role separate from
approval duties — rejected because the new spec's role #4 responsibilities explicitly span both (approve
movements *and* review/resolve gate exceptions *and* approve manual facial-verification fallback), and
gate configuration itself already duplicated Company Administrator's existing rights.
**Consequences:** A real behaviour change, not just a rename: the old "Fleet Manager" role could
create/edit movements; the new "Fleet and GPS Manager" cannot (view-only). Any integration or seed data
written against the old role names would break — confirmed via `tests/role-segregation.test.ts` (8 new
cases) and a live curl regression check that a Fleet and GPS Manager session is 403'd creating a movement.
The local dev database was dropped and recreated (`docker exec ... DROP/CREATE DATABASE`, fictional data
only, explicitly authorised) rather than left with orphaned old-named Role rows and stale users from the
rename — `prisma/seed.ts`'s upsert-by-name pattern doesn't clean up renamed/removed roles on its own.
**Revisit condition:** None expected; this is the role model going forward. Telematics-specific
permissions (Phase 6) and support-access-session permissions (Phase 7) will extend "Fleet and GPS
Manager" and the platform-side roles respectively, not restructure this set again.

## D-016 — 2026-07-23 — Platform-side roles and customer roles are architecturally separate, not more permission grants on the same model
**Context:** The new spec adds a "Platform Support Analyst" platform-side role and a detailed
platform-customer-list + controlled support-access design. Platform Administrator is already modeled as a
user of a special "platform" tenant with a `platformTenant` permission resource (D-005), deliberately
never granted access to any customer tenant's business data.
**Decision:** Platform Support Analyst will be a second role within the same "platform" tenant (Phase 7),
distinguished from Platform Administrator by a narrower permission set (no tenant status/creation rights,
only support-session-related permissions). Support access to a customer tenant's data will go through a
new, separately-scoped, fully audited `SupportAccessSession` model — not by granting platform roles any
direct `driver`/`vehicle`/`mediaAsset`/etc. permission on customer tenants. This is exactly the
"break-glass" mechanism already flagged as a TODO item since D-005/Phase 1.
**Alternatives considered:** Giving Platform Administrator/Support Analyst a standing cross-tenant
permission bypass — rejected outright, directly contradicts "cannot silently access tenant evidence" and
this project's tenant-isolation architecture (ARCHITECTURE.md).
**Consequences:** Phase 7 needs a new permission-evaluation path: `hasPermission()` as it exists today
answers "does this session have X on its own tenant"; a support session needs "does this session have an
*active, audited, time-limited* grant to view (read-only by default) *this specific other* tenant's data."
This is additive — existing `hasPermission()` callers are unaffected — but is a genuinely new code path,
not a permission-catalogue extension.
**Revisit condition:** Design this fully when Phase 7 starts; not blocking Phases 5B/5C/6.

## D-017 — 2026-07-24 — Reconciliation pairs "departure"/"return" by chronological order, not a hardcoded ENTRY/EXIT assumption
**Context:** RECON-001 needs to pair a movement's departure and return `GateEvent`. The seeded demo data
uses `GateEventDirection: ENTRY` for a `movementType: ENTRY` (a visitor driving onto site) and — by the
existing `clearGateEvent()` comment ("an ENTRY clearance moves movement APPROVED → IN_PROGRESS") — the
codebase's Phase 3 wiring was already written with visitor-entry movements as the primary case in mind.
But most of Phase 2's actual movement types (DELIVERY, COLLECTION, SITE_TRANSFER, MAINTENANCE, RETURN,
OTHER) model the *opposite* real-world shape: the tenant's own vehicle leaving the site first (`EXIT`) and
coming back later (`ENTRY`).
**Decision:** `buildReconciliation()` never assumes which direction is "departure" — it takes whichever of
the two legs has the earlier `completedAt` as departure and requires the other leg to be the *opposite*
direction (never hardcoding EXIT-then-ENTRY or ENTRY-then-EXIT). This makes reconciliation correct for
both real-world shapes without needing to know or care which `MovementType` produced the trip.
**Alternatives considered:** Hardcoding EXIT=departure/ENTRY=return — rejected, would silently
mis-reconcile (or simply never pair) every `movementType: ENTRY` visitor movement, and there was no
evidence either shape is more "correct" than the other at the schema level.
**Consequences:** A same-direction pair (two EXITs, two ENTRYs) is always rejected
(`SameDirectionPairingError`), regardless of which one arrived first.
**Revisit condition:** If Phase 5C's dispatch-workflow expansion adds an explicit trip-direction field to
`MovementAuthorisation`, prefer that as the authoritative signal over chronological inference.

## D-018 — 2026-07-24 — Reconciliation's auto-raised Exception writes directly to the Exception table, bypassing `raiseException()`
**Context:** RECON-002 requires significant discrepancies to raise a real Phase 3 `Exception`, not a
parallel mechanism. `gate-event-repository.ts` already exports `raiseException()` for exactly this.
**Decision:** `reconciliation-repository.ts` creates the `Exception` row (and its audit entry) directly via
`prisma.exception.create()` rather than importing `raiseException()`. Two reasons: (1) `raiseException()`
also attempts a `GateEvent` state transition to `EXCEPTION_RAISED`, which is meaningless here — both legs
are already `COMPLETED`, a terminal state with no valid outbound transition — so the call would be doing
unnecessary/misleading work; (2) `reconciliation-repository.ts` has no dependency on
`gate-event-repository.ts` today, and `gate-event-repository.ts` needs to call *into*
`reconciliation-repository.ts` (from `completeGateEvent()`'s auto-build hook) — importing `raiseException`
the other way would create a circular module dependency between the two files.
**Alternatives considered:** Making `raiseException()` tolerate a terminal `GateEvent` status and skip the
transition attempt — would work, but couples gate-event-repository's exception-raising code to a
reconciliation-specific caller pattern for no real benefit, and doesn't solve the circular-import direction
problem regardless.
**Consequences:** The row shape and the `gateEvent.exceptionRaised` audit action name are identical either
way — this is purely an internal wiring choice, invisible to any caller or test asserting on the
`Exception` table.
**Revisit condition:** If a third repository needs the same "create an Exception without a state
transition" shape, extract a small shared helper instead of a third copy-paste.

## D-019 — 2026-07-24 — `MovementAuthorisation.vehicleUsePolicyId` is a plain nullable String, not a Prisma relation, until Phase 6
**Context:** DISPATCH-004 asks for a movement to optionally reference an approved
`VehicleUsePolicy`/geofence, explicitly scoped as "nullable until that model exists, not a hard Phase 5C
dependency" — but `VehicleUsePolicy` itself is Phase 6, POLICY-001, not built yet.
**Decision:** Add the column now as a plain `String?` with no `@relation` and no FK constraint, rather than
either (a) skipping the field until Phase 6, or (b) creating a stub `VehicleUsePolicy` table early just to
satisfy the FK. When Phase 6 creates the real `VehicleUsePolicy` model, a follow-up migration adds the
`@relation` (Prisma allows this without touching existing data — the column stays, a constraint is added).
**Alternatives considered:** Skipping the field entirely until Phase 6 — rejected, the acceptance criteria
explicitly calls for it now. Building a placeholder `VehicleUsePolicy` table in this phase just to have
something to point the FK at — rejected as premature: Phase 6's actual field list (POLICY-001: named
driver/rep, assigned vehicles, effective dates, permitted days/hours, km limits, etc.) isn't designed yet,
and a placeholder table would just get dropped and rebuilt, churn with no benefit.
**Consequences:** Until Phase 6, `vehicleUsePolicyId` accepts any string, including one that doesn't
correspond to anything — acceptable because nothing reads or enforces it yet; the moment Phase 6 adds the
real relation and any enforcement logic, existing values will need validating/backfilling as part of that
migration.
**Revisit condition:** Phase 6, when `VehicleUsePolicy` is actually created.

## D-020 — 2026-07-24 — `Exception.gateEventId` is now nullable; a telematics/policy exception carries `vehicleId` instead
**Context:** GPS-005/POLICY-002 require geofence-deviation and vehicle-use-policy violations to raise a
real Phase 3 `Exception`, explicitly "not a parallel one." But `Exception.gateEventId` was a required,
non-nullable FK — every existing exception is raised *during* a gate event (an inspection FAIL, an officer
ad hoc report). A telematics/policy violation is detected mid-trip, with no GateEvent in context at all.
**Decision:** Made `Exception.gateEventId` nullable and added a nullable `Exception.vehicleId` — a
telematics/policy exception sets `vehicleId` and leaves `gateEventId` null; every existing Phase 3/5B
caller (`gate-event-repository.ts`'s `raiseException()`, `reconciliation-repository.ts`'s direct
`prisma.exception.create()`) is unaffected and continues to always set `gateEventId`.
`gate-event-repository.ts`'s `resolveException()` — the gate-tied resolution workflow (escalation,
self-approval, GateEvent state transition) — now explicitly rejects an exception with no `gateEventId`
(`NotAGateEventExceptionError`) rather than crashing on a null dereference; telematics exceptions are
created directly in `telematics-repository.ts` (see also: this file doesn't import `raiseException()`, same
circular-dependency reasoning as D-018) and aren't resolved through a dedicated function yet in this phase
(no UI/route calls for it — a documented gap, not a silent one; see TODO.md).
**Alternatives considered:** A second, parallel `TelematicsException` table — rejected outright, directly
contradicts GPS-005's explicit wording. Requiring a synthetic/placeholder `GateEventId` for telematics
exceptions — rejected as actively misleading (an exception would appear tied to a specific gate crossing
that never happened, corrupting any report that joins Exception → GateEvent).
**Consequences:** Any code reading `Exception.gateEventId` must now null-check (TypeScript already enforces
this everywhere `@generated/prisma` types are used, so this is compiler-enforced, not just a convention).
Existing test data/queries assuming `gateEventId` is always present must be checked — verified via the full
test suite (374/374 passing) that no other call site broke.
**Revisit condition:** If Phase 7's investigation-case-management work needs to resolve a telematics
exception through its own approval workflow (beyond the simple audit-logged creation this phase does), that
resolution function should live in `telematics-repository.ts`, not be bolted onto `gate-event-repository.ts`'s
`resolveException()`.

## D-021 — 2026-07-24 — SupportAccessSession's "elevated" flag records intent/audit trail only; it does not itself unlock write access to any customer resource
**Context:** SUPPORT-003 requires "an explicit elevated-access workflow for authorised changes." A fully
general implementation would mean every existing repository function across the whole app (movements,
drivers, vehicles, gate events, ...) would need to accept and check "is this an elevated platform support
actor" as a second, parallel authorization path alongside the existing per-tenant `hasPermission()` check —
a change with a large blast radius touching essentially every write path in the system.
**Decision:** Phase 7 builds the full audited elevation *workflow* (`elevateSupportAccessSession()` — a
deliberate, separately-permissioned, audited action distinct from starting the session) and *records* that
a session is elevated with its reason and timestamp, but does not wire that flag into any actual write
capability on movements/drivers/vehicles/gate events/etc. A platform support actor — elevated or not —
still cannot call `updateVehicle()`, `approveMovement()`, or any other customer-tenant write path today;
`getSupportViewForCustomer()` itself only ever reads.
**Alternatives considered:** Building elevated-write proxying into every customer resource type in this
phase — rejected as far beyond "basic"/"controlled support view" scope, and doing it hastily across dozens
of call sites would be a bigger tenant-isolation risk than not building it at all. A narrower elevated-write
path scoped to just one or two resources (e.g. only `Tenant.subscriptionStatus`) — considered, but no
specific authorised-change use case was specified by the requirement to build against, so nothing was
invented speculatively.
**Consequences:** SUPPORT-003 is satisfied for the audit/workflow half of "explicit elevated-access
workflow for authorised changes" (the request, the reason, the audit trail) but not yet the "for authorised
changes" half literally unlocking anything. This is a real, documented gap (TODO.md), not a silent one —
the elevated flag currently has no functional effect beyond being recorded and displayed.
**Revisit condition:** The first time a genuine "platform support needs to make an authorised change on a
customer's behalf" use case is specified, wire `elevated` into that *one* specific write path, checked via
`getActiveSupportAccessSession()` inside that resource's own repository function — not a generic
cross-cutting mechanism built ahead of a real need.

## D-022 — 2026-07-26 — GPS-exception deduplication reuses `Exception` with three new nullable columns, not a new episode-tracking model
**Context:** Phase 8A (HARD-006) required that a continuing telematics/policy violation not raise a
duplicate open exception on every sync, that a persisting violation escalate, and that a violation clear
itself once the vehicle becomes compliant again — none of which the original "one Exception per violation
per sync" wiring (Phase 6) did.
**Decision:** Add `Exception.violationType` (nullable — the `PolicyViolationType` an open telematics episode
tracks), `observationCount` (`Int @default(1)`), and `lastObservedAt` (nullable) directly to the existing
`Exception` table, rather than a new `TelematicsViolationEpisode`-style model. `reconcileTelematicsViolations()`
(`telematics-repository.ts`) does the reconciliation: an already-open row for the same `(vehicleId,
violationType)` is updated in place (count/timestamp, and severity/`requiresSupervisorApproval` once
escalated); a violation type no longer present is auto-resolved (`resolvedAt` set, a distinct
`resolutionNotes` prefix, audited as `telematics.policyViolationCleared` — never confused with a human
`resolveException()` call, which telematics exceptions still can't go through per D-020).
**Alternatives considered:** A parallel episode-tracking table — rejected for the same reason D-018/D-020
rejected a parallel Exception mechanism: the whole point of GPS-005/POLICY-002 is "reuse the existing
Exception workflow," and three nullable columns are a far smaller footprint than a second table that would
need its own tenant-isolation/audit/UI treatment. Time-based escalation (e.g. "escalate after 24 hours
open") — rejected in favour of a count-based threshold (`ESCALATION_OBSERVATION_THRESHOLD = 3` consecutive
syncs): deterministic and directly testable without mocking elapsed wall-clock time, and syncs are the only
unit of "has this been checked again" this system actually has.
**Consequences:** `violationType`/`observationCount`/`lastObservedAt` are meaningless (stay null/1/null) for
every gate-event/reconciliation exception — `reconcileTelematicsViolations()` only ever queries/updates rows
where `violationType` is already telematics-set, so it can never touch one of those.
**Revisit condition:** If a future requirement needs per-episode history (not just "currently open vs.
resolved-with-a-note"), promote to a dedicated table then — not speculatively now.

## D-023 — 2026-07-26 — Trip boundary is defined by ignition-off→on transitions, not GateEvent departure/return
**Context:** HARD-005 required a real `kmLimitPerTrip` check. `TODO.md` had flagged the two candidate
trip-boundary signals: the vehicle's own GateEvent departure/return pairing (Phase 5B reconciliation), or
telematics ignition state.
**Decision:** `lib/telematics/distance-engine.ts`'s `computeDistanceSoFar()` defines "trip start" as the most
recent ignition-off→on transition found in the TelematicsEvent lookback window (falling back to the earliest
available reading if ignition has been on throughout the window, or `null` — not zero — if no ignition
signal exists at all).
**Alternatives considered:** Anchoring trip boundaries to `GateEvent`/`Reconciliation` — rejected: a
`VehicleUsePolicy`-covered vehicle (the sales-rep/private-use case POLICY-001 targets) very often never
passes through a gate at all in a given trip, so a gate-anchored definition would leave `tripKmSoFar: null`
for exactly the fleet segment this feature matters most for. Ignition state is reported by every telematics
provider (mock or real) regardless of whether the vehicle ever sees a gate, making it the more general
signal.
**Consequences:** A vehicle whose provider never reports ignition state (or one not yet reporting at all)
gets `tripKmSoFar: null` — the per-trip check simply doesn't fire, same "null skips it, never guessed"
convention as every other distance-limit check here.
**Revisit condition:** If a production telematics vendor's actual data doesn't reliably report ignition
state, revisit against that vendor's real signal shape once selected (GPS-BLOCKED).

## D-024 — 2026-07-26 — Video compression ships as configuration + a passthrough provider, not a working transcoder
**Context:** Phase 8B (MEDIA-012) asks for real video compression (720p, H.264/MP4, 24-30fps, 30-60s max,
target bitrate). Real H.264 re-encoding needs an external binary (ffmpeg) or a wrapper around one
(`fluent-ffmpeg`, `@ffmpeg-installer/ffmpeg`) — none of which are installed in this environment, and adding
one within this pass without the time to verify it actually transcodes correctly on this machine would risk
reporting a feature as "done" that was never actually exercised.
**Decision:** Ship the full target policy (`VIDEO_COMPRESSION_PROFILES`) and a `VideoCompressionProvider`
interface a real transcoder plugs into, but only implement `PassthroughVideoCompressionProvider` — it
records the *intended* profile name and stores the original bytes unchanged. Image compression, by contrast,
is fully real (`sharp`, already a common Node ecosystem dependency, installed and verified against real
images in tests).
**Alternatives considered:** Installing ffmpeg/fluent-ffmpeg and building a real transcoder now — rejected
for this pass given the verification risk above; installing it and *not* verifying it — rejected outright,
would violate the hard rule against overclaiming. A fake "compressed" video (re-muxed but not actually
re-encoded, to at least claim *something* changed) — rejected as actively misleading: it would look like
compression happened without actually reducing storage cost, the entire point of MEDIA-012.
**Consequences:** Video evidence uploaded today consumes its full original size in storage — no bitrate/
resolution reduction yet. Tracked as an open TODO.md item, not silently assumed working; the interface
boundary means wiring in a real transcoder later touches only `video-compression.ts`, no call site changes.
**Revisit condition:** The first time ffmpeg (or an equivalent) can be installed and verified end-to-end in
this environment — not speculatively before then.

## D-025 — 2026-07-26 — `MediaCategory` is a new field defaulting to `OTHER_DOCUMENT`, not inferred from `MediaAssetOwnerType`
**Context:** Phase 8B's ten storage/retention/billing categories are a different classification axis than
the existing five-owner-kind `MediaAssetOwnerType` (D-011) — a `GATE_EVENT_INSPECTION_ITEM`'s evidence could
legitimately be `VEHICLE_INSPECTION_PHOTO`, `DAMAGE_EVIDENCE`, or `CARGO_EVIDENCE` depending on what was
actually photographed, so ownerType alone can't determine it.
**Decision:** Add `MediaAsset.category` as its own field, `@default(OTHER_DOCUMENT)`. Callers that pass an
explicit category (the new presigned-upload path, and any route updated to offer a category picker) get
correct classification immediately; the ~30 existing `uploadMediaAsset()` call sites across the codebase
that predate Phase 8B were not all individually updated to pass one in this pass, and fall back to the
default rather than a guessed category. The one unambiguous exception: a migration-time backfill sets
`category = DRIVER_PORTRAIT` for every pre-existing row with `ownerType = DRIVER_PORTRAIT`, since that
mapping is genuinely 1:1.
**Alternatives considered:** Deriving category from ownerType via a lookup table — rejected: would be wrong
for `GATE_EVENT`/`GATE_EVENT_INSPECTION_ITEM` (could be any of several categories) and `MOVEMENT_DOCUMENT`
(could be `DELIVERY_DOCUMENT` or `CARGO_EVIDENCE`), producing confidently-wrong data rather than an honestly
generic default. Rewriting every existing call site to pass a category now — considered, but is a much
larger, riskier diff than this subphase's actual scope (object-storage architecture, not a full audit of
every evidence-capture UI); tracked as a TODO.md follow-up.
**Consequences:** Storage-usage-by-category reporting (Phase 8D) will show a large `OTHER_DOCUMENT` bucket
until calling code is updated to categorise explicitly — a known, visible gap, not a silently wrong number.
**Revisit condition:** Update each existing capture-point UI to offer/set a real category as those pages are
next revisited, not as a speculative batch change now.

## D-026 — 2026-07-26 — Export request produces a signed manifest, not a server-generated zip archive
**Context:** RETAIN-007 ("export and then delete") needs to hand a customer a complete copy of a batch of
evidence before its deletion request proceeds. The obvious literal reading — generate a single downloadable
archive file server-side — means buffering or streaming potentially many large video files through one
request, needing a new archive-generation dependency (e.g. `archiver`) and a real async job
queue/progress-tracking mechanism for anything beyond a trivially small batch.
**Decision:** `createExportRequest()` builds a JSON manifest instead: one entry per matching asset
(`mediaAssetId`, `fileName`, `category`, `checksumSha256`, `fileSizeBytes`, and a 24-hour expiring signed
download URL via the existing `ObjectStorageProvider.getSignedReadUrl()`). The request is `READY`
immediately — no async job, no progress polling.
**Alternatives considered:** A server-generated zip — rejected for this pass given the scale risk above and
because a signed-URL manifest satisfies "the customer got a verifiable, complete copy of their data" just as
well (arguably better — each file's checksum is independently verifiable, not just a container's). A
message-queue-backed async zip-building job — rejected as disproportionate infrastructure for a feature this
codebase has no other precedent for (no job queue exists anywhere yet).
**Consequences:** A customer receives N separate download links instead of one archive — a real UX
difference, not a limitation of what's actually exported. The manifest's signed URLs expire in 24 hours
(matching the request's own `expiresAt`), long enough to download a batch but not indefinite.
**Revisit condition:** If the pilot customer specifically needs a single downloadable archive file (not
just N links), revisit with a real archive-generation dependency and job queue at that time — not
speculatively now.

## D-027 — 2026-07-26 — Permanent deletion removes the binary but never the MediaAsset row itself
**Context:** ARCHITECTURE.md already commits to "preserve structured operational records separately from
large media files according to the applicable retention policy" and "never claim deleted binary evidence
can be recovered after permanent deletion." These two statements together imply the database *metadata*
(who captured what, when, its checksum, its category) has a different, generally much longer lifecycle than
the large binary object itself.
**Decision:** `completeDeletionRequest()` deletes the storage object(s) (`ObjectStorageProvider.delete()`)
and sets `binaryDeletedAt`/`retentionStatus: DELETED`, but never issues a `prisma.mediaAsset.delete()`. The
row survives forever as a tombstone — the `DeletionCertificate`'s `checksumManifest` and the surviving
`MediaAsset` rows are the only trace of evidence that once existed, matching the "structured record
preserved separately from the large file" principle literally, not just as a slogan.
**Alternatives considered:** Hard-deleting the `MediaAsset` row too (true erasure) — rejected: it would
destroy the audit trail this same phase is building (the deletion certificate would then reference an id
that resolves to nothing), and nothing in RETAIN-001..010 actually requires row-level erasure — only the
binary evidence itself needs to be genuinely unrecoverable. (A future genuine POPIA-erasure request, if it
ever needs to remove the metadata row too, is a distinct, separately-scoped mechanism — see TODO.md's
existing "MediaAsset retention-purge / hard-delete mechanism (POPIA erasure)" item, unaffected by this
decision.)
**Consequences:** A `binaryDeletedAt`-set `MediaAsset` row's `storageKey`/`thumbnailStorageKey`/
`originalStorageKey` point at nothing readable — any future code path that tries to read one back must
check `binaryDeletedAt` first rather than assuming a live object (not yet enforced defensively in
`serveRawMediaAsset()`/`mintSignedUrlForMediaAsset()` in this pass — a documented, low-risk gap since no UI
yet surfaces a "view" action for a deleted asset).
**Revisit condition:** If a UI is later built that could plausibly link to a deleted asset's evidence
view, add the `binaryDeletedAt` check to the read path at that time.

## D-028 — 2026-07-27 — Job concurrency is a hard database constraint (partial unique index), not an advisory lock or a best-effort check
**Context:** Phase 8E-004 needed genuine protection against two overlapping invocations of the same
background job (e.g. two scheduler ticks racing, or a manual admin trigger overlapping a scheduled run). A
Postgres advisory lock (`pg_try_advisory_lock`) was considered first, since it's the idiomatic Postgres tool
for this — but this codebase's Prisma client sits on a pooled `pg` connection (`@prisma/adapter-pg`), and a
plain advisory lock acquired on one pooled connection can be released on a *different* connection later,
leaking the lock until that connection closes; `pg_try_advisory_xact_lock` (transaction-scoped, auto-
releasing) avoids that leak risk but would require every job function to run inside one shared transaction,
which none of them currently do (they call several independent Prisma operations).
**Decision:** Use a database-level uniqueness guarantee instead: a partial unique index on `job_runs`,
`WHERE status = 'RUNNING'`. `runJob()` simply attempts `prisma.jobRun.create({ status: "RUNNING" })`; a
second concurrent attempt for the same `jobName` collides on this constraint (a real Postgres
unique-violation, mapped to `JobAlreadyRunningError`), not a race between an application-level "check if
running" query and a later insert.
**Alternatives considered:** Advisory locks (connection-pool leak risk, rejected above). An
application-level check-then-insert without a DB constraint (a genuine race window between the check and
the insert under real concurrency — rejected, this is exactly the kind of check the brief called
"concurrency protection" to prevent, not paper over). A dedicated Redis/queue-based lock (a new
infrastructure dependency for a single-Postgres-instance codebase — rejected as disproportionate).
**Consequences:** Prisma's schema DSL has no `WHERE` clause for `@@unique`, so the index is applied
directly in the migration's raw SQL (`20260727110000_phase8e_job_runs`) rather than expressed declaratively
in `schema.prisma` — documented in both files so a future schema change doesn't accidentally drop it via
`prisma migrate dev`'s drift detection without someone noticing.
**Revisit condition:** If job execution ever moves to a genuinely distributed, multi-process scheduler
where a single Postgres instance's unique index is no longer a sufficient distributed lock (e.g. multiple
independent database replicas), revisit with a proper distributed-lock mechanism.

## D-029 — 2026-07-27 — Background-job auth is a shared-secret header OR an existing admin session, not a new credential type
**Context:** 8E-004 required job endpoints that "do not rely on a normal customer administrator manually
calling a sensitive processing endpoint" while also not inventing a whole new service-account/API-key
management system for a codebase that has no such infrastructure yet.
**Decision:** `authorizeJobRequest()` accepts either (a) a `x-job-scheduler-token` header matching
`JOB_SCHEDULER_TOKEN` from the environment, fail-closed if that variable isn't set (every request refused,
even ones bearing a token, rather than silently falling through to "no auth required"), or (b) an
authenticated session holding the existing `platformTenant:CONFIGURE` permission — the same tier already
used for `POST /api/admin/retention/process-due-deletions`. No new permission resource, no new credential
storage table.
**Alternatives considered:** A dedicated `ServiceAccount`/API-key model with its own DB table and rotation
UI — rejected as disproportionate scope for a phase whose actual requirement was "a scheduler must be able
to call this without a human session," not "build a general service-account system." Session-only auth (no
token path) — rejected, since a real cron/scheduler process has no browser session to present.
**Consequences:** `JOB_SCHEDULER_TOKEN` is a single shared secret, not a per-caller credential — adequate
for "one trusted scheduler process," not for multiple independently-revocable callers; acceptable for this
phase's scope, revisit if multiple distinct scheduler identities are ever needed.
**Revisit condition:** If a real production scheduler is chosen (TODO.md) and it needs distinguishable,
individually-revocable credentials (e.g. multiple environments/regions calling the same endpoints), replace
the single shared token with per-caller credentials at that time — not speculatively now.

## D-030 — 2026-07-27 — Video capture requests an *ideal*, not a hard *minimum*, frame rate
**Context:** `VideoCaptureRecorder` (Phase 8E-006) originally requested `frameRate: { min: 24, max: 30 }`
from `getUserMedia`, directly mirroring the server-side policy's "24-30fps" language. Live browser
verification (a real, fake-camera-device Playwright test) caught this failing with `OverconstrainedError`
— Chromium's fake device could not satisfy a hard 24fps floor, and a hard `min` constraint means
`getUserMedia` refuses to open the camera *at all* rather than degrading gracefully, on any device/browser
that can't guarantee it.
**Decision:** Request `frameRate: { ideal: maxFps, max: maxFps }` instead — a soft preference, not a
requirement. The browser negotiates its best available rate up to the cap; whatever it actually delivers is
read back via `MediaStreamTrack.getSettings()` and reported honestly in `CapturedVideoMetadata.
actualFrameRate`, never assumed or claimed to be within the original 24-30fps target.
**Alternatives considered:** Keeping the hard `min` and catching `OverconstrainedError` to retry with looser
constraints — rejected as needless complexity when a soft `ideal` constraint achieves the same practical
outcome (best-effort toward the policy target) with one request, not two, and without a failure path to
maintain.
**Consequences:** A real recording's actual frame rate is no longer *guaranteed* to be ≥24fps on unusual
hardware — but it wasn't a reliable guarantee before either (a hard constraint that throws on
unsatisfiable hardware is not "guaranteed 24fps," it's "camera unusable on that hardware"), and the honest
metadata means any downstream review of evidence can always see what was actually captured.
**Revisit condition:** None currently — this is the correct, permanent behavior, not an interim workaround.

## D-031 — 2026-07-27 — On-device face recognition uses a CC0-verified dlib-derived model, split across two libraries by capability, not one all-in-one face-recognition package
**Context:** Phase 9B required commercial-licensing verification *before* adding any recognition model — "a
software library's licence does not automatically cover its trained model." Research (WebFetch against
primary sources: npm registry, the actual `LICENSE` files shipped inside installed packages, and Google's
own published PDF model cards — not secondary summaries) found: MediaPipe's face detection and landmark
models are Apache-2.0 per Google's own model cards, but that same model card explicitly states landmarks
"do not provide facial recognition or identification." face-api.js's face-recognition descriptor model
traces directly to dlib, whose author (Davis King) explicitly released those specific weights into the
public domain. But face-api.js's *own* 68-point landmark/alignment model — normally chained together with
its recognition model via the library's convenience API — turned out to be trained on the iBUG 300-W
dataset, whose licence explicitly excludes commercial use (confirmed via the same primary-source method,
`davisking/dlib-models`' own README note).
**Decision:** Split the pipeline across its two capabilities, sourced from whichever library has clean
licensing for that specific capability: `@mediapipe/tasks-vision` (Apache-2.0) for face detection, 478-point
landmarks, and liveness geometry only, never identity; `@vladmandic/face-api` (MIT wrapper) loading *only*
`nets.faceRecognitionNet` — never its own detector or landmark models — computing the descriptor directly
from a MediaPipe-located face crop instead of via face-api.js's own `detectSingleFace().withFaceLandmarks()`
convenience chain.
**Alternatives considered:** `@vladmandic/human` (the same author's newer, actively-maintained library,
explicitly recommended as face-api.js's successor) — evaluated and rejected for the recognition model
specifically, because its own documentation states bundled models carry licensing "inherited from the
original model sources" per model, and the specific embedding model's (MobileFaceNet) original
training-data licence could not be verified as clearly commercially permitted within this session. Per the
explicit instruction ("if unclear, do not ship"), this is a documented blocker, not a chosen path — see
FACIAL_VERIFICATION_LICENSING.md "Explicitly excluded."
**Consequences:** Skipping face-api.js's own alignment step trades some accuracy for licensing certainty
(disclosed as a known trade-off, TODO.md) — the LFW-benchmark 99.38% figure dlib itself reports assumes
its own alignment pipeline, which this codebase does not replicate. `@vladmandic/face-api`'s GitHub
repository is archived (no longer maintained) — the MIT licence and CC0 model weights remain fully valid
regardless, disclosed as an operational risk, not a licensing blocker.
**Revisit condition:** If a future session can trace an actively-maintained recognition model's exact
training-data licence to an unambiguous, commercially-permitted primary source (the same standard applied
to the current choice), it may replace this one — never swap in a model whose licence is merely "probably
fine."

## D-032 — 2026-07-27 — Browser-side facial-recognition libraries are loaded via dynamic `import()`, not a static top-level import
**Context:** The first working version of `lib/facial-verification/browser-engine.ts` statically imported
`@vladmandic/face-api` and `@mediapipe/tasks-vision` at module top level. Live browser verification (the
same "start the dev server, drive it with Playwright" discipline used throughout this build) caught a real
crash: `TypeError: this.util.TextEncoder is not a constructor`, thrown during Next.js's server-side render
pass. A `"use client"` component still renders once on the server before hydrating, and face-api.js's
browser bundle assumes browser globals (`window.TextEncoder` among them) that don't exist in that Node.js
SSR context.
**Decision:** Convert both model loaders to dynamic `import()` calls made *inside* the functions that
actually use them (`loadFaceLandmarker()`, the lazily-loaded face-api module in `computeDescriptorFromVideoFrame()`),
never as static top-level imports. Dynamic `import()` only resolves when actually called, and these
functions are only ever invoked from a browser event handler (camera-start button, detection-loop
`requestAnimationFrame` callback) that cannot run during SSR.
**Alternatives considered:** Wrapping the enrolment/verification components in `next/dynamic(() => import(...), { ssr: false })`
at the page level — rejected as a wider-blast-radius fix (disables SSR for the whole component tree under
it, not just the two library imports that actually need it) for a problem the narrower fix resolves
completely.
**Consequences:** None negative — dynamic import also means these ~10MB+ of ML libraries are code-split
into their own chunk, loaded on demand rather than bloating every page's initial bundle, which would have
been desirable regardless of the SSR crash.
**Revisit condition:** None — this is the correct, permanent pattern for any future browser-only library
with the same SSR-incompatibility profile, not an interim workaround.

## D-033 — 2026-07-27 — Facial-verification-attempt rate limiting is enforced server-side, in the repository function itself, not deferred to unbuilt generic infrastructure
**Context:** Phase 9G asks that verification attempts be rate-limited and that repeated failures trigger
supervisor review. This codebase has an existing, disclosed gap: no generic rate-limiting infrastructure
exists anywhere (TODO.md, since Phase 1) — the first real caller was expected to be the future password-
reset endpoint. `lib/facial-verification/liveness-challenge.ts` already has a *client-side*
`shouldEscalateAfterFailure()` helper, but a client-side-only limit is trivially bypassed by any caller that
doesn't run that specific code path (e.g., a direct API call).
**Decision:** Add a small, purpose-specific rate limit directly inside `runOnDeviceFacialVerificationAttempt()`
— counts `FacialVerificationAttempt` rows for the same gate event within a 5-minute window and rejects the
6th with `TooManyVerificationAttemptsError` (HTTP 429) — rather than waiting for or building generic
rate-limiting middleware first.
**Alternatives considered:** Building the generic infrastructure item from TODO.md first, then wiring this
endpoint through it — rejected as scope creep for this phase; the generic mechanism's first real caller
remains the password-reset endpoint whenever that's built, unaffected by this narrower, business-rule-level
check existing in the meantime (same "hard business rule enforced independent of generic infrastructure"
family as the self-approval checks — D-008/D-020 and others).
**Consequences:** This specific limit is enforced only for facial-verification attempts, not as a reusable
building block — a second sensitive endpoint needing the same protection would need its own, similarly
narrow check, not get one for free. Acceptable: each of this codebase's hard business rules has
consistently been implemented this way (in the repository function itself), not via cross-cutting
middleware.
**Revisit condition:** If/when the generic rate-limiting infrastructure item is finally built, consider
whether this check should be re-expressed on top of it — not before, and not required.

## D-035 — 2026-07-28 — Billing/pricing is append-only-versioned, not a mutable current-price field; a new `TenantSubscription` model, not a repurposed `Tenant.subscriptionStatus`
**Context:** Phase 10 needs both a platform-wide default price and a per-tenant negotiated price, and the
approved commercial-model instruction explicitly requires that "historical invoices must never change when
current pricing changes." A mutable `currentBaseFee`/`currentVehicleFee` field on `Tenant` or
`TenantBillingProfile` would satisfy "what do we charge today" but would either force every historical
invoice calculation to be re-derived from current state (wrong — a later price change would silently alter
history) or require a separate frozen-price mechanism per invoice anyway. Separately, `Tenant.subscriptionStatus`
(`TenantSubscriptionStatus`: TRIAL/ACTIVE/PAST_DUE/CANCELLED) already exists from Phase 7 (SUPPORT-001) as a
manually-set health-summary flag, explicitly documented as "deliberately not a real billing/payment
integration."
**Decision:** `PlatformPricingVersion` and `TenantPricingAgreement` are both append-only tables — a price
change is always a new row with its own `effectiveFrom`, never an edit or delete of an existing one.
`getEffectivePricingForTenant(tenantId, at)` resolves the correct price for any point in time, including
the past, by construction. A brand-new `TenantSubscription` model (its own `SubscriptionStatus` enum:
PENDING/ACTIVE/PAST_DUE/SUSPENDED/CANCELLED) is the real, automatically-managed subscription lifecycle;
`Tenant.subscriptionStatus` is left completely unchanged and continues to back the existing SUPPORT-001
health summary exactly as before.
**Alternatives considered:** Repurposing `Tenant.subscriptionStatus` for the new lifecycle — rejected: its
enum shape doesn't include SUSPENDED, its transitions were never audited or grace-period-aware, and
changing its semantics out from under SUPPORT-001 without instruction would be an unrequested scope change
to already-shipped Phase 7 behaviour. Storing a single "current price" field and computing every invoice
against current state — rejected as directly violating the "historical invoices never change" requirement.
**Consequences:** Two billing-status concepts now exist on a tenant: the old manual flag (Phase 7 support
summary) and the new real, automated one (`TenantSubscription`). They are not kept in sync automatically —
a future task could surface the real status on the SUPPORT-001 dashboard alongside or instead of the manual
one, but that wasn't requested and risks changing already-verified Phase 7 UI behaviour.
**Revisit condition:** If the business wants a single unified status concept, migrate SUPPORT-001's summary
to read from `TenantSubscription` and deprecate the manual flag — not done in this phase.

## D-036 — 2026-07-28 — Subscription suspension blocks only new Movement creation, never any Phase 1-9 safety-critical workflow
**Context:** P10K requires that suspending a tenant for non-payment "must not silently create a safety
risk" and that gate safety/evidence records must never be affected by non-payment. The obvious
implementation of "suspend access" — checking subscription status at the permission-evaluation layer
(`hasPermission()`/`requirePermission()`) so a SUSPENDED tenant loses all API access — would need to be
threaded through every one of the ~30 permission resources this codebase has accumulated since Phase 1,
with a high risk of accidentally blocking gate check-in/check-out, evidence capture, or exception handling
for a vehicle already mid-movement when a tenant's payment lapses — exactly the safety risk the requirement
warns against.
**Decision:** Suspension enforces exactly one access boundary, checked directly inside
`createMovement()` (`movement-repository.ts`): a SUSPENDED tenant cannot start a *new* movement
(`TenantAccessSuspendedError`, mapped to HTTP 403). Every other workflow — gate operations for movements
already in flight, evidence capture, exception handling, reconciliation, billing/payment screens — is
completely unaffected by subscription status. This is documented as the platform's "continuity mode."
**Alternatives considered:** A generic cross-cutting suspension check in `hasPermission()` gating all
non-billing resources — rejected: broad blast radius, high risk of an accidental safety-relevant lockout,
and no existing precedent for a cross-cutting access-control layer of this kind in this codebase (every
other hard business rule here — self-approval blocks, D-008/D-020/D-033 — is a narrow, single-purpose check
in one repository function, not generic middleware). Blocking gate check-in/out too — explicitly rejected
by the requirement itself ("must never silently create a safety risk").
**Consequences:** A SUSPENDED tenant can still fully operate its existing gate/evidence/exception workflow
indefinitely without paying — this is an intentional trade-off (continuity over enforcement strength) that
the business should be aware of and could choose to revisit once real customer risk tolerance is known.
**Revisit condition:** If the business later wants suspension to also block specific additional actions
(e.g. new driver/vehicle onboarding), add a similarly narrow, single-purpose check to that specific
repository function — do not build a generic cross-cutting mechanism speculatively.

## D-037 — 2026-07-28 — `pdfkit` is marked a Next.js `serverExternalPackages` entry, not bundled
**Context:** Live browser verification of P10E's invoice-PDF rendering failed with `ENOENT: no such file or
directory, open 'C:\ROOT\node_modules\pdfkit\js\data\Helvetica.afm'` — a real bug, not a flake. `pdfkit`
resolves its standard-14 font metrics (`.afm`) files relative to its own bundled `__dirname` at require
time; Turbopack (and webpack) rewrite `__dirname` to a synthetic path when a package is bundled into a
server function, which doesn't correspond to any real directory on disk, so the font file can never be
found and every PDF render fails.
**Decision:** Added `serverExternalPackages: ["pdfkit"]` to `next.config.ts` — this is Next.js's documented
mechanism for telling the bundler to `require()` a package from the real `node_modules` directory at
runtime instead of bundling it, preserving its real `__dirname`. Verified fixed by rendering and visually
inspecting both a normal and a VAT-configured invoice PDF end-to-end through the real dev server.
**Alternatives considered:** Embedding a custom TTF font via a buffer instead of relying on the bundled
standard-14 AFM fonts — would avoid the bug but adds a font-licensing question and unnecessary complexity
for what is otherwise a well-known, documented bundler/pdfkit interaction with a one-line fix.
**Consequences:** None — this is the standard fix recommended for `pdfkit` (and several other packages that
read files relative to their own package directory) used inside a Next.js server context.

## D-038 — 2026-07-28 — Every multi-row nested relational write inside an interactive transaction was restructured into an explicit createMany(), independent of whether it fully resolved the pg overlapping-query warning
**Context:** P11-000 investigated pg's "Calling client.query() when the client is already executing a
query" deprecation warning observed during Phase 10's final test runs. `NODE_OPTIONS=--trace-deprecation`
traced every occurrence to `PgTransaction.performIO` inside `@prisma/adapter-pg`, called from Prisma's own
`interpretNode`/`Array.map` query-compiler frames — never from any application-code frame. Six repository
call sites (plus `prisma/seed.ts`) used a nested relational write with 2+ array items (e.g.
`lineItems: { create: [...] }`) inside an interactive `$transaction`, which Prisma decomposes into multiple
per-row `performIO()` calls against the transaction's single pinned `pg.Client`.
**Decision:** Replaced every one of those nested-array-create sites with an explicit
`tx.parent.create()` → `tx.child.createMany()` → (re-fetch if the caller needs the created child rows)
sequence — each step separately awaited by this codebase's own code, not left to Prisma's internal
nested-write interpreter. This is kept as a permanent improvement (a `createMany()` compiles to one SQL
statement instead of N separate per-row INSERTs — strictly more efficient) even though, once measured,
**it did not eliminate the pg warning** — re-tracing after the change showed the identical
`PgTransaction.performIO`/`Array.map` stack shape now originating from the `createMany()` calls themselves,
proving the trigger is Prisma's own internal handling of *any* multi-row write inside an interactive
transaction against the pg driver adapter, not specific to nested writes. Confirmed via public upstream
reports (prisma/prisma issues #29646 and #29407, see KNOWN_BUGS.md BUG-010) that this is a known defect in
`@prisma/adapter-pg`'s `PgTransaction` implementation, not fixable from calling code.
**Alternatives considered:** Reverting the `createMany()` refactor since it didn't fix the targeted warning
— rejected; the refactor is independently correct and more efficient, verified by the full existing test
suite for every affected repository with no behaviour change. Upgrading Prisma to chase a fix — tested
(7.8.0 → 7.9.1, the latest available stable, a minor version bump) and confirmed the warning persists
identically; reverted back to the pinned 7.8.0 rather than carry an upgrade with no measured benefit
(DEPLOYMENT.md's dependency-stability posture, and the task's own "do not upgrade major database packages
unnecessarily" instruction). Suppressing the warning (`process.noDeprecation`, log filtering) — explicitly
rejected per instruction; it is documented instead (KNOWN_BUGS.md BUG-010), not hidden.
**Consequences:** The warning remains visible in test/dev output. It is cosmetic only — every test and
live workflow passes correctly regardless, no data corruption or incorrect result has ever accompanied it,
and `pg`'s own changelog confirms the underlying behavior it warns about won't actually be removed until
`pg@9.0`, so there is no urgency.
**Revisit condition:** Re-run the exact reproduction (`NODE_OPTIONS=--trace-deprecation npx vitest run`)
after any future `@prisma/client`/`@prisma/adapter-pg` upgrade, or if prisma/prisma #29646/#29407 are
closed upstream.

## Open / not yet decided (tracked, not blocking)
- **Facial-verification provider** — blocked, no vendor selected. Interface + mock built regardless.
- **Telematics provider** — blocked, no vendor selected (GPS-BLOCKED). `TelematicsProvider` interface +
  `MockTelematicsProvider` + `ManualGpsConfirmation` fallback are built and tested (Phase 6, done — see
  WORKLOG.md Session 11); only the actual vendor connection (Netstar/Cartrack/Tracker/MiX/other) remains
  blocked pending the user's vendor decision + credentials. October pilot scope (per the user's latest
  instruction) targets one production provider matched to the pilot customer's existing tracker.
- **Production hosting (Supabase vs self-managed Postgres, storage provider, deploy target)** — deferred
  to Phase 7; will be raised as a major decision (paid third-party service) before any account is created.
- **Subscription billing** — done, Phase 10 (D-035/D-036/D-037, BILLING_AND_SUBSCRIPTIONS.md). Still
  blocked within that phase: production payment-gateway vendor selection, production transactional-email
  vendor selection, and the platform company's real legal/registration/VAT/banking details (currently
  fictional dev/demo values) — see BILLING_AND_SUBSCRIPTIONS.md "Decisions still required from the
  business."
- **Full investigation-case management** — complete in Phase 11; see D-039 and
  `INVESTIGATIONS_AND_EXTERNAL_AUDIT.md`.

## D-039 — 2026-08-11 — Race-safe active referral identity and a distinct external-audit boundary

**Context:** Phase 11 required duplicate-safe referrals under concurrency and external access narrower than
tenant roles or platform support. A read-then-create lookup races; reusing a broad role leaks unrelated data.

**Decision:** An open referral stores `activeReferralKey = tenantId:recordType:recordId`, protected by a
database unique index. A unique-race loser returns the winner; closure clears the key. External audit uses
the dedicated minimal role and grant/case/log tables. Every portal call revalidates the grant and flags.

**Consequences:** Concurrent referrals produce one active case/source link; a closed referral does not
prevent a later new case. External users cannot enumerate tenant cases, use internal mutation routes, or
retain access after expiry/revocation. The additive migration replays cleanly from empty.

**Supersedes:** The note above described Phases 5–7 only. Phase 11 case management and Phase 12 analytics
are now complete.

## D-040 — 2026-08-11 — Persist explainable deterministic indicators; do not score people or recalculate on dashboard reads

**Context:** Phase 12 requires reproducible review prompts, immutable thresholds, lifecycle history,
duplicate resistance, and realistic dashboard performance. An on-demand opaque score cannot meet those
requirements and would risk presenting correlation as a finding.

**Decision:** Use tenant-versioned deterministic `AnalyticsRule` rows and materialised
`AnalyticsIndicator` rows. Persist the complete threshold snapshot, reporting window, neutral explanation,
permitted supporting references, quality class, and a deterministic calculation key. Enforce uniqueness
in Postgres. Calculate explicitly or through the shared job wrapper; dashboard reads consume persisted
results. Never create a finding, disciplinary decision, message, or conclusion automatically.

**Consequences:** Results can be reproduced and reviewed after a tenant changes a rule. Retry/concurrent
calculation is safe, and dashboard cost stays bounded. The trade-off is that an indicator is only as fresh
as the latest calculation timestamp, which is displayed prominently.

## D-041 — 2026-08-11 — Tracking analytics are source-labelled and may be unavailable; no Phase 12 route deviation

**Context:** The repository contains a provider-neutral tracker boundary and mock/manual records but no
production provider credentials or sufficiently complete planned-route data.

**Decision:** Classify tracker contributions as `MOCK`, `MANUAL`, `MIXED`, `INCOMPLETE`, or `UNAVAILABLE`;
never infer `LIVE` from a provider-looking reference. Stale/unavailable tracking is a data-quality prompt,
not evidence of misconduct. Do not calculate route deviation in Phase 12.

**Consequences:** Reports remain honest and useful without overstating integration maturity. Production
provider validation, route semantics, and credentials are Phase 13 dependencies requiring a separate
business/vendor decision.
# Phase 13A decisions (2026-08-11)

- D-052: `APP_ENV`, not `next build`/`NODE_ENV`, selects deployment policy so local production builds remain possible while real production fails closed.
- D-053: production requires durable object storage; filesystem storage and every mock/dev-console integration are forbidden.
- D-054: session, media-signing and scheduler keys rotate through current/previous configuration; stored session tokens and login dimensions use keyed HMAC digests.
- D-055: notification delivery is at most three automatic attempts with persisted backoff eligibility; schedulers never retry indefinitely.
- D-056: backup/restore automation is deliberately restricted to loopback test-named databases and a fixed disposable restore suffix. Hosted restore is a separately approved operator procedure.
- D-057: no tracker/email/payment vendor or hosted platform is selected. PayFast/R2/provider names are adapter boundaries, not commercial approval.
- D-058: production diagnostics are read-only and platform-authorized. Provider accounts, schedules, deployment and migrations can never be created from the readiness page.
- D-059: patch/minor security updates moved Next.js to 16.3.0 and the Prisma toolchain to 7.9.1 after `npm audit`; no automatic major upgrade was performed.

# Phase 14A decisions (2026-08-12)

- D-060: the pilot is one fixed, visibly synthetic tenant with deterministic IDs. Re-seeding replaces only that exact tenant; reset refuses a mismatched id/name/slug, non-loopback database, non-approved database name, or any production environment.
- D-061: pilot roles copy the already verified customer-role permission sets without expansion. “Investigation Manager” maps to the established Security Supervisor / Approving Manager and “Internal Auditor” maps to Internal Investigator / Auditor; Phase 14A does not create broader convenience roles.
- D-062: pilot CSV tooling is dry-run only. It validates tenant identity, duplicates, required fields, non-deliverable addresses, formula prefixes, and forbids biometric columns; a future authorised production importer requires a separate design and approval.
- D-063: no disposable pilot-only schema is added. Provider degradation, operating hours and department assumptions use existing source-labelled records/configuration plus the UAT catalogue, keeping production history models free of fixture metadata.

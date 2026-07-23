# DATA_MODEL.md

Source of truth for the schema is `prisma/schema.prisma`. This file explains intent, relationships and
lifecycle that aren't obvious from the schema alone. Update both together.

## Tenant boundary
Every tenant-owned table has a non-nullable `tenantId` FK to `Tenant`. `Tenant` itself, and lookup tables
that are intentionally global (e.g. `Permission` definitions), are the only tables without one.

## Phase 1 entities (foundation)
- **Tenant** — company/organisation. id, name, slug, timezone, currency, retentionDays, status, createdAt.
- **Site** — a tenant's physical location. tenantId, name, address, timezone override.
- **Gate** — an entry/exit point at a Site. tenantId, siteId, name, direction-capable (entry/exit/both).
- **User** — tenantId, email (unique per tenant), passwordHash (nullable — null until an invited user
  accepts and sets one), name, status (active/suspended/invited), mfaEnabled, mfaSecret (nullable),
  roleId, createdAt, lastLoginAt.
- **UserInvitation** — one per invited user. tenantId, userId (unique), tokenHash (unique, same
  hashed-bearer-token pattern as Session), invitedById, expiresAt (7 days), acceptedAt, revokedAt.
- **Role** — tenantId (roles are tenant-scoped so tenants can customise), name, description, isSystem
  (seeded system roles vs tenant-defined).
- **Permission** — global catalogue: resource (e.g. `driver`, `gateEvent`, `movement`), action (view,
  create, edit, delete, approve, reject, export, audit, configure).
- **RolePermission** — join table, roleId + permissionId.
- **UserPermissionOverride** — userId, permissionId, effect (grant|revoke), reason, grantedBy — for
  exceptions without inventing a one-off role.
- **Session** — id, userId, tenantId, createdAt, expiresAt, ip, userAgent, revokedAt.
- **ApprovalDelegation** — tenantId, delegatorId, delegateId, permissionScope (resource+action or role),
  startAt, expiresAt, revokedAt.
- **AuditLog** — append-only. tenantId, userId (nullable for system actions), timestamp, ip, sessionId,
  action, entityType, entityId, beforeValue (json), afterValue (json), reason, correlationId,
  relatedGateEventId (nullable).

## Phase 2 entities (master data — implemented)
- **Driver** — tenantId, employeeNumber, name, contact info, portraitMediaAssetId (nullable, `@unique` FK to
  `MediaAsset`; real upload landed in Phase 4 — see DECISIONS.md D-012; update-only, not settable at
  creation, since the MediaAsset must be uploaded with `ownerId` = this driver's already-existing id),
  department (plain string — no separate Department entity in V1), status
  (active/suspended/blacklisted), licenceNumber/Class/Expiry, pdpNumber/Expiry, authorisedVehicleClasses
  (string array), restrictions, facialVerificationEnrolled/Provider/EnrolledAt, archivedAt.
- **Vehicle** — tenantId, fleetNumber, registrationNumber (unique per tenant, required),
  vin (unique per tenant when present — Postgres treats multiple NULLs as distinct, so VIN-less vehicles
  don't collide), engineNumber, make/model/year/colour, category (drives default tyre layout),
  ownership, fuelType, tankCapacityLitres, odometerReading, fuelLevelPercent, assignedDriverId,
  licenceDiscExpiry/roadworthyExpiry/insuranceExpiry (quick-access summary fields — see note below),
  gpsProvider/DeviceReference/Status/LastCommunicationAt, baselineConditionNotes, operationalStatus
  (operational/workshop-lockout/security-lockout/decommissioned — this is what
  `isVehicleAvailableForMovement()` checks), tyrePositionConfigId, attachedToVehicleId (self-relation,
  one level, for a trailer's default towing vehicle), archivedAt.
- **ComplianceDocument** — reusable across Driver and Vehicle (build brief's "reusable document/compliance
  structures"). ownerType + exactly one of driverId/vehicleId set (enforced in
  `compliance-document-repository.ts`, not a DB constraint — Postgres doesn't have a clean
  "exactly one of two nullable FKs" check without a trigger, and this is low enough risk to enforce at
  the application boundary). documentType, documentNumber, issueDate, expiryDate, issuer, notes,
  attachmentUrl (dev-mode placeholder), verificationStatus, verifiedById/At.
  **Deliberate duplication:** Driver.licenceExpiry/pdpExpiry and Vehicle.licenceDiscExpiry/
  roadworthyExpiry/insuranceExpiry are *also* stored directly on those models, separate from any
  ComplianceDocument row. This matches the build brief's explicit field lists for both models (7.3/7.4)
  and serves a different purpose: fast authorization/dashboard queries without joining the polymorphic
  document table, while ComplianceDocument carries the attachment/issuer/verification detail. Two sources
  of the same date is a real tradeoff (they can drift) — accepted because the brief asks for both layers.
  `attachmentMediaAssetId` (nullable, `@unique` FK to `MediaAsset`) replaced the old dev-mode
  `attachmentUrl` placeholder in Phase 4 (DECISIONS.md D-012) — same update-only pattern as
  `Driver.portraitMediaAssetId`, linked via `POST /api/compliance-documents/[id]/attachment` after the
  document itself already exists.
- **DocumentExpiryRule** — tenantId + documentType (unique) → action (WARN / REQUIRE_SUPERVISOR_APPROVAL /
  BLOCK_CLEARANCE). Pure evaluation logic lives in `lib/documents/expiry-rules.ts`
  (`evaluateDocumentExpiry`), deliberately DB-free and unit-tested — an expired document with no
  configured rule (or a WARN rule) never blocks anything by itself.
- **TyrePositionConfig** + **TyrePositionDefinition** — a named layout (e.g. "Truck (dual rear wheels)")
  with an ordered list of positions (code + label). Category mirrors Vehicle.category. 5 system layouts
  seeded (Passenger, Light Commercial, Truck, Truck dual-rear-wheel, Trailer); tenants can add custom ones.
- **VehicleTyre** — current tyre reference data (brand/size/notes) per fitted position, one row per
  (vehicleId, positionDefinitionId). Explicitly *not* a readings/inspection history table — that's
  Phase 3/4 scope per the build brief ("this phase only needs the vehicle tyre-position configuration and
  current tyre reference data").
- **MovementAuthorisation** — the pre-gate approval record (build brief 7.5). tenantId, siteId, vehicleId,
  driverId, trailerVehicleId (per-movement trailer choice, may differ from the vehicle's default
  attachedToVehicleId), movementType, purpose, destination, expected departure/return, three separate
  reference fields (customerProjectJobReference, deliveryOrCollectionReference, purchaseOrderReference —
  kept distinct rather than one generic "reference" so the gate-facing search can match any of them),
  approvedCargoSummary, sealOrContainerReference, referenceCode (unique, short human-typeable code for
  gate lookup — `lib/movements/reference-code.ts`), requesterUserId, approverUserId, status (state
  machine — see ARCHITECTURE.md), approvalComments, cancelledAt/Reason.
- **ManualFacialVerificationFallback** — driverId, reason, requestedByUserId, approvedByUserId (nullable
  until resolved), status (pending/approved/denied), evidenceMediaAssetId (nullable, `@unique` FK to
  `MediaAsset` — replaced the old dev-mode `evidenceRef` string in Phase 4, DECISIONS.md D-012; attached in
  a separate step after the request exists via `attachEvidenceToManualFallback()` /
  `POST /api/drivers/[id]/facial-verification/manual-fallback/[fallbackId]/evidence`), relatedGateEventId
  (nullable forward-compat field for Phase 3, same pattern as AuditLog's). Not tied to a GateEvent yet since
  none exists — see `lib/facial-verification/provider.ts` and ARCHITECTURE.md.
- **Tenant.allowSelfApproveMovement** (added to the existing Tenant model) — tenant policy switch,
  default `false`. Checked in `approveMovement()` only when `requesterUserId === approverUserId`.

## Phase 3 entities (gate operations — implemented)
- **InspectionTemplate** — tenant-scoped, versioned (immutable-row versioning, see DECISIONS.md D-009),
  vehicle-category-aware (`vehicleCategory` nullable = generic fallback). `getActiveTemplateForCategory()`
  picks the tenant's active category-specific template, else the active generic one. `isSystem` marks the
  one seeded default template ("Standard Gate Inspection").
- **InspectionItem** — ordered question within a template, grouped by `InspectionSection` (driver/
  authorisation, vehicle identity, exterior condition, lights, tyres/wheels, operational info, load
  verification). `responseType` is CHECK (pass/fail/n-a/unable-to-verify), READING (adds a value + unit,
  e.g. tyre tread depth in mm), or TEXT. `defaultExceptionSeverity`/`requiresSupervisorApprovalOnFail`
  drive automatic exception raising on a FAIL outcome.
- **GateEvent** — the gate-side presence/processing record for one entry or exit, linked to the
  `MovementAuthorisation` it corresponds to (`movementAuthorisationId`, required — a GateEvent never exists
  without an already-approved movement), the site/gate/vehicle/trailer/driver, the security officer who ran
  it, the `InspectionTemplate` used (nullable — a tenant might have none configured yet), status (own state
  machine, see ARCHITECTURE.md "Gate operations architecture"), identity-verification result fields, and
  decision fields (decision/decisionReason/decisionByUserId/decisionAt). At most one *open* (non-terminal)
  GateEvent exists per movement at a time — enforced in `gate-event-repository.ts`, not a DB constraint
  (see DECISIONS.md D-010).
- **GateEventInspectionItem** — one recorded answer against one `InspectionItem` for one `GateEvent`.
  outcome (PASS/FAIL/NOT_APPLICABLE/UNABLE_TO_VERIFY), optional readingValue/readingUnit, comment,
  exceptionSeverity/supervisorApprovalRequired (computed from the item's defaults at record time),
  `evidenceMediaAssetId` (nullable, `@unique` FK to `MediaAsset` — replaced the old dev-mode `evidenceRef`
  placeholder string in Phase 4, DECISIONS.md D-012; evidence is uploaded via `POST /api/media/upload` with
  `ownerType=GATE_EVENT_INSPECTION_ITEM, ownerId=<gateEventId>` before the result is recorded, then the
  returned MediaAsset id is passed into `recordInspectionResult()`). Unique per (gateEventId,
  inspectionItemId) — recording again for the same item updates in place.
- **ExceptionType** — tenant-configurable exception category, same shape/purpose as `DocumentExpiryRule`:
  code/label, defaultSeverity, defaultOutcomeAction, `requiresSupervisorApproval` (a tenant *default*; the
  hard self-approval rule itself is never bypassable regardless of this value — see DECISIONS.md D-008).
- **Exception** — an actual raised exception against a GateEvent, optionally tied to the
  `GateEventInspectionItem` that triggered it (auto-raised on FAIL) or ad hoc. severity,
  requiresSupervisorApproval, outcomeAction (one of WARNING/MANUAL_REVIEW/SUPERVISOR_APPROVAL/
  WORKSHOP_LOCKOUT/SECURITY_HOLD/DENIED/CLEARED_WITH_OBSERVATION), raisedByUserId/raisedAt,
  resolvedByUserId/resolvedAt/resolutionNotes. `requiresSupervisorApproval: true` exceptions can only be
  resolved by a different user than `raisedByUserId`, and only once the GateEvent has been explicitly
  escalated to `SUPERVISOR_REVIEW`.

## Phase 4 entities (evidence/media — implemented)
- **MediaAsset** — one reusable, polymorphic model for every kind of uploaded evidence in the system
  (DECISIONS.md D-011). tenantId, `ownerType` (`GATE_EVENT` | `GATE_EVENT_INSPECTION_ITEM` |
  `MANUAL_FACIAL_VERIFICATION_FALLBACK` | `DRIVER_PORTRAIT` | `COMPLIANCE_DOCUMENT`) + `ownerId` (a plain
  string, not an FK — same shape as `AuditLog.entityType`/`entityId`, chosen over
  `ComplianceDocument`'s N-nullable-FK-columns pattern since there are 5 owner kinds here, not 2; owner
  existence-in-tenant is checked in application code, `assertOwnerExistsInTenant()`, not a DB constraint),
  capturedByUserId/capturedAt, fileName, contentType, fileSizeBytes, `storageKey` (opaque,
  tenant-namespaced, `@unique`, never exposed directly to a client), `checksumSha256` (computed
  server-side on receipt, never trusts a client-supplied value — an optional client-supplied checksum is
  only used as an extra cross-check, see `ChecksumMismatchError`), `classification` (defaults `RESTRICTED`
  — see SECURITY_AND_POPIA.md), `idempotencyKey` (`@@unique([tenantId, idempotencyKey])` — a retried
  upload over flaky gate connectivity returns the existing row rather than creating a duplicate, EVID-003).
  No public/permanent URL is ever exposed for a MediaAsset — every read goes through
  `mintSignedUrlForMediaAsset()` (permission-checked, tenant-scoped, audit-logged) then
  `serveRawMediaAsset()` (signature+expiry+tenant re-verified). See ARCHITECTURE.md "Media/video
  architecture" for the full read path and `lib/storage/provider.ts` for the storage adapter interface.

## Phase 5B entities (reconciliation — implemented)
- **Reconciliation** — pairs one movement's departure and return `GateEvent` (see ARCHITECTURE.md
  "Reconciliation architecture" for how "departure"/"return" are assigned). tenantId,
  `movementAuthorisationId` (`@unique` — one reconciliation per movement),
  `departureGateEventId`/`returnGateEventId` (each `@unique` — a `GateEvent` can be a leg of at most one
  reconciliation ever, DB-enforced), snapshotted `departureOdometer`/`returnOdometer`/`kmTravelled`,
  `departureFuelPercent`/`returnFuelPercent`/`fuelDeltaPercent`, `status`
  (`NO_DISCREPANCIES`|`OPEN`|`RESOLVED`, derived from its discrepancies, never set directly),
  `builtByUserId` (null when built automatically rather than via manual retry).
- **ReconciliationDiscrepancy** — one structured, reviewable finding. tenantId, reconciliationId,
  `category` (`ODOMETER`|`FUEL`|`VEHICLE_CONDITION`|`TYRE_CONDITION`|`CARGO_AND_LOAD`), `severity`
  (reuses `ExceptionSeverity` — the auto-engine never assigns `CRITICAL`), `description`,
  `departureValue`/`returnValue`/`deltaValue`, optional `inspectionItemId` (null for the odometer/fuel
  comparisons, set for a specific configured inspection-item diff), optional `linkedExceptionId`
  (`@unique` — set when a `HIGH` discrepancy raised a real `Exception` against the return `GateEvent`,
  RECON-002), `status` (`OPEN`|`RESOLVED`), `resolvedByUserId`/`resolvedAt`/`resolutionNotes`
  (resolution explanation is mandatory)/`correctiveAction` (optional).
- Added `MovementAuthorisation.expectedDistanceKm` (nullable `Float`) — optional planned-trip-distance
  baseline the reconciliation engine compares actual `kmTravelled` against for the "excess mileage" check;
  null skips that check rather than treating it as zero.

## Phase 4+ entities (planned, not yet built)
TyreReading (history), RiskRegisterEntry, ControlRegisterEntry, ControlTestResult — documented here as
each is actually migrated, not in advance.

## Record lifecycle notes
- `AuditLog`: insert-only, never updated or deleted by application code.
- `Session`: soft-revoked via `revokedAt`, never deleted (needed for forensic history of who was logged
  in when).
- Tenant-owned master data (Driver, Vehicle, etc.) will use soft-delete (`archivedAt`) once modeled, per
  the "soft deletion only where appropriate" non-functional requirement — hard delete is reserved for
  data genuinely required to be erasable (e.g. POPIA erasure requests), tracked in
  `SECURITY_AND_POPIA.md`.

## Migration history summary
- `20260719193452_init` (applied): Tenant, Site, Gate, User, Role, Permission, RolePermission,
  UserPermissionOverride, Session, ApprovalDelegation, AuditLog.
- `20260719193600_session_token_hash` (applied): added `Session.tokenHash` (unique) — the session cookie
  carries a random opaque bearer token; only its SHA-256 hash is persisted, so a DB leak alone doesn't
  yield valid sessions. See `src/lib/auth/session.ts`.
- `20260720080000_invitations_and_audit_protection` (applied): `User.passwordHash` made nullable
  (null = invited, not yet activated); added `UserInvitation`; added Postgres triggers
  (`prevent_audit_log_modification`) that raise on any UPDATE/DELETE against `audit_logs`, enforcing the
  append-only guarantee at the database level, not just by application convention.
- `20260720140000_phase2_master_data` (applied): Driver, Vehicle, ComplianceDocument, DocumentExpiryRule,
  TyrePositionConfig, TyrePositionDefinition, VehicleTyre, MovementAuthorisation; added
  `Tenant.allowSelfApproveMovement`.
- `20260720150000_manual_facial_verification_fallback` (applied): ManualFacialVerificationFallback.
- `20260721160000_phase3_gate_operations` (applied): InspectionTemplate, InspectionItem, GateEvent,
  GateEventInspectionItem, ExceptionType, Exception, and all their back-relations on Tenant/Site/Gate/
  Vehicle/Driver/User/MovementAuthorisation.
- `20260722090000_phase4_media_assets` (applied): `MediaAsset` (new table); dropped
  `Driver.portraitUrl` → added `Driver.portraitMediaAssetId`; dropped `ComplianceDocument.attachmentUrl` →
  added `ComplianceDocument.attachmentMediaAssetId`; dropped `GateEventInspectionItem.evidenceRef` → added
  `GateEventInspectionItem.evidenceMediaAssetId`; dropped
  `ManualFacialVerificationFallback.evidenceRef` → added
  `ManualFacialVerificationFallback.evidenceMediaAssetId` (all four new columns nullable, `@unique`,
  FK → `MediaAsset.id` `ON DELETE SET NULL`). See DECISIONS.md D-011/D-012.
- `20260723222721_phase5b_reconciliation` (applied): `Reconciliation`, `ReconciliationDiscrepancy`, and
  their back-relations on Tenant/User/MovementAuthorisation/GateEvent/InspectionItem/Exception; added
  `MovementAuthorisation.expectedDistanceKm`.

All eight migrations are applied to the dev DB (`gate_fleet_governance`) and the test DB
(`gate_fleet_governance_test`), same local Postgres container, different databases.

**Note for future schema changes:** `npx prisma migrate dev --name <name>` works normally in this
environment's shell as of the Phase 5B session (2026-07-23/24) — the earlier note that it didn't was
specific to whatever shell an earlier session was using and no longer applies; it ran cleanly here in both
the Bash tool and PowerShell.

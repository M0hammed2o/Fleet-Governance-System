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
  machine — see ARCHITECTURE.md), approvalComments, cancelledAt/Reason. Phase 5C (DISPATCH-002) added
  senderName/senderContact/recipientName/recipientContact (free text, not FKs). Phase 5C (DISPATCH-004)
  added vehicleUsePolicyId — a plain nullable String, deliberately not yet a Prisma relation since
  `VehicleUsePolicy` doesn't exist until Phase 6; upgrading it to a real `@relation` FK is a Phase 6
  migration, not a Phase 5C one.
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
- **Exception** — an actual raised exception, originally always against a GateEvent (optionally tied to the
  `GateEventInspectionItem` that triggered it — auto-raised on FAIL — or ad hoc). severity,
  requiresSupervisorApproval, outcomeAction (one of WARNING/MANUAL_REVIEW/SUPERVISOR_APPROVAL/
  WORKSHOP_LOCKOUT/SECURITY_HOLD/DENIED/CLEARED_WITH_OBSERVATION), raisedByUserId/raisedAt,
  resolvedByUserId/resolvedAt/resolutionNotes. `requiresSupervisorApproval: true` exceptions can only be
  resolved by a different user than `raisedByUserId`, and only once the GateEvent has been explicitly
  escalated to `SUPERVISOR_REVIEW`. Phase 6 made `gateEventId` nullable and added a nullable `vehicleId`
  (DECISIONS.md D-020) — a telematics/vehicle-use-policy violation exception sets `vehicleId` instead,
  since it has no GateEvent in context; every Phase 3/5B caller is unaffected and still always sets
  `gateEventId`.

## Phase 4 entities (evidence/media — implemented)
- **MediaAsset** — one reusable, polymorphic model for every kind of uploaded evidence in the system
  (DECISIONS.md D-011). tenantId, `ownerType` (`GATE_EVENT` | `GATE_EVENT_INSPECTION_ITEM` |
  `MANUAL_FACIAL_VERIFICATION_FALLBACK` | `DRIVER_PORTRAIT` | `COMPLIANCE_DOCUMENT` | `MOVEMENT_DOCUMENT`,
  the last added Phase 5C for DISPATCH-003 delivery notes — many-to-one with a movement, unlike
  `DRIVER_PORTRAIT`'s implicit 1:1, so no unique constraint on the pair) + `ownerId` (a plain
  string, not an FK — same shape as `AuditLog.entityType`/`entityId`, chosen over
  `ComplianceDocument`'s N-nullable-FK-columns pattern since there are 6 owner kinds here, not 2; owner
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

## Phase 6 entities (telematics/geofencing/vehicle-use policies — implemented)
- **TelematicsEvent** — one normalised position/status sample regardless of source (`PROVIDER` from
  `TelematicsProvider.getSnapshot()`, or `MANUAL` — reserved for a future manual-entry path, not yet
  written by any code this phase). tenantId, vehicleId, latitude/longitude/speedKmh/headingDegrees/
  ignitionOn/odometerKm (all nullable — a provider snapshot may not carry every field),
  `recordedAt` (when the provider says the reading was taken — what staleness is measured against,
  distinct from `createdAt`, when it was ingested), `providerReference`.
- **Geofence** — a simple circle: name, centerLatitude/centerLongitude, radiusMeters. Deliberately not a
  polygon/map-drawing tool (GPS-004 "basic geofence monitoring").
- **ManualGpsConfirmation** — mirrors `ManualFacialVerificationFallback` exactly (GPS-002): vehicleId,
  reason, positionDescription, status (`PENDING`|`APPROVED`|`DENIED`), requestedByUserId/requestedAt,
  approvedByUserId/resolvedAt/resolutionNotes. Same hard, unconditional self-approval block.
- **VehicleUsePolicy** — POLICY-001's full field list: name, driverId (the named driver/rep),
  effectiveFrom/effectiveTo, permittedDaysOfWeek (`Int[]`, 0=Sunday..6=Saturday, empty = every day),
  permittedStartTime/permittedEndTime (`"HH:MM"` strings, server-local time — a documented simplification,
  not a per-tenant-timezone-aware evaluation), approvedDestination (free text)/approvedGeofenceId
  (optional FK to Geofence), kmLimitPerTrip/PerDay/PerWeek/PerMonth, allowAfterHours/allowWeekend/
  allowPrivateUse flags, privateUseKmAllowanceKm, expectedReturnTime, approvingManagerUserId (nullable at
  creation — the first `vehicleUsePolicy:APPROVE` holder to approve becomes the manager of record if none
  was named), status (`DRAFT`|`ACTIVE`|`SUSPENDED`|`EXPIRED`), overrideReason.
- **VehicleUsePolicyVehicle** — pure join table (no tenantId, same precedent as `RolePermission`),
  `@@unique([policyId, vehicleId])` — one policy can cover several vehicles.
- `MovementAuthorisation.vehicleUsePolicyId` upgraded from a plain String (Phase 5C, D-019) to a real
  `@relation` now that `VehicleUsePolicy` exists — see D-019's revisit condition and the migration-history
  entry below (any pre-existing unvalidated value was nulled out, not preserved, as part of the migration).
- `Exception.gateEventId` made nullable, `Exception.vehicleId` added — see the Phase 3 Exception entry
  above and DECISIONS.md D-020.

## Phase 8A entities (engineering hardening — implemented)
- `Exception` gained `violationType` (nullable string — the `PolicyViolationType` an open telematics episode
  is tracking; null for every gate-event/reconciliation exception), `observationCount`
  (`Int @default(1)` — consecutive syncs that re-observed the same still-open violation, used to escalate a
  continuing violation to HIGH/supervisor-approval), and `lastObservedAt` (nullable — when an open episode
  was last reconfirmed, distinct from `raisedAt`), plus an index on `[vehicleId, violationType, resolvedAt]`
  for the dedup lookup. See ARCHITECTURE.md "GPS-exception deduplication" and HARD-006.
- `Tenant.timezone` (Phase 1 field, previously unused beyond documentation) is now actually read by
  `evaluateVehiclePolicyCompliance()` and passed through to `evaluatePolicyCompliance()`/
  `computeDistanceSoFar()` — no schema change needed, HARD-004 was a behavioural gap, not a missing column.

## Phase 7 entities (platform support-access — implemented)
- **SupportAccessSession** — a time-limited, fully audited permission window for one platform-tenant user
  to view one customer tenant's support-view summary (see ARCHITECTURE.md "Platform support-access
  architecture"). tenantId (the actor's own platform tenant), actorUserId, customerTenantId, reason
  (mandatory)/ticketReference (optional), elevated/elevatedReason/elevatedAt (DECISIONS.md D-021 — records
  intent/audit trail only, doesn't itself unlock any write path), startedAt/expiresAt (60-minute TTL)/
  endedAt (set on explicit exit, distinct from simply reaching expiresAt).
- **SupportNote** — an append-only log of platform-staff notes against a customer tenant, same
  "don't rewrite history" principle as `AuditLog`. tenantId (author's platform tenant), customerTenantId,
  authorUserId, note.
- Added `Tenant.subscriptionStatus` (`TenantSubscriptionStatus`: TRIAL/ACTIVE/PAST_DUE/CANCELLED,
  default TRIAL) — a manually-set status flag for the SUPPORT-001 health summary, deliberately not a real
  billing/payment integration (subscription billing is explicitly out of scope for this build run).

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
- `20260723230119_phase5c_dispatch_enhancements` (applied): extended `MovementType` with `SALES_VISIT`/
  `SERVICE`/`AUTHORISED_PRIVATE_USE`; added `MovementAuthorisation.senderName/senderContact/recipientName/
  recipientContact/vehicleUsePolicyId`; extended `MediaAssetOwnerType` with `MOVEMENT_DOCUMENT`.
- `20260723232024_phase6_telematics_geofencing_policies` (applied): `TelematicsEvent`, `Geofence`,
  `ManualGpsConfirmation`, `VehicleUsePolicy`, `VehicleUsePolicyVehicle`; made `Exception.gateEventId`
  nullable and added `Exception.vehicleId` (D-020); upgraded `MovementAuthorisation.vehicleUsePolicyId` to
  a real `@relation` FK (D-019's revisit condition) — includes a data-migration step nulling out any
  pre-existing value first, since nothing could have referenced a real policy before this migration.
- `20260724000922_phase7_support_access` (applied): `SupportAccessSession`, `SupportNote`.
- `20260724001114_phase7_tenant_subscription_status` (applied): added `Tenant.subscriptionStatus`
  (a separate migration rather than folded into the one above — split naturally since the need for it was
  only discovered while writing SUPPORT-001's health summary, after the first Phase 7 migration had
  already been applied to the dev database; see WORKLOG.md Session 12 for the checksum-mismatch lesson
  this avoided repeating).
- `20260726120000_phase8a_telematics_exception_dedup` (applied): added `Exception.violationType`/
  `observationCount`/`lastObservedAt` + a `[vehicleId, violationType, resolvedAt]` index (HARD-006).
  Purely additive — no data migration needed, every pre-existing row gets `violationType: null`,
  `observationCount: 1` (the column default), `lastObservedAt: null`.

All thirteen migrations are applied to the dev DB (`gate_fleet_governance`) and the test DB
(`gate_fleet_governance_test`), same local Postgres container, different databases, and verified to apply
cleanly to a genuinely empty database from zero (`npm run verify:clean-migrations`, Phase 8A HARD-001).

**Note for future schema changes:** `npx prisma migrate dev --name <name>` works normally in this
environment's shell as of the Phase 5B session (2026-07-23/24) — the earlier note that it didn't was
specific to whatever shell an earlier session was using and no longer applies; it ran cleanly here in both
the Bash tool and PowerShell. **Never hand-edit a migration.sql file after it has already been applied to
any database** — Prisma records a checksum at apply time and will refuse to proceed on any database still
carrying the old checksum (see WORKLOG.md Session 11's test-DB incident and Session 12's dev-DB recovery of
the same class of mistake, this time fixed by correcting the recorded checksum directly rather than
resetting). If a just-applied migration needs a correction, always create a new, separate migration for it.

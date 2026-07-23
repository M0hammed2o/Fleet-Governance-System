# PRODUCT_REQUIREMENTS.md

Requirement IDs: `<MODULE>-<NNN>`. Status: `todo | in-progress | done | blocked`. This file is updated as
work lands — do not batch updates to the end of a phase.

## Traceability legend
Each requirement should eventually link to the code/tests that satisfy it. Until code exists, status is
`todo` and the "Implementation" column is empty.

## FOUND — Foundation (Phase 1)
| ID | Requirement | Acceptance criteria | Status | Implementation |
|---|---|---|---|---|
| FOUND-001 | Multi-tenant data model | Every tenant-owned table has non-null tenantId; DB constraint prevents null | done | prisma/schema.prisma; tests/tenant-isolation.test.ts |
| FOUND-002 | User auth (email+password) | User can log in, session persists via httpOnly cookie, invalid creds rejected | done | src/app/api/auth/login/route.ts; manually verified 2026-07-19 (see WORKLOG.md) |
| FOUND-003 | Password reset | User can request reset, token single-use + expiring, old sessions revoked on reset | todo | design documented in SECURITY_AND_POPIA.md "Deferred design: password reset" (D-004); not blocking Phase 2 |
| FOUND-004 | Session management | Sessions revocable server-side; expired session rejected on next request | done | src/lib/auth/session.ts (`evaluateSession`); tests/session.test.ts (8 unit cases incl. exact-boundary, plus integration case proving suspension revokes existing sessions) |
| FOUND-005 | Roles & granular permissions | Permission = resource+action; role has many permissions; per-user overrides supported | done | src/lib/auth/authorize.ts; tests/authorize.test.ts (6 cases) |
| FOUND-006 | Approval delegation | Delegation has start/expiry; expired delegation has zero effect | done | src/lib/auth/authorize.ts; tests/authorize.test.ts (active + expired cases) |
| FOUND-007 | Audit foundation | Sensitive mutation produces one append-only AuditLog row; no UPDATE/DELETE code path exists | done | src/lib/audit/record-audit.ts; append-only now enforced at the DB level too via Postgres triggers (migration `20260720080000_invitations_and_audit_protection`), verified manually via psql |
| FOUND-008 | User invitation | Company Admin can invite a user by email into their tenant only | done | src/lib/auth/invitation.ts, src/app/api/admin/users/invite, src/app/accept-invitation; tests/invitation.test.ts (6 cases); manually verified full invite→accept→login flow via curl |
| FOUND-009 | Account suspension | Suspended user cannot authenticate; existing sessions revoked | done | src/app/api/admin/users/[id]/suspend + reactivate; tests/session.test.ts; manually verified full suspend→session-revoked→login-blocked→reactivate→login-works lifecycle via curl |
| FOUND-010 | Reauthentication for sensitive actions | Defined sensitive actions require a fresh credential check within N minutes | todo | design documented in SECURITY_AND_POPIA.md "Deferred design: reauthentication" (D-004); no Phase 1/2 action is sensitive enough yet to attach it to |
| FOUND-011 | Platform Administrator cross-tenant access is explicit, restricted, and audited | Every cross-tenant read/write requires the `platformTenant` permission and produces an audit row; zero permission on ordinary business resources | done | src/lib/repositories/platform-tenant-repository.ts (D-005); tests/platform-admin.test.ts (5 cases) |

## MD — Master data (Phase 2)
| ID | Requirement | Acceptance criteria | Status | Implementation |
|---|---|---|---|---|
| MD-001 | Company/branch/site/gate hierarchy | Site belongs to one tenant; gate belongs to one site | done | src/lib/repositories/{site,gate}-repository.ts; src/app/admin/organisation; tests/tenant-isolation-admin.test.ts (Phase 1 closure) |
| MD-002 | Driver register (full field set, brief 7.3) | All listed fields captured, validated server-side | done | prisma schema Driver; src/lib/validation/driver.ts (Zod, server-side); src/app/admin/drivers; tests/phase2-tenant-isolation.test.ts. No Department entity — plain string field (scope trim, see WORKLOG.md) |
| MD-003 | Vehicle master register (full field set, brief 7.4) | All listed fields captured, validated server-side | done | prisma schema Vehicle; src/lib/repositories/vehicle-repository.ts (server-side VIN/registration uniqueness, not just frontend); tests/vehicle-uniqueness.test.ts (5 cases) |
| MD-004 | Vehicle/driver document expiry tracking | Expiring documents surfaced on dashboard (brief 7.13) | done | ComplianceDocument + DocumentExpiryRule modeled and working (tests/document-expiry.test.ts); documents shown on driver/vehicle detail pages with isExpired flag; now also surfaced on the Phase 3 security dashboard (src/lib/repositories/security-dashboard-repository.ts, expiring-within-30-days + already-expired panel) — closed as part of Phase 3 rather than waiting for GOV-003 |
| MD-005 | Configurable tyre-position layout | Layout varies per vehicle category | done | TyrePositionConfig/TyrePositionDefinition/VehicleTyre; 5 system layouts seeded; src/app/admin/tyre-configs (custom layout creation) |
| MD-006 | Movement/delivery authorisation created pre-gate | Approval required before movement is usable at gate | done | src/lib/repositories/movement-repository.ts; src/app/admin/movements; state machine tests/movement-state-machine.test.ts (10 cases) + tests/movement-repository.test.ts (10 cases) |

## GATE — Gate operations (Phase 3)
| ID | Requirement | Acceptance criteria | Status | Implementation |
|---|---|---|---|---|
| GATE-001 | Gate-event state machine | Only valid transitions accepted; invalid transition rejected with reason | done | src/lib/gate-events/state-machine.ts (`isValidGateEventTransition`/`assertValidGateEventTransition`); tests/gate-event-state-machine.test.ts (134 cases — full 11x11 state matrix + documented-flow cases); every mutation goes through `gate-event-repository.ts`'s `transitionGateEvent()` |
| GATE-002 | Security dashboard | Shows events today, awaiting approval, open exceptions, GPS warnings | done | src/lib/repositories/security-dashboard-repository.ts (real DB aggregate queries, no static data); src/app/api/security-dashboard; src/app/admin/security-dashboard page — also closes MD-004's "no dedicated dashboard yet" gap via the expiring-documents panel |
| GATE-003 | Driver verification via provider abstraction | Mock provider + manual fallback both produce a recorded result | done | src/lib/facial-verification/{provider,mock-provider}.ts (Phase 2); wired into the gate flow this phase via `verifyIdentityForGateEvent`/`markIdentityVerifiedManually` in gate-event-repository.ts; tests/gate-event-repository.test.ts identity-verification cases. Production provider still blocked — INTEGRATIONS.md |
| GATE-004 | Movement shown at gate without re-entry | Officer sees approved delivery/cargo summary, does not retype it | done | src/app/api/gate/movements/search (read-only lookup, Phase 2); src/app/gate now also starts a GateEvent directly from a found movement (`POST /api/gate/gate-events`) without retyping any movement data; src/app/gate/events/[id] carries the same movement context through the whole guided flow |
| GATE-005 | Officer cannot approve own serious exception | Enforced server-side, not just hidden in UI | done | src/lib/repositories/gate-event-repository.ts `resolveException()` — hard rule (not tenant-configurable, see DECISIONS.md D-008), `raisedByUserId !== actorUserId` checked unconditionally whenever `requiresSupervisorApproval` is true; tests/gate-event-repository.test.ts self-approval cases (rejects same-user resolution, rejects resolution before escalation, allows a different user after escalation); manually verified via curl (officer 403 on own exception; different-role resolve succeeds) |
| GATE-006 | Configurable inspection templates | Template varies by vehicle type/version; not hardcoded to one component | done | prisma schema InspectionTemplate/InspectionItem (tenant-scoped, vehicle-category-aware, immutable-row versioning — see DECISIONS.md D-009); src/lib/repositories/inspection-template-repository.ts (`getActiveTemplateForCategory`, `createNewTemplateVersion`); src/app/api/admin/inspection-templates/*; tests/inspection-template-repository.test.ts (4 cases) |

## EVID — Evidence (Phase 4)
| ID | Requirement | Acceptance criteria | Status | Implementation |
|---|---|---|---|---|
| EVID-001 | Secure media upload | File type/size validated; stored with checksum | done | `src/lib/repositories/media-asset-repository.ts` (`uploadMediaAsset` — type/size validation, server-side SHA-256 checksum, never trusts a client-supplied one); `src/app/api/media/upload/route.ts` (`mediaAsset:CREATE` permission-checked); `tests/media-asset-repository.test.ts` |
| EVID-002 | No public media URLs | All access via short-lived signed URL, permission-checked | done | `mintSignedUrlForMediaAsset`/`serveRawMediaAsset` (media-asset-repository.ts); `lib/storage/signed-url.ts` (HMAC-signed, DB-free, unit-tested); `src/app/api/media/[id]/route.ts` + `src/app/api/media/raw/route.ts`; `tests/media-asset-repository.test.ts`, `tests/media-tenant-isolation.test.ts`, `tests/signed-url.test.ts`; manually verified via curl (see TESTING.md Phase 4 coverage) |
| EVID-003 | Upload retry without duplication | Idempotency key prevents duplicate evidence record | done | `MediaAsset` `@@unique([tenantId, idempotencyKey])`; `uploadMediaAsset` returns the existing row on a genuine retry, `IdempotencyKeyConflictError` (409) on a same-key-different-content retry; `tests/media-asset-repository.test.ts` "upload retry without duplication" describe block (3 cases); manually verified via curl + psql row-count check |
| EVID-004 | Guided walk-around capture | Covers exterior, lights, tyres, dashboard, odometer, fuel, licence disc, registration | done | The Phase 3 `InspectionTemplate`/`InspectionItem` engine already covers these sections (`EXTERIOR_CONDITION`, `LIGHTS`, `TYRES_WHEELS`, `OPERATIONAL_INFO`, `VEHICLE_IDENTITY` — seeded default template, prisma/seed.ts); Phase 4 adds the real evidence-capture affordance per item — `src/app/gate/events/[id]/page.tsx` file input → `POST /api/media/upload` → `evidenceMediaAssetId` passed into `recordInspectionResult` |

## RECON — Reconciliation (Phase 5)
| ID | Requirement | Acceptance criteria | Status |
|---|---|---|---|
| RECON-001 | Departure vs return comparison | Uses correct paired departure event, not most-recent-by-vehicle | todo |
| RECON-002 | Discrepancy record + resolution workflow | Discrepancy is reviewed, not auto-accusatory; has reviewer/status/evidence | todo |

## GOV — Governance (Phase 6)
| ID | Requirement | Acceptance criteria | Status |
|---|---|---|---|
| GOV-001 | Risk register (categories, owners, likelihood/impact, rating) | Matches brief 7.12 field list | todo |
| GOV-002 | Control register + control testing | Preventive/detective, owner, frequency, evidence, effectiveness, findings | todo |
| GOV-003 | Executive dashboard | Read-only, real DB-backed, no static mock values | todo |

## Roles → permission matrix
To be populated in `docs/modules/permissions.md` once `Permission` seed data is defined (Phase 1) — kept
out of this file to avoid duplicated, driftable data.

## Unresolved questions
1. Facial-verification vendor — blocked (INTEGRATIONS.md).
2. Telematics vendor — blocked (INTEGRATIONS.md).
3. Production hosting target — deferred to Phase 7.
4. Retention granularity (single tenant-wide `retentionDays` vs per-category) — flagged in
   SECURITY_AND_POPIA.md for legal review; current schema only supports the simpler single value.

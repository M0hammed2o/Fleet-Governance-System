# Tracker provider requirements and onboarding

Status: provider-neutral engineering package complete; every provider-specific fact remains `UNKNOWN` or `NOT_PROVIDED`.

No provider documentation, sandbox, credentials or customer authorization was used in Phase 15A. The local simulator is not a fake vendor adapter and proves no vendor capability.

## Internal contract: known facts

| Area | Genbridge contract requirement | Required for first activation | Provider-dependent evidence still needed |
|---|---|---:|---|
| Connection | Tenant ID, connection ID, provider ID, customer-authorization reference and credential version | Yes | Official authorization/account hierarchy and credential lifecycle |
| Capability discovery | Adapter declares supported capabilities; unsupported calls fail explicitly | Yes | Exact supported fields/endpoints and plan entitlements |
| Position | Asset ID, latitude/longitude, provider event time, last communication, online, accuracy when present | Yes | Field semantics, coordinate system, accuracy/null rules |
| Motion | Ignition, moving, speed, heading and odometer normalize to boolean, km/h, degrees and km | Ignition/speed/heading/odometer required where available; null is honest | Units, precision, reset/rollback rules, sampling behaviour |
| Optional telemetry | Fuel, driver reference and diagnostics | No | Availability, units, vehicle/device dependencies and confidence |
| History | Paginated events with stable cursor and deterministic provider event ID/idempotency key | Location history required; trips/stops optional | History window, ordering, corrections and pagination contract |
| Geofence/events | Normalized trip, stop, idling, geofence, driving, tamper and power types | Optional | Event taxonomy, geometry ownership and entry/exit semantics |
| Polling | Bounded page size, persistent checkpoint, timeout, at most three retries and backoff | One of polling/webhook required | Rate limits, checkpoint expiry and incremental-query rules |
| Webhooks | Raw-body verification, fail-closed signature boundary and replay prevention | One of polling/webhook required | Official signing/canonicalization, timestamp tolerance and retry policy |
| Errors | Authentication, authorization, rate limit, timeout, unavailable, invalid response, revoked, unsupported | Yes | Official status/error mapping and `Retry-After` semantics |
| Provenance | Source, collection method, event/receipt/normalization times, freshness, accuracy, mapping and processing/correction state | Yes | Provider field lineage and stated limitations |
| Mapping | Effective-dated tenant/vehicle/asset mapping; one active assignment; corrections preserve history | Yes | Provider asset stability, reassignment and customer-authorization process |
| Isolation | Tenant-scoped repositories plus database tenant/vehicle/actor constraints | Yes | Provider-side customer/account isolation evidence |
| Audit/logging | Mapping changes and failures audited; logs use safe correlation/outcome metadata, not credentials or raw asset IDs | Yes | Provider audit/export facilities and support-access rules |
| Revocation | Credential revocation disables reads and clears checkpoints | Yes | Revocation latency, token invalidation and offboarding process |
| Retention/deletion | Genbridge policy/holds apply; provider deletion and backup propagation remain external | Yes before real data | Retention schedule, deletion SLA, backups and legal-hold support |

Genbridge stores timestamps as UTC instants and renders tenant-local time using the tenant IANA timezone. Provider timezone assumptions, timestamp offsets, precision and clock-skew guarantees are unknown until documented. Missing, stale, inaccurate or unmapped data is a data-availability condition and never proof of misconduct.

## Capability gate

Minimum: authenticated health/connection state; tenant-authorized asset list; current position; stable event/asset identifiers; valid timestamps; location history; ignition/motion where the provider supplies it; bounded pagination/rate limits; polling or signed webhooks; revocation; customer offboarding/deletion evidence. Optional: trips, stops/idling, provider geofences, driving/tamper/power events, fuel, driver identification and diagnostics.

An unavailable optional capability must be declared unsupported. It must not be approximated, silently defaulted or marketed as present.

## Technical questionnaire and required evidence

Provider responses must cite current official documents and version/date. Attachments should be stored only in an approved private procurement/security location, not this repository.

1. Identify the legal entity, product/API name, versioning and deprecation policy.
2. Supply official API and webhook documents, schemas, changelog and sandbox terms.
3. Explain customer authorization, account hierarchy, asset visibility and delegated/revoked access.
4. Specify authentication, credential scopes, expiry, rotation, revocation and IP/network controls.
5. Describe sandbox isolation, synthetic assets, quotas, reset, support and production differences.
6. List every location/status/history field with type, nullability, unit, precision, timestamp meaning and timezone.
7. Define online/offline, ignition, moving, accuracy, speed, heading, odometer, fuel and driver-reference semantics.
8. Define asset/device ID stability, installation, reassignment, replacement, duplicate and retired-device behaviour.
9. Document pagination, maximum page/window, cursor expiry, event ordering, late events and corrections.
10. Document rate-limit scopes, headers, burst/sustained limits, `Retry-After` and fair-use restrictions.
11. For polling, document incremental filters, checkpoint semantics, recommended cadence and backfill limits.
12. For webhooks, document signature algorithm/canonicalization, secret rotation, timestamp window, event IDs, retry schedule, replay guidance and source-network assumptions.
13. Define outage/error codes, partial-response behaviour, maintenance notices, status page, SLA and escalation.
14. State data controller/operator roles, ownership, permitted uses, POPIA terms, subprocessors and cross-border locations.
15. State live/history/log/backup retention, deletion/export workflow, propagation SLA, holds and offboarding evidence.
16. State encryption, tenant segregation, support/admin access, audit logs, vulnerability management and incident notification.
17. State pricing, minimum term, quotas/overages, support levels, certification and change/termination costs.
18. Provide a non-production technical contact and security/privacy/commercial escalation contacts through approved channels.

## Onboarding stages and evidence

1. Business records customer need, existing tracker ownership and authorized representative.
2. Procurement/legal/privacy/security review official evidence; unresolved answers remain blocking.
3. Technical owner maps verified fields to the neutral contract without changing shared semantics for one vendor.
4. Provider provisions an isolated sandbox only after approval; credentials enter an approved secret manager, never Git/logs.
5. Adapter implements capability discovery, bounded HTTP client, normalization, signature/replay handling, polling checkpoints and safe disablement.
6. The reusable conformance suite passes, supplemented by provider-specific tests derived only from official documents.
7. Mapping is proven with synthetic sandbox assets; cross-tenant, reassignment, duplicate, revocation and quarantine tests pass.
8. Security performs SSRF/egress, signature, replay, poisoning, timestamp/unit, rate-limit, log and secret review.
9. Legal/privacy confirms authorization, notices/lawful basis, DPA, subprocessors, cross-border, retention and deletion.
10. A time-boxed staging proof runs synthetic/provider-sandbox data only. Human UAT does not imply production approval.
11. Named technical, business and security owners approve activation; rollback disables the adapter and preserves evidence/history.

## Conformance activation rule

Run `npm run tracker:conformance` locally against the synthetic fixture. A future adapter must supply the same fixture shape and pass authentication, capability, mapping, pagination, normalized event/provenance, freshness, retry/backoff, webhook, polling, revocation, isolation and safe-log checks. Provider-specific tests must additionally cover its documented signature, unit, timestamp, pagination, rate-limit, correction and outage behaviours. No adapter may be selected merely because the simulator passes.

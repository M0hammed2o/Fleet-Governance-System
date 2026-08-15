# Facial Verification Architecture

## Status and boundary

Phase 17A supports one-to-one verification only: the live presentation is compared with the approved reference for the driver already assigned to the gate event. It does not search across drivers and must never be extended into unrestricted one-to-many surveillance without a new approved purpose, legal assessment, architecture decision, and access model.

The repository contains a local browser/on-device engineering path that computes a descriptor, performs a guided facial-liveness challenge, encrypts the reference template with AES-256-GCM, and compares one template. This is genuine application code, but it is not an approved, calibrated, bias-tested, physical-device-verified production biometric service. The Phase 17A deterministic provider is separate and always returns `SYNTHETIC BIOMETRIC TEST — NOT REAL FACIAL VERIFICATION`; it consumes no face or biometric template.

Server health is provider availability. Facial liveness is evidence that a presentation satisfied a defined active challenge. They are never interchangeable.

## Provider-neutral lifecycle

1. An authorized administrator selects an existing tenant-scoped driver and confirms the identity and purpose.
2. The system displays the biometric notice, purpose, retention/deletion information, and alternatives. Consent or an approved alternative lawful authority plus its decision reference is recorded.
3. Three to five guided captures undergo type, size, face-count, lighting, blur, obstruction, scale, and consistency checks. Gate evidence and uploaded documents are never silently reused.
4. A provider creates an opaque template. Raw frames are discarded; only encrypted template material, safe quality metadata, provider provenance, notice version, authority, and an increasing version are retained privately.
5. Re-enrolment explicitly revokes the former active version. The database permits at most one active template per driver.
6. At the gate, the assigned driver is shown before the guard deliberately starts capture. The provider receives only that driver's reference and returns `VERIFIED`, `NOT_VERIFIED`, `LIVENESS_FAILED`, `INDETERMINATE`, `UNAVAILABLE`, or `NOT_ENROLLED`, with safe provenance.
7. The server applies the configured threshold, server timestamp, five-attempt window, tenant scope, and idempotency key. A result other than verified does not advance the event and does not accuse a person.
8. Permitted fallback requires driver-document inspection, the existing driver record, a mandatory reason, a different approving manager, and an audit record. Unavailable is not a mismatch; override is never silent.
9. Audit history stores result, safe error code, provider/model/policy/template versions, threshold, confidence where safe, liveness decision, gate/device label, actor, and synthetic marker. Raw images and template bytes are excluded.
10. Revocation immediately prevents further matching. Expiry requires re-enrolment. Driver offboarding revokes active enrolment and starts the approved deletion workflow.
11. Deletion uses a request, independent approval, 30-day recovery window, and completion that nulls ciphertext, IV, tag, and key identifier while preserving minimal non-biometric chronology.

## Decision and failure policy

Thresholds are tenant policy values only after approval and performance testing. A score at the boundary follows the provider contract exactly; the simulator covers it deterministically. False acceptance is a security risk and false rejection is an operational/fairness risk. Neither can be declared acceptable without representative, lawfully sourced evaluation. Retry limits lead to lockout/escalation, not repeated coercive capture.

Timeout, outage, rate limiting, malformed provider output, replay/photo/video signals, compromised or rooted device concerns, deleted/revoked/expired enrolment, and cross-tenant references fail closed. Provider replacement uses the neutral contracts, a compatibility test suite, migration/deletion plan, key review, DPA/POPIA review, and rollback rehearsal.

## Components

- `src/lib/facial-verification/contracts.ts`: provider contract and safe provenance.
- `src/lib/facial-verification/simulator.ts`: deterministic, no-network, test-only provider.
- `src/lib/repositories/facial-enrolment-repository.ts`: versioned encrypted enrolment and revocation.
- `src/lib/repositories/biometric-deletion-repository.ts`: dual-control deletion.
- `src/lib/repositories/gate-event-repository.ts`: one-to-one attempt, rate limit, idempotency, audit, and fallback enforcement.
- `src/lib/operations/facial-verification-readiness.ts`: production activation guard.

## Explicit limitations

A compromised endpoint can falsify client-side capture signals; server authorization and audit reduce but do not remove that risk. No vendor accuracy, demographic performance, presentation-attack detection, or physical-device result is claimed. Bias/performance evaluation, data-subject request handling, incident response exercises, retention approval, customer authority, and provider exit/deletion proof remain required before production.

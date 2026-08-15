# Facial Verification Security and POPIA

Biometric processing is special personal information and high impact. Phase 17A authorizes synthetic internal rehearsal only; it is not a final POPIA decision or production authorization.

## Implemented safeguards

- One-to-one, purpose-bound comparison; no unrestricted identification search.
- Tenant-scoped authorization on enrolment, status, attempt, revocation, and deletion routes.
- Explicit notice confirmation and recorded `CONSENT` or `APPROVED_ALTERNATIVE` authority; the latter requires a non-sensitive approval reference.
- AES-256-GCM template encryption with keys supplied outside the database; no raw image persistence or ordinary-report exposure.
- Private storage boundary, safe audit fields, redacted provider errors, versioned policies/templates, server timestamps, idempotency, rate limiting, separation of duties, and material-erasing deletion.
- Production and staging simulator refusal except explicit isolated staging test-only approval. Production activation requires every readiness item.

## Decisions still required

The Information Officer and legal/privacy owner must approve the purpose, lawful basis per affected group, necessity/proportionality, driver notice and alternative, customer controller/operator allocation, prior authorization need, cross-border processing, retention period, data-subject access/correction/objection/deletion process, incident notification, provider DPA, sub-processors, deletion proof, performance/bias criteria, and whether any workplace or collective-consultation obligation applies.

Consent must be freely given and withdrawable where relied upon. Operational pressure at a gate may make consent inappropriate; an alternative lawful authority cannot be invented by the application team. A refusal or failed match must have a fair manual route and must not itself trigger discipline, fraud accusations, blacklisting, or automated adverse action.

## Threats and controls

Replay/photo/video presentations, multiple/no faces, tampered clients, stolen sessions, cross-tenant identifiers, enumeration, duplicated requests, provider outage, malicious error text, leaked raw media, key compromise, excessive retention, and self-approved overrides are covered by explicit outcomes, server-side tenant and state checks, liveness signals, bounded retries, safe provenance, private evidence, encryption, dual control, and fail-closed guards. Physical-device compromise and sophisticated presentation attacks remain residual risks pending an approved provider/model and device assurance.

## Data-subject and incident procedure

Route requests to the named privacy owner; verify identity without collecting unnecessary new biometrics; locate records by tenant and driver; export only authorized safe metadata; place holds where lawfully required; revoke immediately when appropriate; execute approved deletion after the recovery window; and record chronology without retaining erased material. For suspected exposure, disable activation, preserve non-biometric logs, rotate affected keys, scope tenants/templates, notify the incident and Information Officer owners, assess regulatory/customer notification, and obtain provider deletion evidence. Never place raw faces or template bytes in tickets, email, chat, logs, screenshots, or reports.

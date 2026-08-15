# Facial Verification Operations Guide

For the internal pilot, set `PILOT_MODE=true` only in an approved local environment. Use the synthetic scenario buttons and confirm the exact synthetic disclosure. Do not capture a real face. If verification is unavailable, inspect the driver's synthetic document and existing record, enter a reason, request manager approval, and have a different manager approve before the guard continues.

Monitor safe result counts, repeated attempts, provider availability, lockouts, manual fallback volume, overrides, template expiry/revocation, pending deletion, and audit chronology. Do not expose confidence scores to guards as proof or place raw provider responses in logs.

On provider outage, show unavailable (not failed), stop automated retries at policy bounds, use the approved manual route, and escalate abnormal volume. On suspected compromise, disable facial activation, revoke affected enrolments/sessions, preserve non-biometric evidence, protect/rotate keys, invoke the incident procedure, and do not delete evidence under a lawful hold. On offboarding, revoke immediately and open the approved deletion workflow.

Run `npm run facial:readiness` before any activation attempt. A single blocked item means activation remains disabled. Provider replacement requires contract conformance, security/privacy review, representative performance and bias evaluation, physical-device/human UAT, rollback, and deletion/export verification for the outgoing provider.

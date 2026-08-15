# Facial Verification Testing

The deterministic simulator covers success, non-match, indeterminate, poor lighting, blur, no/multiple/small/obscured face, unsupported/oversized artifact, photo/video replay, liveness failure, timeout, outage, rate limiting, malformed output, duplicate, revoked/expired enrolment, cross-tenant reference, deleted driver, threshold boundary, and manual fallback. It is no-network and non-biometric.

Run focused checks with:

```powershell
npx vitest run tests/facial-verification-contracts.test.ts tests/facial-enrolment-repository.test.ts tests/facial-verification-attempt.test.ts tests/biometric-lifecycle.test.ts tests/facial-verification.test.ts
npm run facial:readiness
npm run pilot:rehearsal
```

The readiness command is expected to exit non-zero until all production approvals exist. Security coverage must include permission denial, tenant isolation, raw-media protection, log redaction, versioning, revocation/deletion, idempotency, rate limit, replay/liveness/provider failures, threshold boundary, fallback authorization/reason/self-approval, deleted driver/session/deep link, production and staging simulator refusal, exact synthetic provenance, evidence validation, and tracker/tenant regressions.

Human and physical-device execution remain separate. Record device manufacturer/model, Android version, SHA-256 of the device serial (never the raw serial), APK SHA-256, time, tester, permission-denial/recovery, camera behavior, rotation/large text/touch targets, offline behavior, session restoration, results, and defect references. Do not convert automated coverage into a human result.

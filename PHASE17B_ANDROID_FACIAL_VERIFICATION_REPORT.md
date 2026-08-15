# Phase 17B Android synthetic facial-verification report

Date: 2026-08-15

Scope: local development and synthetic testing only

Production facial verification: disabled

## Investigation conclusion

The Phase 17A and Phase 16B APKs were byte-for-byte identical because Phase 17A changed the web/backend facial-verification foundation but did not change or resynchronize the Android Security Guard bundle. The pre-Phase-17 mobile source and synchronized asset exposed only one generic `Run synthetic identity verification` action with a `synthetic:mobile-*` reference. It did not expose enrolment status, outcome selection, liveness/provider/not-enrolled states, camera readiness, controlled manual fallback, manager approval, attempt budget, or audit confirmation. Backend and desktop implementation did not imply mobile support.

## Implemented Android workflow

The guard event now provides:

- active/not-enrolled status and test-template version;
- the exact persistent warning `SYNTHETIC BIOMETRIC TEST — NOT REAL FACIAL VERIFICATION`;
- Android camera permission/readiness and an accessible synthetic alignment surface that never calls photo capture and never creates image, video, face or biometric bytes;
- explicit verified, non-match, liveness-failed, indeterminate, provider-unavailable and provider-rate-limited simulator outcomes;
- server attempt budget, rolling-window feedback and disconnected fail-closed controls;
- mandatory-reason manual fallback request, pending/approved/denied state and separate officer application;
- manager approval/denial with hard self-approval prevention;
- server-confirmed audit chronology.

The mobile API reuses bearer sessions, canonical permissions, tenant scoping and idempotency receipts. Synthetic execution is rejected in production and remains subject to the existing isolated test-only simulator guard. An approved fallback can advance identity only when its tenant, driver and related gate event all match. No fallback decision clears a gate automatically.

## Verification evidence

- root and mobile TypeScript: passed;
- root and mobile ESLint: passed;
- focused mobile Vitest: 7 files / 21 tests passed;
- rendered Capacitor workflow: 10/10 Chromium tests passed across outcome, fallback, accessibility, responsive and disconnected paths;
- Capacitor Android synchronization: passed;
- Android configuration validation: passed;
- Android JVM tests: passed, including synchronized-bundle disclosure/control checks;
- Android `lintDebug`: passed;
- Android `assembleDebug`: passed.

Preliminary rebuilt artifact (the complete final gate rebuilds the same path):

- path: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`
- size: 7,247,283 bytes
- SHA-256: `D6DBD981ABF1D6E53C95C7E60859026B6F7BAC0EBDE0640255F0759B0706546B`
- Phase 16B/17A SHA-256: `CE854F41E9AEA2753F1201383312B931D4F4139AE5B5D9DE3D8DBD14F8C5F4A9`
- hashes differ: yes

No physical-device execution is claimed. Follow `ANDROID_DEVICE_TESTING_GUIDE.md` using only the fictional pilot identities. Do not capture a real face.

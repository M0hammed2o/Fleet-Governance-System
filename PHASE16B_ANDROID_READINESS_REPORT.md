# Phase 16B Android readiness report

## Executive decision

**Local Android project/build readiness: GO. Android device/release/store readiness: NO-GO.**

Phase 16B converts the Phase 16A mobile web foundation into a committed, hardened Capacitor Android project and produces a reproducible local debug APK. It does not authorize or claim a production application, signed release, installed native workflow pass, staging deployment or store submission.

## Delivered

- committed Gradle/Android project using application ID `za.co.genbridge.fleet` for local work only;
- display name `Genbridge Fleet Governance` and constrained `genbridgefleet://open/...` deep links;
- debug-only local HTTP/mixed-content path and fail-closed staging/production HTTPS rules;
- exact native CORS guidance for WebView origin `https://localhost`;
- backups off, scoped FileProvider, release screenshot/WebView/logging/cleartext controls;
- minimal Internet/network-state/camera permission set with no GPS, microphone or storage permission;
- Android Keystore session boundary and online-only connectivity retained;
- static, Vitest, Gradle JVM, lint and compiled instrumentation contracts;
- debug APK with recorded path/size/hash and Git-ignore proof;
- setup, architecture, device testing, security and execution runbooks.

## Verification summary

Mobile typecheck/lint passed; 6 focused files / 17 tests passed; Android JVM tests passed 3/3; Android lint passed with zero errors; debug APK assembly passed. The release guard correctly refused the local/provisional config. API 36/build-tools 36.0.0 were installed from the official SDK manager.

The available Pixel 7/API 35 AVD booted and Android services became ready, but ADB lost it during every streamed and non-streaming APK installation attempt. The compiled instrumentation test never executed, no physical device was present, and no native UI result is claimed. See `ANDROID_TEST_EXECUTION_REPORT.md`.

The first complete candidate gate also exposed and fixed a container-only TypeScript boundary between Vite
`ImportMetaEnv` and the explicit runtime environment record. That failed candidate is not a release gate
pass; consecutive verification restarts from the corrected commit.

## Release blockers

1. Repair/recreate the emulator and complete connected tests plus direct launch/deep-link/native workflow smoke.
2. Complete representative phone/tablet and physical-device testing, including Android back, keyboard, large text and TalkBack.
3. Device-verify Keystore persistence/revocation, network loss/recovery and camera/gallery/file-picker permission paths.
4. Implement and prove automatic EXIF/location stripping before any real evidence use.
5. Approve the final Android application ID, versioning, owner and signing custody; rerun release merged-manifest/AAB/security checks.
6. Approve HTTPS API/auth/redirect configuration and exact native CORS; production password auth remains disabled.
7. Complete privacy notice/lawful basis/retention, managed-device/BYOD, device-loss, screenshot/support, Google Play Data safety/content/reviewer and independent security decisions.
8. Satisfy all existing Phase 13–15 infrastructure/provider, backup/monitoring, human UAT and business-approval gates.

## Recommended next action

Recreate the AVD with a known-good hypervisor/system image or attach an approved Android test device. Run the synthetic device guide against the current debug APK, fix any native defects, and repeat the complete repository/Android gate twice on one immutable commit. Only after that evidence should owners approve a final package ID and managed signing work.

No deployment, publication, paid service, developer-account mutation, external message, real credential, customer/person/vehicle/location data or biometric was used. No signing key, generated secret, APK, local SDK path, screenshot or device log is committed.

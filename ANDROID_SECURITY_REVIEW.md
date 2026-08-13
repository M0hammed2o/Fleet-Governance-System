# Android security review

## Result

The committed Android source is suitable for continued local synthetic debug testing. It is not approved for staging, production, signing or store distribution. No unresolved Critical source defect was found. Native install/runtime assessment, automatic EXIF stripping, final identity/signing and independent security/privacy review remain release blockers.

## Control review

| Area | Implemented evidence | Residual requirement |
|---|---|---|
| Identity | provisional ID constrained to local; exact display name/scheme | approve final ID, ownership and versioning |
| Exported components | only launcher/deep-link activity intentionally exported; FileProvider/startup provider not exported; ProfileInstaller receiver protected by system `DUMP` permission | re-audit merged release manifest after final-ID sync |
| Deep links | manifest scheme+host and independent JS origin/path validation; server capability authorization | physical-device cold/warm-link tests |
| Transport | release cleartext false; local cleartext/mixed content debug source/config only; HTTPS required non-local | approve HTTPS endpoints and exact native CORS |
| WebView/bridge | production inspection disabled, production logging none, release build guard | independent bridge/WebView penetration review |
| Storage/session | Android Keystore AES-GCM plugin, backup/extraction disabled, 401/logout clearing | device restart/update/revocation/root tests |
| File paths | app-specific Pictures and cache only; URI grants scoped by FileProvider | camera/gallery/file-picker device tests |
| Permissions | Internet, network state from plugin, camera; optional camera feature | verify merged release permissions; no GPS/mic/storage |
| Screenshots/logs | release `FLAG_SECURE`; debug screenshots/logs limited to synthetic testing | owner decision for managed-device/BYOD and support evidence |
| Release build | Gradle rejects provisional ID, mixed content and logging; release manifest forces non-debuggable/cleartext false | final ID, managed signing, release merge/AAB scan |

The debug merged manifest contains the expected debuggable/cleartext test overrides. It also contains AndroidX ProfileInstaller's exported receiver, but that receiver requires the signature/system `android.permission.DUMP`; the app's own FileProvider and startup provider are non-exported. No location, audio, legacy storage or all-files permission is declared.

## Threat boundaries

Client code cannot replace server authorization, tenant scope, separation of duties, audit chronology, evidence ownership or idempotency. Deep-link targets, role labels, local UI state and device time are untrusted. Tokens must never enter logs, screenshots, URLs or browser persistence. The app has no offline mutation queue and does not infer success after network ambiguity.

Release builds block screenshots and WebView inspection, but cannot defeat a rooted/compromised device, malicious accessibility service, keyboard, overlay, screen camera or physical access to an unlocked device. A managed-device/BYOD policy, device-loss revocation process and independent mobile security test are required.

## Privacy and evidence

Camera use is explicit and optional; there is no microphone, GPS, background capture or silent upload. Evidence remains private and tenant-bound server-side. Automatic EXIF/location metadata stripping was not implemented or device-verified. That gap is a release blocker for real media: until fixed, only controlled synthetic images with known metadata may be used.

No crash/analytics SDK, push provider, Google Services file or external notification transport is configured. Adding any requires privacy, retention, egress, credential and tenant-isolation review.

## Findings disposition

- Fixed: arbitrary native URL origin accepted by the JavaScript deep-link listener.
- Fixed: default Android backups enabled and FileProvider external-storage root exposure.
- Fixed: no source-set separation for local cleartext and no production release-config guard.
- Fixed: generic placeholder Android tests and no application identity/permission contract.
- Open environment blocker: AVD goes offline on APK installation; native runtime tests did not execute.
- Open release blocker: automatic EXIF/location stripping and physical evidence workflows are unverified.
- Open manual blockers: final ID, signing custody, API/CORS/auth, privacy/store declarations, device policy and explicit release authority.

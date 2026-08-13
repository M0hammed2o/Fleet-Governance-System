# Android test execution report

## Execution context

Date: 2026-08-13. Host: Windows 10, local-only synthetic engineering. Baseline: Phase 16A closeout `e19a4e9`. Android Studio/SDK were local; no remote, deployment, signing, publication, provider, real credential or real data was used.

## Passed evidence

- Capacitor generated and synced `apps/mobile/android` with four native plugins.
- Mobile TypeScript and ESLint passed.
- Android static validator passed identity, deep link, permissions, backup, cleartext/release and FileProvider rules.
- Focused mobile/native Vitest: 6 files / 17 tests passed.
- Gradle `testDebugUnitTest`: 3 Android JVM contract tests passed with zero failures/errors.
- Gradle `lintDebug`: passed with zero errors. Remaining warnings are generated/template/upstream resource/version observations plus the intentional debug configuration; none changes release policy.
- Gradle `assembleDebug`: passed against compile/target SDK 36 on JDK 24.
- The release guard correctly rejected release preparation because the synced config uses the provisional local-only ID.

The debug APK is:

```text
apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
7,158,504 bytes
SHA-256 9EE31C9250BD583B061597B57ABFFCD971FF868E87EA548CD72D4981143ED3E1
```

It is a debug artifact, not a distributable release, and Git ignores it.

## Native execution attempt

The existing `PropertyVault_Pixel7_API35` AVD cold-booted as Android 15/API 35 at 1080×2400/420 dpi. ADB reported `device`, the boot animation stopped and the package service became available. The app instrumentation APK compiled.

Connected execution did not pass. During Gradle install the AVD became `offline`; direct `adb install -r -t` failed the same way, and `adb install --no-streaming` timed out before the device again became `offline`. The AVD was restarted with lower memory/CPU and without snapshots, with the same outcome. No physical device was attached.

Therefore the following are **not executed/not claimed**: installed app launch, native UI hierarchy, camera/gallery/file picker, Keystore persistence, background/force-stop/reboot, network handover, Android back, deep-link launch, TalkBack/large text, phone/tablet native layout and the compiled instrumentation assertion.

## Defects found during build enablement

The implementation cycle corrected Windows wrapper invocation with a spaced workspace path, lazy AGP release-task registration, AGP's absent generated `BuildConfig`, Java 8 test compatibility and the instrumentation permission constant. Earlier failed attempts are not counted as passes. The final JVM/lint/debug-build result is green; connected execution remains blocked by the AVD transport.

## Required rerun

Repair/recreate the AVD or use an approved physical test device, then follow `ANDROID_DEVICE_TESTING_GUIDE.md`. A passing `connectedDebugAndroidTest`, direct launch/deep-link smoke and synthetic guard/owner/accessibility/evidence matrix must be attached to the same immutable candidate before Android device readiness can be claimed.

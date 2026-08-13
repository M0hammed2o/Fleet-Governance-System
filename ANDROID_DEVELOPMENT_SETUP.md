# Android development setup

## Verified Windows host

The Phase 16B host has Android Studio, Android SDK platforms 34 and 36, build-tools 34.0.0/35.0.0/36.0.0, platform-tools/ADB 37.0.1, one Pixel 7 API 35 AVD, Oracle JDK 24 and Android Studio JBR 25. Gradle 8.14.3 successfully ran with the shell's JDK 24. `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `JAVA_HOME`, `adb` and `emulator` were not globally configured; repository scripts safely infer `%LOCALAPPDATA%\Android\Sdk` without writing `local.properties`.

The host exposes a hypervisor, but Windows firmware capability fields were inconsistent and the AVD repeatedly dropped offline during APK installation. Treat virtualization as not operationally ready until the device test in `ANDROID_DEVICE_TESTING_GUIDE.md` passes.

## One-time prerequisites

Install Android Studio and official SDK packages for platform/build-tools 36, platform-tools and an API 35+ system image. Use a Gradle-supported JDK. Do not install an arbitrary JDK/plugin or commit a machine path.

For the current PowerShell session, optional explicit variables are:

```powershell
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:PATH="$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:PATH"
```

If Gradle later rejects the default Java runtime, set `JAVA_HOME` to an approved compatible JDK for that shell only and rerun the checks. Do not add a user-specific JDK path to tracked Gradle files.

## Local debug workflow

Start the existing API with synthetic local data and exact native CORS:

```powershell
$env:MOBILE_TRUSTED_ORIGINS='https://localhost'
npm run dev
```

In a second shell, build emulator configuration:

```powershell
$env:VITE_APP_ENV='local'
$env:VITE_API_BASE_URL='http://10.0.2.2:3000'
$env:MOBILE_NATIVE_ENV='local'
$env:MOBILE_APP_ID='za.co.genbridge.fleet'
npm run android:sync
npm run android:config:validate
npm run android:test
npm run android:lint
npm run android:build:debug
```

For a physical device, prefer `adb reverse tcp:3000 tcp:3000` and build with `VITE_API_BASE_URL=http://127.0.0.1:3000`. Re-run `android:sync` whenever web code, Vite environment or Capacitor plugins/config change.

The debug APK is generated at `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`. It is unsigned for distribution, uses the Android debug key only, and is ignored. Never copy it into a tracked folder.

## Android Studio

Open `apps/mobile/android` after a successful `npm run android:sync`. Let Studio use the installed SDK and a Gradle-compatible JDK. Do not accept automatic identity, signing, Firebase/Google Services or release upgrades without review. `google-services.json`, JKS/keystore files, `local.properties`, captures and IDE caches are ignored.

## Non-local configuration

Staging and production require an approved HTTPS API URL, final application ID and exact native CORS origin. The provisional ID is rejected, mixed content and logging are disabled, and release preparation fails while local config is synced. A production-mode sync/build is intentionally impossible until the identity owner supplies the approved value; no placeholder should be used to bypass this control.

## Common diagnostics

```powershell
java -version
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices -l
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -list-avds
node scripts/run-android-gradle.mjs :app:tasks
git check-ignore -v apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

An `offline` device is not test evidence. Cold boot the AVD, confirm `adb get-state` is `device` and `adb shell service check package` is exactly `Service package: found`, then retry once. Escalate persistent install-time disconnects to host virtualization/AVD repair rather than weakening application controls.

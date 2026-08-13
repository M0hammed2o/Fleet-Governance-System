# Android device testing guide

## Test data and safety

Use only the fictional Phase 14 pilot tenant/accounts. Never capture a real person, vehicle, registration, document, location or biometric. Keep the API local or in an explicitly approved synthetic staging environment. Do not enable a provider, push channel, analytics/crash exporter or real notification delivery.

## Install and launch

Confirm the device is authorized and healthy:

```powershell
adb devices -l
adb shell service check package
adb install -r -t apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n za.co.genbridge.fleet/.MainActivity
```

For a USB device using the local API:

```powershell
adb reverse tcp:3000 tcp:3000
```

For the emulator use `10.0.2.2`; for USB reverse use `127.0.0.1`. Both are debug-only. Verify the API has exact `MOBILE_TRUSTED_ORIGINS=https://localhost`.

Run instrumentation after both APKs build:

```powershell
npm run android:sync
node scripts/run-android-gradle.mjs connectedDebugAndroidTest
```

## Native smoke sequence

1. Launch and confirm the full display name, synthetic warning, responsive sign-in and no WebView/network error.
2. Sign in as each approved synthetic persona: guard, owner/admin-equivalent and a denied role.
3. Background/resume, force-stop/relaunch and verify the Keystore session behavior; revoke server-side and verify the next request clears it.
4. Disable network. Confirm the persistent offline warning, stale/unavailable disclosure and refusal of critical mutations. Re-enable and confirm refresh without duplicate action.
5. Launch `adb shell am start -a android.intent.action.VIEW -d "genbridgefleet://open/guard"`. Verify an authorized guard lands on guard; an unauthorized persona is denied. Confirm another scheme/host does not resolve.
6. Exercise queue/search, movement detail/tracker provenance, departure, inspection, exception/escalation, denial/return/reconciliation, owner overview, approval denial/separation of duties and notification read state.
7. Capture/select a synthetic image and select a synthetic PDF. Verify explicit selection/removal, permission denial/retry, 25 MB/type rejection, upload progress/failure/retry and tenant-safe result. Inspect a source image with EXIF/location and confirm it is not used for release until automatic stripping is proven.
8. Sign out; verify token and transient gate selection are cleared. Repeat after app restart and device reboot.

## Form-factor and accessibility matrix

Test at least one small phone, a current representative phone and a 7–10 inch tablet in portrait/landscape. Repeat with Android font size and display size at large/maximum. Verify:

- safe-area/status/navigation bar clearance, no clipped fixed navigation and no horizontal overflow;
- software keyboard visibility, input focus, submit/error reachability and correct back-button behavior;
- 44 dp targets, visible focus, semantic labels, status text not conveyed by colour alone and reduced motion;
- TalkBack traversal/order, roles, field errors, live alerts, progress and deep-link destination announcement;
- camera/gallery/file-picker permission rationale and recovery after denial.

Browser Playwright coverage is supporting evidence only; it does not replace this native matrix.

## Evidence capture

Record device model, Android/API level, WebView version, app commit, APK SHA-256, API environment, persona, test IDs, result, time and tester. Store screenshots/logs only in approved ignored evidence storage and ensure they contain synthetic data. Useful diagnostics:

```powershell
adb shell dumpsys package za.co.genbridge.fleet
adb shell pm list permissions -g
adb logcat -c
adb logcat --pid=$(adb shell pidof -s za.co.genbridge.fleet)
adb shell uiautomator dump /sdcard/genbridge-ui.xml
```

Do not commit device logs, UI dumps or screenshots. Redact bearer tokens, emails, filenames and host addresses before sharing.

## Phase 16B host result

The API 35 Pixel 7 AVD booted and exposed Android services, but became `offline` whenever either streamed or non-streaming APK installation began. The app and test APKs compiled, but neither installation nor instrumentation/native UI execution completed. No physical device was attached. This guide therefore remains the required rerun procedure after the AVD/hypervisor is repaired.

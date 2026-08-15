# Pilot Device Setup Guide

1. On the Android device, open Settings, About phone, tap Build number seven times, then enable Developer options and USB debugging.
2. Connect by a trusted data cable, unlock the device, approve this computer's RSA prompt, and select the always-allow option only for this controlled laptop.
3. In PowerShell run `& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices -l`. The device must say `device`, not `offline` or `unauthorized`.
4. Hash the APK with `Get-FileHash -Algorithm SHA256 apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`, then install with `adb install -r -t <absolute-apk-path>`.
5. Start the local synthetic backend on the laptop. Bind only to the trusted test network, keep Windows firewall scope narrow, use the laptop's private LAN address rather than `localhost`, and configure the app's approved development API URL. Never expose the development server to the public internet.
6. Test login, camera grant/denial/retry, portrait/landscape, large text, touch targets, synthetic warnings, departure/return, disconnected mutation refusal, reconnect/reload, session restoration, and logout/revocation.
7. Record manufacturer/model, Android version, hashed serial, APK hash, tester/time and result. Export no photo, face, raw serial, token, customer record, coordinate, database, screenshot with personal data, or biometric material.

Observed on 2026-08-14: SDK ADB and emulator exist; no physical device was attached. `PropertyVault_Pixel7_API35` reached ADB briefly then remained offline and never reported boot completion, so no emulator install or smoke result is claimed.

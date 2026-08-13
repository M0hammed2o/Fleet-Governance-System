# Android native architecture

## Scope and identity

Phase 16B commits the Capacitor Android host under `apps/mobile/android` and keeps the Phase 16A React/Vite client and existing Next.js API as the only application and backend. The local debug identity is deliberately provisional:

- display name: `Genbridge Fleet Governance`
- local application ID and namespace: `za.co.genbridge.fleet`
- custom URL origin: `genbridgefleet://open/`
- minimum/compile/target SDK: 24/36/36

The application ID is authorized only for local Android development. `createCapacitorConfig()` rejects it outside `local`/`development`, and non-local generation requires an explicitly approved `MOBILE_APP_ID`. No final store identity, signing owner or version policy was inferred.

## Runtime composition

The APK contains the exported launcher/deep-link `MainActivity`, a non-exported scoped `FileProvider`, Capacitor's WebView bridge and four plugins: App, Camera, Network and Keystore-backed secure storage. The generated public bundle/config and every APK/AAB/build directory remain ignored; source manifests, Gradle wrapper/configuration, Java tests and resources are committed.

`MainActivity` disables WebView inspection and applies `FLAG_SECURE` whenever Android does not mark the build debuggable. Debug builds remain inspectable and screenshot-capable for synthetic testing. Release builds are additionally guarded by Gradle: any generated config with the provisional ID, mixed content or Capacitor logging causes release preparation to fail.

## Environment and network matrix

| Context | API URL | Native/WebView rule | API CORS origin |
|---|---|---|---|
| Browser simulation | `http://127.0.0.1:3000` | local only | browser same-origin behavior |
| Android emulator debug | `http://10.0.2.2:3000` | debug manifest/config only | exact `https://localhost` |
| Physical Android debug | `http://127.0.0.1:3000` with `adb reverse tcp:3000 tcp:3000` | debug only; preferred over broad LAN cleartext | exact `https://localhost` |
| Trusted Wi-Fi alternative | approved development HTTPS endpoint | no arbitrary RFC1918 HTTP allowlist | exact `https://localhost` |
| Staging | approved HTTPS URL, no local/placeholder host | mixed content off, logging off | exact approved native origin |
| Production | approved HTTPS URL and final app ID | release fail-closed controls | exact approved native origin |

`resolveMobileRuntimeConfig()` rejects credentials/fragments, non-HTTPS non-local URLs, local staging/production URLs and placeholder production hosts. The Android WebView origin is `https://localhost`; the API must include only that exact origin in `MOBILE_TRUSTED_ORIGINS` for this debug package. Wildcards and reflected origins are prohibited.

## Navigation and authorization

Android accepts only `VIEW` intents with scheme `genbridgefleet` and host `open`. JavaScript independently rejects other schemes, hosts, credentials, ports, fragments, empty paths and traversal. A valid example is `genbridgefleet://open/guard/events/<id>`. After parsing, the established capability-based router still denies areas the server bootstrap does not authorize; role labels and client routes never grant authority.

## Sessions, connectivity and evidence

Native session tokens use Android Keystore AES-GCM through `@aparajita/capacitor-secure-storage`; browser simulation remains memory-only. `allowBackup=false`, extraction exclusions and release screenshot blocking reduce token disclosure. Logout and HTTP 401 clear the local token; server revocation/expiry remains authoritative. Rooted devices, malicious keyboards/overlays and unlocked physical access remain outside the app's trust boundary.

The app is intentionally online-only. Network status changes stop disconnected mutations and refresh state on reconnection; there is no offline mutation queue, background sync or silent conflict replay.

Evidence capture is explicit. Android declares camera as optional hardware and requests `CAMERA` because the WebView capture input can invoke it. Photo/file selection requests no storage, location or microphone permission. The FileProvider exposes only app-specific `Pictures/` and cache paths. Client/server MIME, size, tenant and entity checks still apply. Automatic EXIF/location stripping, native cancellation/background continuation and physical camera/gallery/file-picker behavior remain release blockers until device-verified.

## Build and artifact boundary

`npm run android:sync` exports the web bundle and runs Capacitor sync. `npm run android:config:validate`, `npm run android:test`, `npm run android:lint` and `npm run android:build:debug` validate source policy, JVM contracts, Android lint and the debug APK. The Gradle wrapper uses AGP 8.13.0 and Gradle 8.14.3. No keystore, `local.properties`, generated bundle/config, APK, AAB, report, screenshot or device log belongs in Git.

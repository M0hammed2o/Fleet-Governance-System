# Mobile security and privacy

Status: Phase 16A local foundation, 2026-08-12. No production or real-data use is approved.

## Security boundary

The Next.js backend remains authoritative. The app never connects directly to PostgreSQL, private object
storage, a tracker, payment service, messaging service or push provider. Every mobile route validates a
strict opaque bearer token against the existing hashed, revocable `Session` table, evaluates active
user/tenant state and canonical permission data, scopes identifiers by tenant and delegates mutations to
the existing audited repositories. A role label in the bundle or a visible button is never authority.

Android/iOS tokens use the Keychain/Keystore-backed Capacitor secure-storage plugin. Browser simulation
uses process memory only. Tokens, tenant records, evidence and gate forms are not written to localStorage,
sessionStorage or SQLite. A 401 clears the local token; sign-out revokes the server session and clears it
locally. Twelve-hour server expiry is unchanged. Device compromise, unlocked screenshots, overlays,
malicious keyboards, rooted/jailbroken operating systems and physical access remain risks; no client-side
root detector can make such a device trustworthy.

Native CORS is exact-allowlist only through `MOBILE_TRUSTED_ORIGINS`. Preflight and mutation-origin checks
remain fail-closed when the approved Capacitor/app origin is absent. Production password sign-in also
fails closed unless `MOBILE_PASSWORD_AUTH_ENABLED=true`; future Google/Apple/OIDC configuration requires
approved credentials and redirect origins and was not invented here.

## Mutation, replay and audit controls

Critical JSON actions require an 8–200 character idempotency key. A tenant/user/key receipt binds the
operation and request digest; exact completed retries replay the stored safe response, changed reuse and
in-progress actions return 409. If authoritative work succeeds but receipt finalization fails, the receipt
is deliberately left in progress so a retry cannot run twice. Operators must reconcile those rare rows
against audit chronology before a forward repair. Repository audit actor and server timestamp remain the
source of truth. Movement approval continues to enforce separation of duties server-side.

## Evidence and data minimization

Evidence selection is explicit and a second action is required to upload. The client accepts synthetic
JPEG, PNG, WebP or PDF up to 25 MB, rejects empty/oversized/unsupported files and newline/null filename
injection, permits removal, and shows progress/failure. The server revalidates content and tenant/entity
ownership through the private media repository and returns metadata only—never a private storage URL.
The app does not request GPS and does not silently upload. Users must strip unwanted EXIF/location data;
automatic metadata sanitization and safe long-running native cancellation are not yet verified.

No real biometric identification or liveness was added. Synthetic pilot identity verification is
server-gated to non-production `PILOT_MODE=true` and the canonical permission. Device Face ID/fingerprint
could later unlock a local token but would not prove driver identity.

## Privacy and disclosure decisions still required

- MANUAL_CONFIRMATION_REQUIRED: lawful bases/notices for employee identity, vehicle, location, incident,
  investigation and evidence processing; Information Officer/PAIA ownership; DPA and cross-border terms.
- MANUAL_CONFIRMATION_REQUIRED: retention, device-loss response, screenshot policy, managed-device/BYOD
  position, support access, analytics/crash reporting, backup/offboarding and data-subject procedures.
- MANUAL_CONFIRMATION_REQUIRED: privacy policy URL, Google Play Data safety answers, Apple privacy labels,
  camera/photo wording and store review test-account handling.
- Push, email, SMS and messaging delivery are disabled. A later provider must use permission-minimized
  notification bodies, device-token lifecycle, revocation, consent and tenant isolation.

## Review result

Cross-tenant repositories, strict bearer parsing, expiry/revocation, exact origin allowlisting, role/deep-
link denial, insecure-storage absence, unsafe API URLs, replay/key conflict, offline mutations, evidence
validation, provider-ID omission and synthetic provenance have automated coverage. Phase 16A has no known
unresolved Critical or High security defect. Native penetration testing and an independent privacy/security
assessment remain mandatory before real customer data.

## Phase 16B Android review

Android source now disables app backup/data transfer, release screenshots, release cleartext, unconditional
WebView inspection and release Capacitor logging. Local cleartext/mixed content is isolated to debug and a
Gradle guard rejects release preparation with the provisional ID or local settings. The deep-link origin,
FileProvider paths, permissions and merged exported components were reviewed; only the launcher/deep-link
activity is app-exported, while AndroidX's exported ProfileInstaller receiver is protected by the system
`DUMP` permission.

The AVD could not retain an online ADB connection during APK installation, so Keystore persistence,
camera/file-picker behavior, screenshot enforcement, runtime permission prompts and native attack testing
remain unverified. Automatic EXIF/location stripping is an explicit release blocker for real evidence.
`ANDROID_SECURITY_REVIEW.md` is the current Android-specific disposition.

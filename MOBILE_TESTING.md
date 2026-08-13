# Mobile testing

Phase 16A uses the strongest credential-free local combination available on this Windows host: Vitest
unit/repository integration tests, Capacitor configuration validation, TypeScript, ESLint, a Vite release
bundle, Playwright rendering of that bundle, existing Next/backend regression coverage, clean migration
replay, isolated backup/restore and the non-root web container smoke test.

## Focused commands

```text
npm run pretest
npm run mobile:test
npm run mobile:typecheck
npm run mobile:lint
npm run mobile:config:validate
npm run mobile:export
npx playwright test e2e/mobile-priority-workflows.spec.ts
```

The focused suite contains 5 files / 13 tests for API URL/token/error behavior, memory/native-storage
boundaries, canonical capabilities, tenant-scoped queue/overview/notifications, strict bearer parsing,
deep-link policy, evidence validation, exact mobile origin/CORS policy, disconnected mutation prevention
and database idempotency. The four browser journeys cover guard departure/evidence, guard failure/
escalation/denial, owner dashboard/notification/approval and wrong-role/deep-link/connectivity/responsive
boundaries.

Rendered layouts are exercised at 360×640, 430×932, 844×390, 768×1024 and 1024×768. Assertions cover
44-point primary navigation targets, no horizontal document overflow, accessible field/button/navigation
names, non-colour status text, loading/empty/error alerts and a persistent disconnected warning. Browser
font scaling and keyboard/screen-reader semantics are covered by standards-based HTML and existing lint/
Playwright checks; they still require VoiceOver/TalkBack and native large-text human verification.

## Full local gate

`npm run mobile:rc` runs a fail-fast-equivalent recorded sequence over package integrity, 30 migrations,
empty replay, backup/restore, root/mobile TypeScript and ESLint, all Vitest tests, Next production build,
pilot invariants/imports/UAT, tracker conformance, mobile config/bundle, all web/mobile Playwright tests,
secret scan, low-level dependency audit, expected blocked staging/production checks, performance, Docker
non-root/liveness, documents and clean Git state. Run it twice from the same committed source.

## Honest platform coverage

No Android emulator, iOS simulator or physical device was used. No APK/AAB/IPA/Xcode archive was built.
Native project generation is intentionally blocked by the unapproved application identifiers. Windows
cannot run Xcode/iOS builds. Camera invocation, OS permission prompts, Keychain/Keystore persistence,
background/termination behavior, app/universal links, network handover and store packaging therefore
remain native-device test cases, not claimed passes.

## Phase 16B Android coverage

The historical Phase 16A paragraph above remains accurate for that candidate. Phase 16B subsequently added
the Android project and a debug APK. Current focused coverage is 6 Vitest files / 17 tests plus 3/3 Android
JVM contract tests. `npm run android:config:validate`, Gradle `testDebugUnitTest`, `lintDebug` (zero errors)
and `assembleDebug` pass.

The API 35 AVD booted and exposed Android services, and the instrumentation APK compiled, but the device
became offline during both Gradle/direct streamed install and direct non-streaming install. Consequently no
installed app, instrumentation, native UI/camera/Keystore/deep-link/accessibility result is claimed. See
`ANDROID_TEST_EXECUTION_REPORT.md` and rerun `ANDROID_DEVICE_TESTING_GUIDE.md` on a repaired AVD/device.

# Mobile release checklist

This checklist prepares a future release; it does not authorize one.

## Identity and ownership

- [ ] MANUAL_CONFIRMATION_REQUIRED: final Android application ID and iOS bundle ID.
- [ ] MANUAL_CONFIRMATION_REQUIRED: product owner, release owner, signing owner and support/privacy contacts.
- [ ] Display name `Genbridge Fleet Governance`, version policy and deep-link scheme approved.
- [ ] Apple/Google developer agreements, organisation accounts and access controls approved.
- [ ] Signing keys/certificates/profiles created only in approved secret systems; none committed.

## Configuration and providers

- [ ] HTTPS API origin, `MOBILE_TRUSTED_ORIGINS`, production auth/redirects and secret rotation approved.
- [ ] Production/staging readiness checks exit zero with named evidence; no mock/synthetic provider active.
- [ ] Push remains disabled or an approved provider passes security/privacy/device-token review.
- [ ] Monitoring/crash reporting, retention, support, device-loss and incident processes approved.
- [ ] Privacy policy, lawful basis/notices, DPA/cross-border, Play Data safety and Apple privacy labels signed.

## Native generation and validation

- [ ] Generate native folders only after setting the approved `MOBILE_APP_ID`; review generated manifests.
- [ ] Camera wording explains synthetic/approved evidence use; request no microphone or automatic GPS.
- [ ] Android: supported JDK/SDK/Gradle, release AAB, Keystore signing, emulator and representative devices.
- [ ] iOS: macOS/Xcode, deployment target, archive, signing team, simulator and representative devices.
- [ ] Verify secure storage across restart/update, logout/revocation, backgrounding, screenshots/overlays,
  app links, network loss/recovery, camera/gallery/files, upload cancellation/retry and large text.
- [ ] Run guard/owner/access-denial workflows with approved synthetic store-review accounts only.

## Store material and release

- [ ] Approved icon/splash, phone/tablet screenshots, support/marketing URLs and review notes.
- [ ] Google Play content rating, target API, data safety, testing tracks and reviewer access complete.
- [ ] Apple privacy nutrition labels, export compliance, age rating, review notes and reviewer access complete.
- [ ] Two clean `npm run mobile:rc` gates plus native CI/device matrix attached to the immutable commit.
- [ ] No Critical/High defect; accepted lower risks have owner, expiry and rollback decision.
- [ ] Staged rollout, monitoring, support, revocation, rollback and store-removal procedures rehearsed.
- [ ] Explicit publication approval recorded before any upload or submission.

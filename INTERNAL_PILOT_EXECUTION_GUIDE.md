# Internal Pilot Execution Guide

1. Use only a local or explicitly isolated test environment and the fixed synthetic tenant. Never use customer, person, vehicle, location, or biometric data.
2. Verify the candidate commit is clean, run both final gates, record the commit and summaries in untracked `.data/internal-pilot-evidence/automated-gate.json`, and verify the debug APK hash.
3. Run `npm run pilot:reset`, `npm run pilot:seed`, `npm run pilot:verify`, `npm run pilot:test-boundaries`, `npm run pilot:rehearsal`, and `npm run pilot:readiness`.
4. Execute all 42 cases in `INTERNAL_PILOT_TEST_MATRIX.md`. Automated evidence is supporting evidence only. Record human observations and defect references in a generated, untracked UAT execution pack.
5. Test the exact APK on a real authorized Android device using `PILOT_DEVICE_SETUP_GUIDE.md`; store only non-sensitive evidence.
6. Triage every failure. Customer handover is forbidden with any open Critical/High defect, incomplete case, missing owner sign-off, inaccurate tracker/facial label, missing physical-device evidence, or missing named authorizer.

Coverage includes administrator setup, dispatch, approval, guard departure/identity/inspection/evidence, tracker state, return/reconciliation, exceptions, investigation, executive and auditor views, reports, governance evidence, facial lifecycle, Android behavior, and the complete departure/return path.

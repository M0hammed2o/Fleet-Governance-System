# Internal Pilot Test Matrix

The canonical 27 cases remain in `pilot/uat-catalogue.json`. The 15 additions are in `pilot/phase17a-rehearsal-cases.json`, for 42 total. Run `npm run pilot:rehearsal` to validate both catalogues and evidence references.

| Execution category | Phase 17A cases | Meaning |
|---|---:|---|
| Automated | 4 | Repository behavior can be asserted, but no human result is implied. |
| Browser-simulated | 4 | Synthetic provider UI/API behavior; no real biometric result. |
| Human | 4 | Requires a named internal tester and evidence. |
| Physical Android device | 3 | Requires an actual authorized device. |
| Existing catalogue | 27 | Human UAT remains `NOT_RUN` until executed. |

The added cases cover enrolment, successful synthetic verification, non-match, facial-liveness failure, provider unavailable, manual fallback, authorized/unauthorized override, revoked enrolment, cross-tenant reference, deletion, Android camera permission/disconnected/session restoration, and the complete departure/return lifecycle. Emulator, physical-device, human, and customer outcomes must be recorded independently. Customer execution is zero for Phase 17A.

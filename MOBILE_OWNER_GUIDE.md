# Mobile Owner / Executive guide

The mobile experience is a decision summary, not the complete administration system. Canonical
permissions—not the word “Owner”—control every record and action.

1. Sign in with an approved synthetic account and confirm tenant, role and **Synthetic** label.
2. Open **Overview** to review vehicles out, overdue, awaiting approval, open exceptions and high
   indicators. Counts are tenant-scoped point-in-time server results.
3. Review tracker Fresh/Stale/Unavailable/Synthetic counts. Stale or unavailable is an availability signal,
   not proof of wrongdoing. Raw provider asset identifiers are never shown.
4. Review recent gate activity, reconciliations and investigation summaries. Investigation summaries appear
   only with `investigationCase:VIEW`; confidential content is not inferred from an executive title.
5. Open **Notifications** for paged, permission-filtered in-app notices. Push/email/SMS/messaging delivery is
   disabled. A deep link is checked locally and the server checks the record and tenant again.
6. For a submitted movement approval, verify reference, vehicle, driver, purpose, tracker limitations and
   consequence text. Add decision comments where required and approve/reject once. The server enforces
   authority, actor/time, tenant scope, state and self-approval separation; wait for its result.

Detailed vehicle, exception, indicator, reconciliation, investigation management, export configuration,
role/tenant administration and most reports remain web-only in Phase 16A. The overview and notification
summaries are useful triage, not a substitute for those full review surfaces. Tenant switching is not
offered because the current user model authorizes one tenant per user. On disconnection or ambiguous state,
do not decide; reconnect, refresh and reconcile with audit chronology.

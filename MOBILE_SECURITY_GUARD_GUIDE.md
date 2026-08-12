# Mobile Security Guard guide

Phase 16A is synthetic, local and online-only. Never use real evidence or treat tracker unavailability as
misconduct.

1. Sign in with the approved synthetic tenant account. Confirm the tenant name and **Synthetic** badge.
2. Open **Gate**, confirm the site and active gate, then search registration, fleet number or reference.
3. Open an authorized movement. Compare the displayed vehicle and driver in person, then tick both
   confirmations. A displayed role or tracker record never replaces physical/security procedure.
4. Read the authorization reason and tracker source/freshness. Stale/unavailable means data quality only.
5. Start departure or return checks. Complete identity steps; the available Phase 16A identity action is
   synthetic only and is not facial recognition.
6. Complete every configured checklist item. Enter odometer/fuel or text observations where requested.
   **Fail and raise exception** when a safety/condition/cargo/equipment observation fails.
7. To attach synthetic evidence, select/capture explicitly, review filename/size, remove if wrong, then
   choose **Upload evidence**. Nothing uploads on selection alone. Do not include real people, plates,
   locations, customers or secrets in Phase 16A files.
8. Clear only when authorized and safe. For an exception, request supervisor review and give the required
   reason before blocking/override actions. The server decides permissions and separation rules.
9. Record the final gate outcome only once. Wait for **Server confirmed** and **Gate workflow complete**.
   Departure/return chronology and eligible reconciliation are created by authoritative backend rules.

If disconnected, stop critical entry: the persistent warning means nothing can be recorded. Preserve no
shadow mobile queue. Reconnect, refresh authoritative state, confirm whether the action exists, then retry;
idempotency prevents an exact completed retry from duplicating work. For 401/revocation, sign in again. For
409/in-progress, refresh and escalate—do not invent a new key to force the action. For an unsafe or
unauthorized movement, block with a factual reason and follow the existing incident/escalation procedure.

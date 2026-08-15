# Operations runbook

## Phase 17A operations

Run `pilot:rehearsal`, `pilot:readiness`, `facial:readiness`, and `backup:readiness`. Provider unavailable is not failed identity; use the reasoned, independently approved document/record fallback. Revoke on compromise/offboarding and follow dual-control deletion. Do not put biometric media in support channels. Customer handover stops on any readiness blocker.

This runbook is provider-neutral. It authorizes no deployment, account creation, production migration, external message, payment, or real-data import.

## Build and start

1. Use Node 24 and `npm ci`; confirm `git diff --exit-code -- package-lock.json package.json`.
2. Supply runtime secrets through the hosting secret manager, never image build arguments or tracked files.
3. Run the release checklist and require `APP_ENV=production npm run production:check` to exit zero.
4. Take/verify a provider backup and record its reference outside application logs.
5. Run `npx prisma migrate deploy` once through the direct connection.
6. Build with `npm run build`; start the standalone image with `node server.js` or source build with `npm start`.
7. Allow 10–30 seconds for graceful SIGTERM drain. Check `/api/health/live`, `/api/health/ready`, then authenticated diagnostics.

The Dockerfile is multi-stage, contains no `.env`, runs as UID 1001, and checks liveness. A reverse proxy must terminate HTTPS, preserve the original origin/forwarded IP safely, avoid buffering streamed responses, enforce request-size/time limits, and avoid caching authenticated pages or health details.

## Migration failure and rollback

Stop new instances and job schedulers. Capture the migration name/error without connection strings. Do not edit a migration already applied anywhere and do not mark failed SQL successful manually. Determine whether the previous application is schema-compatible; if so, roll application traffic back while retaining the forward-compatible schema. Otherwise restore the pre-release backup into an isolated database, verify it, and obtain incident/change approval before any production restore. Correct schema defects with a new forward migration.

## Backup and restore

Backups must be encrypted, access-controlled, monitored, retained under the approved legal schedule, and include database plus durable object storage/version metadata. Restore drills use an isolated target, validate migration history, tenant counts/checksums using approved non-sensitive measures, sample signed-object retrieval and hold/deletion invariants, then destroy the drill target. `npm run verify:backup-restore` is local/test proof only and is not a hosted backup system.

## Secret rotation

Create the new value in the approved secret manager. For sessions, media URLs and job scheduler tokens, move the old value to the matching `_PREVIOUS` variable and deploy; confirm both paths; rotate clients/scheduler; after the maximum token/URL lifetime remove the previous value and redeploy. Rotate database/provider credentials using their overlap mechanism. Never log, paste into tickets, or commit either value. Revoke immediately after suspected exposure and invalidate sessions where appropriate.

## Provider outage

- Tracker: mark data degraded/stale/unavailable, pause dependent polling if rate-limited, retain checkpoint, never infer misconduct, use authorized manual location only with source label, and reconcile after recovery.
- Email: keep delivery records failed/pending; automatic retry is capped at three; use dashboard/manual operator follow-up without placing confidential case details in another channel.
- Billing: stop checkout/webhook reconciliation if authenticity is uncertain; never mark paid from a browser claim; preserve invoices/customer data; reconcile using signed events or audited finance approval after recovery.
- Storage: block new evidence workflows if durability cannot be guaranteed; do not fall back to ephemeral local storage; preserve DB rows/holds; clean only verified orphan uploads after recovery.
- Scheduler: use authenticated manual job execution one job at a time; inspect the previous JobRun and overlap state; re-run only documented idempotent jobs.

## Incident response

Classify severity, start an incident record, appoint incident lead, preserve redacted logs/audit evidence, contain access, rotate exposed credentials, notify the Information Officer/security/legal contacts, assess POPIA notification duties, communicate through approved channels, restore service, reconcile providers/jobs, document timeline/root cause/corrective actions, and complete post-incident review. Do not place passwords, tokens, biometric templates, full allegations, payment details or raw customer exports in incident tools.

## Pilot support

Confirm the synthetic pilot dataset, named support/on-call owner, escalation contacts, working hours, roles, device/browser/camera readiness, tracker/manual-source labels, daily job review, backup evidence and rollback trigger. Support access requires a time-limited, reasoned, audited session and least privilege. End the session immediately after work.

## Routine operator checks

- Read `/platform/readiness`, tenant status, billing, storage and support-access dashboards.
- Check latest failed/overdue JobRuns and provider degradation; do not expose tenant content in operational chat.
- Confirm last successful backup and restore-drill evidence in the external backup system.
- Review storage expiry/holds, tracker freshness, failed email attempts, unresolved billing events and active incidents.
- Re-run `npm run production:check` after every configuration or provider change.

## Local pilot rehearsal commands

Run `npm run pilot:seed`, `npm run pilot:verify`, `npm run pilot:test-boundaries`, `npm run pilot:imports:validate` and `npm run pilot:uat:validate` before a UAT session. `npm run pilot:rc` performs the full non-deploying candidate gate and writes its sanitized summary beneath ignored `.data`; `npm run pilot:docker:smoke` builds a disposable image, confirms the non-root user/liveness and removes only its own fixed smoke container. The detailed lockout, device, network, provider, job, database, evidence, mapping, reconciliation, disclosure, revocation, compromise, breach, restore, rollback and offboarding rehearsals are in `PILOT_SUPPORT_GUIDE.md`. The current gate workflow is online-only: reconnect, reload authoritative state and reconcile before retrying; never keep a shadow paper/digital queue unless the business separately approves its process and later reconciliation controls.

## Phase 15A operations

## Phase 16A mobile operations

The app is online-only. On disconnect, stop critical input, reconnect, refresh authoritative state and inspect audit/event status before retrying; never keep an unofficial queue. A 409 in-progress receipt requires reconciliation, not a new key. Device loss/compromise requires session revocation and incident handling; secure storage does not make an unlocked/rooted device safe.

Keep production mobile auth and trusted origins fail-closed until approved. Evidence failures use only approved synthetic content and must retain no unnecessary copy. Push is disabled. Run `npm run mobile:rc` twice, then complete native device/store checks before any candidate release.

Initialize/validate/export human results only under ignored private storage with the commands in `HUMAN_UAT_EXECUTION_GUIDE.md`; retain accepted pack revisions and never edit their final chronology. For tracker degradation, display source/freshness, quarantine unmapped/invalid events, stop bounded retries, preserve checkpoints/audit, and never infer misconduct. Mapping correction ends the active row then creates a linked replacement; do not delete history. Credential compromise triggers provider disablement/revocation, checkpoint clearance, secret rotation and incident review. Run `tracker:conformance` before any sandbox activation and `staging:check`/`staging:rc` before a separately approved staging change.

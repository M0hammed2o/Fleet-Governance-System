# Production readiness and provider integrations

Phase 13A supplies production-safe foundations; it does not select a hosting company or connect an external provider. Run `npm run production:check` for the authoritative, read-only status report. A non-zero exit is expected until every provider/business blocker is resolved.

## Configuration

`APP_ENV` is independent from `NODE_ENV` and must be `development`, `test`, or `production`. Production validates a non-local HTTPS `APP_BASE_URL`, pooled `DATABASE_URL`, direct migration `DIRECT_DATABASE_URL`, TLS mode, bounded pool/timeouts, current signing secrets, storage/payment/email/tracker/monitoring selections, scheduler token, deployment/backup metadata, and manual POPIA/pilot confirmations. Current/previous session, media-signing, and scheduler keys permit controlled rotation. No private value uses `NEXT_PUBLIC_`; `.env.example` contains blank names only.

Production refuses local evidence storage and all mock/dev-console provider selections. Test refuses production databases, durable/external storage, and external provider selections. The readiness statuses are `READY`, `BLOCKED`, `NOT_CONFIGURED`, `MOCK_ONLY`, and `MANUAL_CONFIRMATION_REQUIRED`; code readiness is reported separately from commercial or legal readiness.

## Database requirements

- Managed PostgreSQL compatible with the committed Prisma version and all 27 migrations.
- TLS required; separate pooled runtime and direct migration endpoints; connection limit, connect/query/transaction timeouts configurable.
- Automated backups with encrypted storage, documented retention, point-in-time recovery where approved, restore isolation, and operator audit evidence.
- Release migration command: `npx prisma migrate deploy`. Never run `migrate dev` against a deployed database.
- Failure response: stop rollout, preserve logs without URLs/credentials, do not edit an applied migration, restore the prior application version when compatible, and create a forward corrective migration.
- Local recovery proof: `npm run verify:backup-restore`. It accepts loopback PostgreSQL databases ending `_test`, restores only to `_restore_verify`, verifies migration history, drops the disposable target, deletes its temporary dump, and refuses production-like targets.

## Object storage requirements

The adapter contract requires private objects, tenant-prefixed keys, signed time-limited reads, server-confirmed uploads, SHA-256 integrity metadata, bounded upload/MIME policy, deletion, cleanup, usage accounting, health diagnostics, and credential rotation. Database holds and retention state prevent application deletion; a provider must also document archive tier and legal-hold API support. Local storage remains development/test only. The R2-compatible boundary is unconfigured, bounded to three SDK attempts and explicit connection/request timeouts; choosing R2 is not an approval to open an account.

## Tracker integration checklist

Cartrack, Netstar, Tracker, Ctrack, MiX/Powerfleet, and future adapters remain blocked. For each provider obtain official API/webhook documentation, sandbox terms, customer authorization, data-field semantics, rate limits, retention/location privacy terms, credential-rotation and revocation procedures, outage SLA, and approved credentials. Then implement and pass the common contract for capability discovery, connection/tenant isolation, assets, position/timestamps/online/ignition/movement/speed/heading/odometer, optional fuel/diagnostics, paginated trips/stops/events, health, webhook verification, polling checkpoints, request correlation, bounded timeout/retry/backoff, normalized errors, mapping validation, and revocation. Never label synthetic, manual, stale, or unavailable data as live.

## Email checklist

No provider is selected. The transactional contract carries template ID, recipient, subject data, template variables, correlation/idempotency key, unsubscribe policy, delivery reference, retry classification, and audit-safe metadata. Generic subjects must not disclose invoice/case/allegation details. Production email remains fail-closed until vendor/DPA, domains and DNS authentication, templates, bounce/complaint handling, suppression/unsubscribe rules, regional processing, rate limits, sandbox, key rotation, outage process, and approved credentials exist. No-op and synthetic providers never send externally; delivery records are idempotent and automatic retries stop after three attempts.

## Billing checklist

PayFast is only a named disabled boundary. Obtain official merchant/recurring-payment and webhook documents, supported subscription lifecycle, signature/canonicalization rules, IP assumptions, idempotency semantics, currency/amount representation, reconciliation/refund APIs, sandbox, merchant credentials, commercial/legal approval, and outage/support contacts. The generic contract represents customers, plans/trials/cycles, subscriptions, cancellation/reactivation, checkout, webhook verification/idempotency, success/failure/grace/suspension, invoice/receipt reference, reconciliation and refunds. Return URLs are same-origin. Mock success is forbidden in production and no real payment is initiated.

## Scheduling and monitoring

`src/lib/operations/job-manifest.ts` lists all 13 authenticated jobs, cadence, owner, overlap and retry policy. Jobs have a database-enforced single-RUNNING constraint, structured duration/outcome logs, bounded record/tenant scans, idempotent state transitions, and no automatic accusation or discipline. Configure an external scheduler only after selecting it; use current/previous scheduler tokens during rotation.

Monitoring remains provider-neutral. A future service must ingest structured JSON without credentials, personal data, biometric material or confidential allegations; support correlation IDs, exception/error classification, latency/health/job metrics, uptime checks, alert routing/on-call ownership, retention/access controls and breach/export procedures. Public `/api/health/live` is minimal; `/api/health/ready` exposes only dependency state; `/api/platform/diagnostics` and `/platform/readiness` require platform `CONFIGURE`.

## Retention, POPIA and pilot blockers

Existing category policies, evidence/investigation/legal holds, two-person deletion, recovery windows, export expiry, tombstones and audit history remain. Production decisions still require Information Officer confirmation, PAIA manual status, lawful bases/notices, data-subject workflow, breach contacts, final category/location/notification/billing/audit/backup retention periods, provider deletion propagation, backup expiry, offboarding evidence, and cross-border processing. Safe defaults are not legal advice and remain `MANUAL_CONFIRMATION_REQUIRED`.

The pilot requires approved synthetic-to-real data transition, support owner, incident contacts, tenant/site/gate/roles, training/UAT sign-off, provider selections, backup restore evidence, monitoring alerts and release approval. No real customer data should enter the system before these checks are complete.

## Phase 14A local evidence

The local package can be exercised with `npm run pilot:rc`; its expected production-readiness exit is 1 because durable storage, real tracker/email/payment, scheduler/monitoring, deployment identity, legal confirmations and named approvals are absent. The synthetic tenant and UAT documents prove engineering behavior only. Do not change readiness classifications to make the candidate appear green: resolve every external blocker with approved facts and configuration, then rerun the production checker in the separately authorised target environment.

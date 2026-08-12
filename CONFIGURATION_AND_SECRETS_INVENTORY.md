# Redacted configuration and secrets inventory

No values belong in this document. `D/T/S/P` mean development/test/staging/production. `R`, `O` and `F` mean required, optional and fail-closed/defaulted. Staging and production values come from an approved secret/configuration manager; rotation owner is `MANUAL_CONFIRMATION_REQUIRED` until assigned.

| Name | Purpose | D/T/S/P | Class/source | Rotation/validation | Safe absence and readiness |
|---|---|---|---|---|---|
| APP_ENV | Deployment policy boundary | R/R/R/R | Non-secret deploy config | Release owner; enum | Defaults dev only when absent; staging/production check blocked |
| APP_BASE_URL | Canonical origin | O/O/R/R | Non-secret deploy config | Release owner; absolute, hosted HTTPS for S/P | S/P blocked |
| AUTH_TRUSTED_ORIGINS | Additional approved origins | O/O/O/O | Non-secret deploy config | Security; exact origins | Same-origin only |
| DATABASE_URL | Pooled runtime database | R/R/R/R | Secret store | DB owner; PostgreSQL; test/staging name isolation, nonlocal TLS S/P | App/db readiness blocked |
| DIRECT_DATABASE_URL | Migration database | O/O/R/R | Secret store | DB owner; same isolation | Migration blocked |
| DATABASE_SSL_MODE | TLS policy | O/O/R/R | Non-secret config | DB owner; enum, require/verify-full S/P | S/P blocked |
| DATABASE_MAX_CONNECTIONS | Pool bound | O/O/O/O | Non-secret config | Technical; 1–50 | Safe default 10 |
| DATABASE_CONNECTION_TIMEOUT_MS | Connect bound | O/O/O/O | Non-secret config | Technical; 500–30000 | Safe default 5000 |
| DATABASE_QUERY_TIMEOUT_MS | Query bound | O/O/O/O | Non-secret config | Technical; 1000–120000 | Safe default 15000 |
| DATABASE_TRANSACTION_TIMEOUT_MS | Transaction bound | O/O/O/O | Non-secret config | Technical; 1000–300000 | Safe default 30000 |
| SESSION_SECRET / _PREVIOUS | Session integrity/rotation | O/O/R/R | Secret store | Security; ≥32, no placeholder | S/P blocked; previous optional |
| MEDIA_URL_SIGNING_SECRET / _PREVIOUS | Signed evidence URLs | O/O/R/R | Secret store | Security/storage; ≥32 | S/P blocked; reads unavailable |
| BIOMETRIC_TEMPLATE_ENCRYPTION_KEY | Template encryption | O/R/R/R | Secret store | Security/privacy; validated key material | S/P blocked; biometric feature unavailable |
| JOB_SCHEDULER_TOKEN / _PREVIOUS | Job authentication | O/O/R/R | Secret store | Operations/security; ≥32 S/P | Jobs fail closed |
| STORAGE_PROVIDER | Evidence adapter | O/R/R/R | Non-secret config | Technical; local/r2 | Defaults local; forbidden S/P |
| STORAGE_LOCAL_PATH | Dev/test private path | O/O/—/— | Local config | Developer; contained path | Local adapter unavailable if invalid |
| R2_ACCOUNT_ID | S3-compatible account | O/O/R*/R* | Secret/config manager | Storage owner; nonempty when r2 | Storage blocked |
| R2_ACCESS_KEY_ID | Storage credential ID | O/O/R*/R* | Secret store | Storage owner; rotate/revoke | Storage blocked |
| R2_SECRET_ACCESS_KEY | Storage credential | O/O/R*/R* | Secret store | Storage owner; rotate/revoke | Storage blocked |
| R2_BUCKET_NAME | Private bucket | O/O/R*/R* | Config manager | Storage owner; approved private bucket | Storage blocked |
| PAYMENT_PROVIDER | Billing adapter | O/R/R/R | Non-secret config | Finance/technical; enum | Defaults noop; external staging rejected; mock production rejected |
| BILLING_EMAIL_PROVIDER | Invoice email | O/R/R/R | Non-secret config | Product/privacy; enum | Defaults noop; no delivery |
| INVESTIGATION_NOTIFICATION_PROVIDER | Case notification | O/O/R/R | Non-secret config | Product/privacy; enum | Defaults noop; no delivery |
| AUDITOR_INVITATION_PROVIDER | Auditor invitations | O/O/R/R | Non-secret config | Security/privacy; enum | Defaults noop; no delivery |
| RETENTION_NOTIFICATION_PROVIDER | Retention notices | O/O/R/R | Non-secret config | Privacy/ops; enum | Defaults noop; no delivery |
| TELEMATICS_PROVIDER | Tracker adapter | O/R/R/R | Non-secret config | Technical/product; enum | Defaults disabled; synthetic/mock production rejected |
| MONITORING_PROVIDER | Observability adapter | O/O/R/R | Non-secret config | Security/ops; enum | Defaults disabled; staging readiness blocked |
| EMAIL_REQUIRED | Production feature gate | O/O/O/O | Non-secret approval config | Product; boolean | False keeps no-op acceptable |
| PAYMENTS_REQUIRED | Production feature gate | O/O/O/O | Non-secret approval config | Finance; boolean | False keeps billing disabled |
| TRACKER_REQUIRED | Production feature gate | O/O/O/O | Non-secret approval config | Product; boolean | False keeps tracking disabled |
| DEPLOYMENT_TARGET | Approved target reference | O/O/R/R | Non-secret evidence ref | Release owner; nonempty | Readiness blocked/manual |
| BACKUP_STRATEGY | Approved backup reference | O/O/R/R | Non-secret evidence ref | DB owner | Readiness blocked/manual |
| BACKUP_LAST_RESTORE_TEST_AT | Restore evidence time | O/O/R/R | Non-secret evidence ref | DB owner; approved timestamp/ref | Readiness blocked/manual |
| INFORMATION_OFFICER_CONFIRMED | IO decision flag | O/O/O/R | Non-secret approval | IO; boolean + external evidence | Production manual blocker |
| PAIA_MANUAL_CONFIRMED | PAIA decision flag | O/O/O/R | Non-secret approval | IO/legal | Production manual blocker |
| PILOT_APPROVED | Pilot approval flag | O/O/O/R | Non-secret approval | Pilot owner | Pilot readiness blocked |
| PILOT_SUPPORT_OWNER | Support owner reference | O/O/R/R | Non-secret config | Operations | Pilot/staging blocked |
| STAGING_APPROVED_COMMIT | Reviewed commit hash | —/—/R/— | Non-secret release evidence | Release owner; 7–40 hex | Staging blocked |
| STAGING_RELEASE_APPROVED | Release approval | —/—/R/— | Non-secret approval | Release owner; boolean + external evidence | Staging blocked |
| STAGING_ROLLBACK_OWNER | Named/controlled owner ref | —/—/R/— | Non-secret config | Operations | Staging blocked |
| STAGING_SYNTHETIC_DATA_CONFIRMED | Synthetic-only assertion | —/—/R/— | Non-secret approval | Privacy/UAT | Staging blocked |
| STAGING_EXTERNAL_EMAIL_DISABLED | No external delivery assertion | —/—/R/— | Non-secret approval | Product/privacy | Staging blocked |
| STAGING_PAYMENT_DISABLED_OR_SANDBOX | Billing isolation assertion | —/—/R/— | Non-secret approval | Finance | Staging blocked |
| STAGING_TRACKER_SANDBOX_ISOLATED | Tracker isolation assertion | —/—/R/— | Non-secret approval | Technical/security | Staging blocked |

Framework and operator-only process variables are also inventoried: `NODE_ENV` and `NEXT_RUNTIME` are
set/managed by Next.js; `PORT` and `HOSTNAME` are non-secret container runtime bindings; `CI` is a
non-secret test-runner switch; `ComSpec` is the Windows shell path inherited by the local seed wrapper;
`JOB_CLI_BASE_URL` is an optional local/controlled job-runner target (loopback default); and
`SEED_SUPPRESS_CREDENTIAL_OUTPUT` is a non-secret automation safety flag. None is an application secret,
none should be prefixed `NEXT_PUBLIC_`, and operator tooling must not use them to weaken `APP_ENV` policy.

`R*` applies when `STORAGE_PROVIDER=r2`. Provider-specific credentials are intentionally absent until an adapter is approved; add their names/classification/rotation rules only from official adapter requirements, never by guessing.

Checks: `.env.example` contains names only; `.env*` is ignored except the committed blank/test example policy; `npm run security:scan` detects staged environment/secrets; runtime validation rejects placeholder secrets and development providers/targets in staging/production; pilot mutation commands accept only named loopback dev/test databases; email and payment default no-op; tracking defaults disabled outside local dev/test; structured logs are redacted. Run `npm run staging:check` and `npm run production:check`; non-zero is expected until approvals/providers exist.

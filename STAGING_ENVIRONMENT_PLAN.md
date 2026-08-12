# Secure non-production staging environment plan

Status: design only; `MANUAL_CONFIRMATION_REQUIRED` for every vendor/target/owner. Phase 15A created no account, resource, DNS, secret or deployment.

## Principles

- Separate cloud account/project, network, database, bucket, secrets, identities, domain, logs and backups from production and development.
- Initial UAT uses synthetic data only, zero biometric templates and reserved non-deliverable identities. Current local pilot seed is intentionally not authorized against a remote staging database.
- HTTPS only; least privilege; no public database/object access; outbound provider access disabled by default.
- Email is disabled or a proven non-delivering sink; billing disabled or an approved sandbox; tracking disabled/synthetic until an approved sandbox adapter passes conformance.
- Infrastructure vendor selection and region remain `MANUAL_CONFIRMATION_REQUIRED`; requirements are not endorsements.

## Component plan and trade-offs

| Component | Minimum requirement | Options/trade-off | Decision |
|---|---|---|---|
| Hosting | Immutable non-root container, health probes, bounded resources, private runtime config, rollback | Managed container reduces operations; VM offers control but increases patching | MANUAL_CONFIRMATION_REQUIRED |
| PostgreSQL | Managed supported PostgreSQL, pooled runtime/direct migration endpoints, TLS, private network, PITR/backup | Managed HA costs more; single-zone staging may reduce cost but weakens rehearsal fidelity | MANUAL_CONFIRMATION_REQUIRED |
| Object storage | Private bucket, tenant prefixes, signed reads, encryption, lifecycle/deletion, no public ACL | Existing S3-compatible boundary; vendor/region unselected | MANUAL_CONFIRMATION_REQUIRED |
| DNS/TLS | Dedicated staging subdomain, automated certificate renewal, no production cookies/domain overlap | Organization-managed DNS/cert service | MANUAL_CONFIRMATION_REQUIRED |
| Secrets | Managed secret store, deploy-time injection, audit, rotation/current+previous keys | Platform-native vs independent vault | MANUAL_CONFIRMATION_REQUIRED |
| Scheduler | Authenticated, observable, one owner, bounded retries/overlap | Platform scheduler vs managed job service | MANUAL_CONFIRMATION_REQUIRED |
| Monitoring | Redacted errors/logs/metrics/uptime, alert routing and retention/access | Generic adapter target unselected | MANUAL_CONFIRMATION_REQUIRED |

## Isolation and access

Only named staging administrators can change configuration/migrations. Testers receive app roles, not console/database/bucket access. Support requires an explicit time-bounded support session; no standing customer-data access. Enforce MFA/SSO where approved, separate deploy/migration/runtime service identities, restricted egress and no shared production credentials. Keep provider sandbox credentials in a separate namespace and revoke them on completion.

Network policy permits HTTPS ingress through the approved edge and only required database/storage/monitoring endpoints. Tracker/payment/email egress stays denied until the corresponding sandbox gate is approved. SSRF defenses must not rely solely on network controls.

## Data and provider controls

- Load a newly approved staging-synthetic dataset, not a copied production database or Phase 14 local dump.
- Validate tenant identity, reserved domains, zero biometric templates and synthetic markers before/after load.
- Provider sandbox assets must be synthetic/provider-approved and mapped only to the staging tenant.
- Never route test email externally; use no-op/sink and verify bounce-free non-delivery.
- Never charge; billing remains no-op/mock until approved sandbox documents/credentials exist.
- Retention should be short and documented; holds, exports and deletion remain testable. Resource teardown includes database backups, bucket versions, logs, secrets and provider-side copies.

## Operations

Health: public liveness exposes process state only; safe readiness exposes dependency names/states; authenticated diagnostics requires platform `CONFIGURE`. Alerts cover error rate, latency, availability, job failures/overlap, database/storage health, backup failure, unexpected outbound/provider use and access anomalies. Logs carry correlation IDs and classifications without credentials, personal data, precise unnecessary locations or allegations.

Backups require encryption, retention, owner, RPO/RTO and a restore rehearsal into an isolated disposable target. Restore evidence must prove migration history and synthetic-only content. Incident handling defines detection, containment, credential revocation, provider disablement, evidence preservation, notification escalation and post-incident review.

Cost controls: budget/alerts, bounded autoscaling/storage/log retention, sandbox quotas, idle shutdown only if it does not defeat scheduled UAT, and named cost owner. Deletion uses a reviewed checklist and evidence; never delete production by shared automation.

## Non-deploying promotion workflow

Run `npm run staging:rc` from a clean approved commit. It checks package integrity, 29 migrations, empty replay, backup/restore, TypeScript, lint, tests, build, synthetic boundaries, tracker conformance, UAT catalogue/execution pack, Playwright responsive/accessibility, secrets, audit, expected blocked readiness, performance, non-root container/liveness, rollback documents and a final clean tree. It creates local ignored evidence and performs no deployment.

Before a real staging release, separately record approved commit/image digest, change window, owners, technical/business/security/privacy approvals, managed backup, forward migration plan, rollback compatibility and smoke tests. Apply migrations once with `prisma migrate deploy`; never `migrate dev`. Promote the same reviewed artifact; do not rebuild with secrets.

Rollback: stop promotion, disable schedules/provider egress, restore previous compatible image, use a forward corrective migration rather than editing applied migrations, restore data only under approved recovery criteria, verify health/isolation/synthetic labels, and record evidence.

## POPIA and exit

Synthetic data materially reduces personal-information exposure but does not remove security, access-log, operator/DPA, processing-location, breach and deletion obligations. Legal/Information Officer review is required before any real personal/location/biometric data. Exit revokes identities/credentials, exports only approved evidence, deletes runtime/database/bucket/log/backup/provider copies per approved policy, verifies deletion and removes DNS/resources under dual review.

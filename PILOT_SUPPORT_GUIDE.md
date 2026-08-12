# Pilot Support guide

## Role purpose and sign-in

Support the local pilot without assuming a customer role. Platform diagnostics require platform authorisation; customer viewing requires an explicit, reasoned, time-limited support session. Never request a user’s password.

## Daily workflow

Review liveness/readiness, redacted diagnostics, tenant/storage/billing/support dashboards, latest JobRuns, provider quality and backup evidence. Confirm the incident/support owner before changing local state.

## Core tasks and rehearsals

| Event | Safe response |
|---|---|
| User locked out | Verify identity through approved process; inspect rate-limit/session state; never reveal account existence or password. |
| Tablet/camera unavailable | Use authorised spare/file fallback or pause; no personal device/message channel. |
| Gate network unavailable | Online-only: physical continuity procedure, no false success, reconcile authoritative state after recovery. |
| Tracker unavailable/mapping wrong | Mark stale/unavailable, pause dependent inference, validate tenant/vehicle mapping, use authorised manual confirmation. |
| Storage/upload unavailable | Block evidence workflow; never use ephemeral/public fallback; retain DB state and retry idempotently. |
| Email/payment unavailable | Preserve pending/failed record; no external send/payment; reconcile only authenticated provider or authorised manual evidence. |
| Scheduled job failed | Inspect redacted JobRun, overlap/checkpoint and retry classification; re-run one idempotent job only. |
| Database unavailable | Stop mutations/jobs, preserve safe error, restore service; never operate from stale browser success. |
| Duplicate movement/reconciliation | Inspect idempotency/state; do not delete history; escalate ambiguous records. |
| Wrong role saw confidential data | Stop access, end sessions, preserve logs, notify security/privacy and start incident assessment. |
| Auditor revocation | Revoke grant, confirm immediate denial and review access logs. |
| Credential compromise/data breach | Contain, revoke/rotate, preserve redacted evidence, notify named incident/privacy owners and assess obligations. |
| Backup restore | Use isolated guarded test target; verify migration/pilot counts; production restore requires separate approval. |
| Rollback/offboarding | Stop new work/jobs, preserve/export under approval, revoke access/credentials, apply provider deletion/backup expiry plan and evidence completion. |

## Never do

Do not deploy, run production migration/restore, accept terms, expose secrets/customer content in tickets, grant broad access, bypass controls, send messages/payments, or claim offline/provider capability.

## Escalation and failure procedure

Classify severity, name incident lead, contain, preserve redacted evidence/correlation IDs, rotate if required, notify security/privacy/business contacts, recover/reconcile, and document root cause. Real names, hours and contacts remain `MANUAL_CONFIRMATION_REQUIRED`.

## Security, sign-out and quick reference

- [ ] Correct environment/tenant and explicit authority
- [ ] Support session minimal, reasoned and expiring
- [ ] Logs/evidence redacted
- [ ] No external effect or control bypass
- [ ] Session ended; outcome/next owner recorded

Training acknowledgement: I completed lockout, outage, incident, restore, rollback and offboarding rehearsals. Name: ______ Date: ______ Trainer: ______ Signature: ______

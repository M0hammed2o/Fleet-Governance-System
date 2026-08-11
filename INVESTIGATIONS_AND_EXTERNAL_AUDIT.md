# Investigations and External Audit

Phase 11 provides internal investigation case management without changing the operational workflow that
raised a concern. It does not implement Phase 12 analytics or automated employee scoring.

## Lifecycle

Cases receive an atomic `INV-<year>-<sequence>` number and start `DRAFT` / `NOT_DETERMINED` with an active
evidence hold. Valid transitions are:

`DRAFT → OPEN/TRIAGE → UNDER_INVESTIGATION → AWAITING_INFORMATION or AWAITING_APPROVAL → CLOSED`.

Information requests return to `UNDER_INVESTIGATION`. A closed case can be `REOPENED`, then triaged or
resumed. Closure requires an approved finding, its outcome, an authorised closer, timestamp, and audit
event. Closing never releases the evidence hold.

## Intake and referrals

Manual concerns create cases directly. Referrals support exceptions (including GPS/geofence), facial
verification failures, failed inspection items, and reconciliation discrepancies. A related-record row
stores the source ID and immutable summary; it never updates the source. An active unique referral key
makes concurrent identical referrals idempotent. Closure clears that key so genuinely new later
information may create a new case.

## Fairness and evidence

Reporting person, investigator, subject, witness, and other involved party are distinct concepts. Subject
responses are recorded separately. Allegations never become findings merely because a case exists.

Evidence links reuse `MediaAsset`: checksum, storage provider, signed read URL, retention metadata, and
audit. Files can be uploaded or an existing asset can be linked without duplicating bytes. A mistaken link
is marked entered in error with actor/time/reason; it is not deleted. Case notes are append-only and an
amendment points to its original. Tasks track assignee, due date, state, completion actor/time, and overdue
status. Chronology is append-only.

## Findings, approval, and reports

Findings are versioned. A draft must have a determined outcome before submission. When separation of
duties is enabled, its creator/submitter cannot approve it. Return and rejection require reasons; amendment
creates a new row. Case closure uses an approved version.

Each generated report is an immutable PDF snapshot stored as a `MediaAsset`. It labels allegation versus
finding, outcome, subjects, evidence manifest, chronology, approval, confidentiality, and hold state.
Restricted case/evidence content is excluded unless the requester has confidential access. Downloads are
signed and audited. External-auditor copies may be watermarked.

## Holds and retention

Every new case starts with a case hold. Linked evidence receives an investigation hold and deletion jobs
must skip it. Closing does not release it. Release requires `investigationHold:CONFIGURE`, a reason, and an
audit event; tenant settings can require two different authorised users for high/critical cases. A shared
asset remains held while any other linked case still has an active hold.

## Roles and permissions

- Security Supervisor / Approving Manager: triage/assignment, approval, closure, hold and external access.
- Internal Investigator / Auditor: investigate, manage subjects/evidence/notes/tasks, draft findings and
  reports; cannot approve their own finding, close a case, release a hold, or grant external access.
- Company Administrator: settings/oversight/holds/external-access administration, not working findings.
- Gate Security Officer: referral only; referral permission grants no case workspace visibility.
- Executive Read-Only Viewer: aggregate case oversight with confidential narrative redacted.
- External Auditor (Case-Scoped): portal permission only; every case action additionally needs a live grant.

Repositories remain authoritative even if UI controls are visible. Cross-tenant IDs and child IDs nested
under the wrong case return non-disclosing errors.

## External-auditor gate

An authorised manager grants one existing dedicated-role user access to explicit case IDs with a reason,
future expiry, and separate report/evidence download flags. Every list/view/download call checks tenant,
auditor user, role permission, start time, expiry, revocation, exact case, and flags. Case view and download
events are logged. Revocation is effective on the next request. Internal mutation APIs remain forbidden.

The invitation provider and notification provider are no-op by default. A grant is valid because of its
database record, not because an email was delivered.

## Notifications and jobs

Assignment, information request, escalation, approval, closure, and external-access events create
best-effort notification records. Delivery failure never rolls back the business action. Jobs exist for
overdue tasks, external grants expiring within three days, and failed-notification retry. Jobs never mutate
case/task state and tolerate concurrent lifecycle cleanup.

## Operator checks

1. Start local Postgres and apply migrations.
2. Seed fictional development users.
3. Use `/investigations` for dashboard/manual intake/referral and `/investigations/external-access` for
   grants. External users use `/external-auditor`.
4. Run the verification matrix in `TESTING.md` and `DEPLOYMENT.md`.
5. Treat BUG-010's adapter warning as documented upstream output, not as a reason to suppress warnings or
   perform an unplanned database-library upgrade.

No production hosting, scheduler, object store, email provider, payment action, or external account was
created as part of Phase 11.

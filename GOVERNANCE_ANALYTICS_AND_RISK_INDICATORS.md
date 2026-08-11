# Governance Analytics and Risk Indicators

## Purpose and safety boundary

Phase 12 turns existing tenant operational records into explainable governance information. A risk
indicator is a deterministic prompt for authorised human review. It is not a finding, accusation, fraud
score, proof of misconduct, or an automated disciplinary decision. The application never changes an
exception, investigation outcome, employment status, or gate decision because an indicator exists.

This phase contains no opaque machine-learning scoring, no production tracker integration, no real
notification delivery, and no cross-tenant benchmark. All calculations operate inside one tenant at a
time.

## Architecture and data flow

1. The dashboard validates a maximum 366-day tenant-local reporting range and builds explicitly
   tenant-scoped queries for movements, gates, inspection answers, exceptions, reconciliations,
   investigations, and tracker records.
2. The calculation engine loads at most 10,001 rows per source, marks the result `INCOMPLETE` when the
   10,000-row calculation limit is reached, applies the tenant's current immutable rule versions, and
   persists explainable candidates.
3. `AnalyticsIndicator.calculationKey` and the tenant/rule/subject/window unique constraint prevent
   duplicate window results. Cooldown settings suppress repeated active prompts across nearby windows.
4. Every indicator retains the rule ID, rule version, complete threshold snapshot, evaluation window,
   subject, explanation, supporting-record references, data quality, count, and lifecycle state.
5. Review actions append `AnalyticsIndicatorEvent` chronology rows and audit records. Dismissal preserves
   the indicator and its complete history.
6. CSV and PDF generation re-runs the same server-side filters and permissions. PDFs reuse the existing
   `MediaAsset` storage, checksum, and signed-download architecture.

Dashboard reads do not recalculate indicators. Calculation is explicit through an authorised action or
the scheduled job.

## Data sources and metric definitions

All timestamps are stored in UTC. Reporting-day boundaries, trend buckets, and operating-hour rules use
`Tenant.timezone` as an IANA time zone. The default reporting range is the latest 30 tenant-local dates.

- Authorised/completed/open movements come from `MovementAuthorisation` rows created inside the selected
  period. Overdue also includes a non-completed movement past `expectedReturnAt`.
- Gate entries/exits and processing time come from `GateEvent`; processing time is
  `completedAt - startedAt` when both exist.
- The schema has inspection outcome timestamps but no separate inspection-start timestamp. Average
  inspection duration is therefore reported as unavailable; gate-processing duration is not relabelled.
- Movement duration is the elapsed time between a movement's first and last completed gate event.
- A late return uses the final completed gate event versus `expectedReturnAt`; a late departure uses the
  first gate start versus `expectedDepartureAt`.
- Vehicles outside are distinct vehicles on `IN_PROGRESS` movements. Missing return reconciliations are
  completed movements without a reconciliation.
- Inspection failures group failed checklist answers by the stored inspection section.
- Reconciliation discrepancies group the schema's real categories: odometer, fuel, vehicle condition,
  tyre condition, and cargo/load. Passenger and issued-equipment facts are not separate schema categories
  and are not invented.
- A gate override/denial count is a denied gate event plus a cleared gate event with an exception linked
  to that exact gate-event ID.
- Investigation data is aggregate only: source/category/priority/status/outcome, submission/triage/
  investigation/closure elapsed time where timestamps exist, reopened cases, overdue tasks, finding
  decisions, external-access grant states, and active evidence holds. No title, allegation, person,
  evidence, note, or narrative enters the dashboard response.
- Department is the existing `Driver.department` string. There is no Department entity or department-
  scoped authorisation model.

## Default deterministic rules

Defaults are conservative starting values. A tenant configurator can enable/disable or version their
settings; every human change is permission-checked and audited.

| Rule | Default condition | Severity | Cooldown |
| --- | --- | --- | --- |
| Repeated vehicle exceptions | 3 in 30 days | Medium | 7 days |
| Repeated driver exceptions | 3 linked exceptions in 30 days | Medium | 7 days |
| Repeated inspection failures | 3 failed answers in 30 days | Medium | 7 days |
| Repeated gate clearances with exceptions | 3 in 30 days | High | 7 days |
| Repeated late returns | 3 in 60 days | Medium | 14 days |
| Unusually long movements | 2 movements over 24 hours in 30 days | Medium | 7 days |
| Missing return reconciliations | 2 in 30 days | High | 7 days |
| Repeated reconciliation inconsistencies | 3 in 60 days | High | 14 days |
| Tracker stale/unavailable | latest communication missing or over 24 hours old | Low | 3 days |
| Site exception concentration | 10 in 30 days; minimum sample 10 | Medium | 7 days |
| Outside expected operating hours | 3 outside 06:00-20:00 in 30 days | Low | 7 days |
| Sudden exception increase | at least 3 in each sample and 100% over prior 30-day baseline | Medium | 14 days |

`evaluationPeriodDays`, occurrence count, severity, numeric/percentage threshold, hours, stale-data
threshold, baseline, sample size, cooldown, and enabled state are validated. Updating a rule supersedes
the current row and creates version N+1. It never edits an older indicator snapshot.

## Indicator lifecycle

`OPEN -> REVIEWED -> DISMISSED` is the ordinary explained-variance path. A reviewed, dismissed, or
escalated indicator can be reopened to `OPEN`. An open/reviewed indicator can be escalated by a human to
a new investigation or linked to an existing same-tenant investigation. Escalation records the case link
and chronology but never deletes the indicator or creates a finding. Notes are mandatory for every
transition.

Supporting references are filtered by the user's permission to the underlying resource. A user may see
that records were withheld without receiving their IDs or summaries. A foreign tenant's indicator,
supporting record, case, or report returns the same not-found response as an unknown ID.

## Data quality and tracker transparency

- `COMPLETE`: bounded operational inputs were available for the calculation.
- `INCOMPLETE`: an input limit was reached or a provider-looking source cannot be verified as production.
- `MOCK`: provider data is explicitly marked mock/synthetic/demo.
- `MANUAL`: the tracking source is an authorised manual record.
- `MIXED`: more than one source class contributed.
- `UNAVAILABLE`: no sufficient tracking information exists.

There are no production tracker credentials in Phase 12. A provider reference is never labelled live;
unknown provider-looking records are `INCOMPLETE`. No route-deviation indicator is calculated because the
model has insufficient planned-route/GPS evidence. Missing tracking is a data-availability condition, not
evidence of misconduct.

## Permissions and seeded role matrix

| Role | Dashboard | Indicator detail | Review/escalate | Rule config | Export/report |
| --- | --- | --- | --- | --- | --- |
| Company Administrator | Yes | Yes | Yes | Yes | Yes |
| Security Supervisor / Approving Manager | Yes | Yes | Yes | View only | Yes |
| Fleet and GPS Manager | Yes | Yes | Yes | View only | No |
| Internal Investigator / Auditor | Yes | Yes | Yes | View only | Yes |
| Executive Read-Only Viewer | Yes | Yes | No | No | No |
| Other customer and external roles | No | No | No | No | No |

The permission resources are `governanceAnalytics:VIEW`, `analyticsIndicator:VIEW/EDIT/CREATE`,
`analyticsRule:VIEW/CONFIGURE`, and `analyticsExport:EXPORT`. Export is independent from dashboard view.

## Routes and user interfaces

- `/analytics`: filters, executive summary, operational trends, breakdowns, tracker disclosure,
  aggregate investigation information, indicators, calculation, and export controls.
- `/analytics/indicators/[id]`: explanation, immutable thresholds, permitted supporting records, review,
  dismissal/reopen, escalation, and chronology.
- `/analytics/rules`: current versioned tenant rules and safe-default provenance.
- `/api/analytics/*`: dashboard, rules, indicators/actions, calculation, CSV, PDF creation, and signed
  report download. All routes derive tenant and permissions from the authenticated session.

## Scheduled calculation

`analytics.calculateIndicators` uses the existing authenticated `runJob` boundary. The global job lock
prevents overlapping executions; inside it, tenants are evaluated one by one and each receives an
`AnalyticsCalculationRun` success/failure/count record. A failed tenant does not cause its data to be
aggregated into another tenant. Retries are safe because calculation keys, constraints, and cooldowns are
idempotent.

Local execution:

```powershell
npm run dev
npm run job -- --list
npm run job -- analytics.calculateIndicators
```

`JOB_SCHEDULER_TOKEN` must be present and match the local server configuration. The job sends no message,
creates no disciplinary finding, and closes no exception or investigation. No production scheduler is
configured.

## Exports, performance, and retention

CSV uses RFC-style quoting and prefixes cells beginning with `=`, `+`, `-`, `@`, tab, or carriage return
to prevent spreadsheet formula execution. It includes tenant period, applied-filter summary, data-quality
statement, metrics, indicators, and the human-review disclaimer. Indicator exports are capped at 5,000.

PDF includes tenant, reporting period, generation time/user, applied filters, data quality, tracker source
and limitation, metrics, explainable indicators, aggregated investigation data, disclaimer, and numbered
pages. Reports are tenant-owned `GOVERNANCE_ANALYTICS_REPORT` media and require a short-lived signed URL.

Dashboard/calculation source queries are bounded at 10,000, indicator tables at 100 per dashboard/list
page, list APIs at 100 per page, exports at 5,000, and date ranges at 366 days. Composite indexes cover
tenant/status/severity/time and tenant/subject lookup. Scale beyond these assumptions should use queued
snapshot tables or warehouse aggregation rather than raising limits indefinitely.

## Testing and known limitations

Phase 12 adds repository/integration coverage for time-zone dates, filter scope, permission and tenant
boundaries, rule versions, threshold snapshots, deterministic calculation, duplicate/concurrent retry,
cooldown, minimum samples, missing/mock data, workflow chronology, escalation/linkage, exports, PDF
disclosure, job overlap/retry, confidentiality, and absence of notifications/automatic findings. Chromium
also covers executive review/export/report, independent permission and foreign-ID isolation, and
escalation persistence.

Known limitations:

- production telematics/provider validation and route deviation remain Phase 13+ decisions;
- no production scheduler is configured;
- inspection duration is unavailable without a start timestamp;
- passenger/equipment discrepancies cannot be separately counted with the present schema;
- department remains free text;
- dashboard calculations are bounded operational aggregates, not a long-term data warehouse;
- system-default rule provenance has a null human configurator by design, while every human version names
  its actor.

Rollback requires application rollback plus a forward corrective migration. The Phase 12 tables can be
left unused safely; dropping them or the appended media enum value is destructive and must not be done on
a production database without a separately approved data-retention plan.

# Phase 15 business, legal and operational decisions

## Phase 17A biometric additions

Add explicit decisions for special-personal-information purpose/lawful authority, Information Officer approval, driver notice/alternative, retention and deletion, threshold, demographic bias/performance acceptance, provider/DPA/sub-processors/transfers, incident response, customer authorization, physical-device/human UAT acceptance, and named operating owner. Until recorded, `facial:readiness` remains blocked.

Engineering has not made these decisions for Genbridge. Recommended defaults are temporary fail-closed controls, not legal advice or vendor selection. Due dates, people and evidence are `MANUAL_CONFIRMATION_REQUIRED`.

| ID | Area | Exact decision required / why | Options | Recommended safe default | Owner | Due | Status/evidence | Impact / block |
|---|---|---|---|---|---|---|---|---|
| P15-001 | Pilot owner | Name accountable pilot/stop authority | Named executive/operator | Do not start | Business | MCR | MCR; written appointment | Pilot blocker |
| P15-002 | Product owner | Own scope, backlog and acceptance | Named owner/delegate | Freeze scope | Business | MCR | MCR; charter | Pilot blocker |
| P15-003 | Security owner | Own risk, access and incident controls | Named security lead | No real data | Security | MCR | MCR; approval | Staging/pilot blocker |
| P15-004 | Privacy/Information Officer | Confirm POPIA/PAIA responsibilities | Appointed IO/delegate | Synthetic only | IO/legal | MCR | MCR; appointment/assessment | Real-data blocker |
| P15-005 | Technical owner | Own architecture/release/migrations | Named engineer/team | No deployment | Technology | MCR | MCR; RACI | Staging blocker |
| P15-006 | Support owner | Own support queue/escalation/access | Named support lead | No live pilot | Operations | MCR | MCR; rota | Pilot blocker |
| P15-007 | Incident owner | Own severity/containment/notification | Named incident commander | Stop on Critical/High | Security/ops | MCR | MCR; plan | Staging blocker |
| P15-008 | UAT testers | Approve role-based roster/devices | Named synthetic testers | No human pass claimed | UAT lead | MCR | MCR; roster | Acceptance blocker |
| P15-009 | UAT approver | Independent acceptance authority | Business + security/technical | Pending | Business | MCR | MCR; sign-off | Acceptance blocker |
| P15-010 | Training approver | Confirm guides/attendance/competence | Role owners | Do not start real pilot | Operations | MCR | MCR; records | Pilot blocker |
| P15-011 | Hosting | Select target/account/region | Approved managed container/other | No target selected | Technology/security | MCR | MCR; architecture/contract | Staging blocker |
| P15-012 | Database | Select managed PostgreSQL/region/tier | Managed options | No target selected | Technology | MCR | MCR; SLA/restore | Staging blocker |
| P15-013 | Storage | Select private durable object store | S3-compatible approved target | Local only for dev/test | Technology/security | MCR | MCR; privacy/lifecycle proof | Staging blocker |
| P15-014 | Monitoring | Select redacted monitoring/retention | Approved platform | Disabled locally | Security/ops | MCR | MCR; alerts/access/retention | Staging blocker |
| P15-015 | Scheduler | Select service/cadences/owner | Platform/managed scheduler | Disabled until configured | Operations | MCR | MCR; job plan | Staging blocker |
| P15-016 | Email | Select provider/domain/templates/sink | No-op, staging sink, production vendor | No-op | Product/privacy | MCR | MCR; DPA/DNS/templates | Notification blocker |
| P15-017 | Billing | Select gateway/sandbox/commercial policy | Disabled, sandbox, approved gateway | Disabled | Finance/legal | MCR | MCR; contract/test | Billing blocker |
| P15-018 | Tracker | Select provider/sandbox/customer authorization | Ctrack/alternatives after evidence | Disabled/synthetic | Product/technical/legal | MCR | MCR; matrix/conformance | Live tracking blocker |
| P15-019 | Backup RPO/RTO | Approve recovery objectives/retention | Business-defined tiers | No hosted use until tested | Business/technology | MCR | MCR; restore evidence | Staging blocker |
| P15-020 | Support hours | Define coverage, channels and holidays | Business-hours/on-call | No SLA claim | Operations | MCR | MCR; support plan | Pilot blocker |
| P15-021 | Severity response | Define acknowledge/contain/resolve targets | Severity matrix | Critical/High stop test | Security/ops | MCR | MCR; incident plan | Pilot blocker |
| P15-022 | Retention | Approve each category/provider/backup period | Period by purpose/law | Existing safe defaults, no claim | IO/legal | MCR | MCR; schedule | Real-data blocker |
| P15-023 | Lawful bases | Decide each personal/location/biometric purpose | Legal assessment | No real/biometric data | IO/legal | MCR | MCR; assessment | Real-data blocker |
| P15-024 | Privacy notices | Approve transparent notices/rights/contact | Role/data-specific notices | Synthetic only | IO/legal | MCR | MCR; approved notice | Real-data blocker |
| P15-025 | Operator agreements/DPAs | Approve provider obligations/subprocessors | Approved agreements | No provider data | Legal/procurement | MCR | MCR; executed documents | Provider blocker |
| P15-026 | Cross-border | Approve regions/safeguards | Local/approved foreign processing | No target | IO/legal/security | MCR | MCR; transfer assessment | Provider/hosting blocker |
| P15-027 | Breach response | Contacts, assessment, regulator/subject process | Approved response plan | Contain/escalate, no claims | IO/security | MCR | MCR; exercised plan | Staging blocker |
| P15-028 | Data-subject requests | Identity, search/export/correct/delete/hold process | Central privacy workflow | No real data | IO/legal/ops | MCR | MCR; procedure/test | Real-data blocker |
| P15-029 | Pilot duration | Start/end/change window | Fixed dates/extension gate | Do not start | Pilot owner | MCR | MCR; charter | Pilot blocker |
| P15-030 | Success criteria | Quantitative/qualitative acceptance | UAT/ops/business measures | 27 cases pending | Product/pilot owner | MCR | MCR; scorecard | Pilot blocker |
| P15-031 | Rollback criteria | Define stop triggers/authority/recovery | Security/data/workflow thresholds | Stop on Critical/High/isolation | Pilot/incident owner | MCR | MCR; runbook | Pilot blocker |
| P15-032 | Commercial transition | Trial/pilot-to-paid scope/pricing/consent | End, extend, contract | No automatic conversion | Commercial/legal | MCR | MCR; contract | Commercial blocker |
| P15-033 | Customer offboarding | Export, revoke, delete, retain and evidence | Approved checklist | Disable/revoke; preserve lawful holds | Product/privacy/ops | MCR | MCR; tested procedure | Production blocker |

`MCR` = `MANUAL_CONFIRMATION_REQUIRED`. A decision is complete only when a named authorized owner, date, scope/version, evidence location and conditions are recorded in the approved system. Changing an environment flag alone is not approval.

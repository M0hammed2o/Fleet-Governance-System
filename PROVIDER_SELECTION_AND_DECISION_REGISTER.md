# Provider selection and decision register

Status date: 2026-08-12. No final provider is selected. The prompt reports approximately two weeks without a response; the repository contains no verified last-contact date, correspondence, official provider capability evidence, sandbox or pricing.

## Evaluation matrix

Legend: `UNKNOWN` means not verified; `NOT_PROVIDED` means requested evidence is absent; `MANUAL_CONFIRMATION_REQUIRED` means Genbridge must decide/approve.

| Provider candidate | Contact status | Last-contact date | Escalation contact | API | Sandbox | Docs | Auth | Polling | Webhooks | Locations | Trips | Fuel | Odometer | Driver ID | Geofences |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Ctrack | Awaiting response (~2 weeks, user-reported) | MANUAL_CONFIRMATION_REQUIRED | NOT_PROVIDED | UNKNOWN | UNKNOWN | NOT_PROVIDED | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Cartrack | Not contacted/UNKNOWN | MANUAL_CONFIRMATION_REQUIRED | NOT_PROVIDED | UNKNOWN | UNKNOWN | NOT_PROVIDED | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Netstar | Not contacted/UNKNOWN | MANUAL_CONFIRMATION_REQUIRED | NOT_PROVIDED | UNKNOWN | UNKNOWN | NOT_PROVIDED | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Tracker | Not contacted/UNKNOWN | MANUAL_CONFIRMATION_REQUIRED | NOT_PROVIDED | UNKNOWN | UNKNOWN | NOT_PROVIDED | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| MiX/Powerfleet | Not contacted/UNKNOWN | MANUAL_CONFIRMATION_REQUIRED | NOT_PROVIDED | UNKNOWN | UNKNOWN | NOT_PROVIDED | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Other approved candidate | Not identified | MANUAL_CONFIRMATION_REQUIRED | NOT_PROVIDED | UNKNOWN | UNKNOWN | NOT_PROVIDED | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |

| Candidate | History limits | Rate limits | SLA/support | Data ownership/POPIA | Cross-border | Retention/deletion | Customer authorization | Pricing/term | Certification | Decision | Blocking questions | Technical risk | Commercial risk | Legal/privacy risk |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Ctrack | UNKNOWN | UNKNOWN | NOT_PROVIDED | NOT_PROVIDED | UNKNOWN | NOT_PROVIDED | NOT_PROVIDED | NOT_PROVIDED | UNKNOWN | EVALUATION_BLOCKED | All questionnaire sections | HIGH until evidenced | HIGH until evidenced | HIGH until evidenced |
| Cartrack | UNKNOWN | UNKNOWN | NOT_PROVIDED | NOT_PROVIDED | UNKNOWN | NOT_PROVIDED | NOT_PROVIDED | NOT_PROVIDED | UNKNOWN | NOT_EVALUATED | All questionnaire sections | UNKNOWN | UNKNOWN | UNKNOWN |
| Netstar | UNKNOWN | UNKNOWN | NOT_PROVIDED | NOT_PROVIDED | UNKNOWN | NOT_PROVIDED | NOT_PROVIDED | NOT_PROVIDED | UNKNOWN | NOT_EVALUATED | All questionnaire sections | UNKNOWN | UNKNOWN | UNKNOWN |
| Tracker | UNKNOWN | UNKNOWN | NOT_PROVIDED | NOT_PROVIDED | UNKNOWN | NOT_PROVIDED | NOT_PROVIDED | NOT_PROVIDED | UNKNOWN | NOT_EVALUATED | All questionnaire sections | UNKNOWN | UNKNOWN | UNKNOWN |
| MiX/Powerfleet | UNKNOWN | UNKNOWN | NOT_PROVIDED | NOT_PROVIDED | UNKNOWN | NOT_PROVIDED | NOT_PROVIDED | NOT_PROVIDED | UNKNOWN | NOT_EVALUATED | All questionnaire sections | UNKNOWN | UNKNOWN | UNKNOWN |
| Other approved candidate | UNKNOWN | UNKNOWN | NOT_PROVIDED | NOT_PROVIDED | UNKNOWN | NOT_PROVIDED | NOT_PROVIDED | NOT_PROVIDED | UNKNOWN | NOT_IDENTIFIED | All questionnaire sections | UNKNOWN | UNKNOWN | UNKNOWN |

No row asserts a capability. Risk labels describe missing evidence, not provider quality.

## Decision record template

| Field | Required entry |
|---|---|
| Decision ID/date/version | Assigned by decision owner |
| Candidates and official evidence versions | Links/references in approved private system |
| Customer's existing tracker and authorization | Written evidence |
| Technical score and conformance evidence | Matrix plus test report |
| Security/privacy/legal/commercial approvals | Named owners, dates and conditions |
| Selected provider and rationale | MANUAL_CONFIRMATION_REQUIRED |
| Rejected alternatives and rationale | Evidence-based, not assumptions |
| Pilot/sandbox limits | Assets, dates, quotas and data classification |
| Rollback/termination/deletion | Owner, process and evidence |
| Revisit trigger | API/SLA/price/subprocessor/security/material scope change |

## Two-week non-response contingency

- Follow-up deadline: `MANUAL_CONFIRMATION_REQUIRED`; recommended safe operational default is within two business days after Genbridge approves the draft below.
- Escalation: existing account/customer representative → provider technical/API team → provider security/privacy/commercial contacts, only through Genbridge-approved channels.
- Parallel alternatives: procurement may send the same neutral questionnaire to approved alternatives; Engineering must not scrape portals or infer APIs.
- Minimum document gate: official API/webhook/schema/auth/rate-limit/history/error/versioning documents, sandbox terms, customer authorization, DPA/privacy/retention/deletion/subprocessor material, SLA/support and pricing.
- Minimum sandbox gate: isolated synthetic assets, revocable scoped credentials, documented quotas/reset, signed webhook or polling test path, no real customer data and provider support contact.
- Proof of concept: map synthetic assets; position/history; timestamps/units; paging; duplicate/out-of-order/late; outage/recovery; rate-limit; signature/replay; revocation; deletion; conformance pass.
- Reviews: technical conformance, security threat review, privacy/legal/DPA review and commercial approval are independent gates.
- Adapter time box: set only after documents arrive and scope is estimated; no deadline may justify bypassing controls.
- Fallback pilot: explicitly labelled local/staging synthetic tracker data or tracking disabled. It is not a live integration demonstration.

## Follow-up email draft — do not send from this repository

Subject: Follow-up: authorized tracker API and sandbox information for Genbridge evaluation

Hello,

We are following up on our request for official technical, security/privacy and commercial information for an authorized Genbridge evaluation. We have not connected to your service or inferred any API details. Please confirm the appropriate API/technical contact and provide the completed attached questionnaire, current official documentation, sandbox process and customer-authorization requirements.

Our minimum evaluation scope is provider-neutral: synthetic sandbox assets; current position and history; field/timestamp/unit definitions; polling and/or signed webhooks; pagination/rate limits; outage/error/retry behavior; credential rotation/revocation; data ownership, POPIA, processing locations, retention/deletion, subprocessors, SLA/support and pricing/term information.

Please do not send credentials by email. If evaluation is supported, identify the approved secure provisioning channel and relevant terms for Genbridge review. If your team is not the correct contact, please route this request through your approved internal process.

Regards,

`MANUAL_CONFIRMATION_REQUIRED: authorized Genbridge sender`

Attachment: `TRACKER_PROVIDER_REQUIREMENTS_AND_ONBOARDING.md` questionnaire section. This draft was not sent in Phase 15A.

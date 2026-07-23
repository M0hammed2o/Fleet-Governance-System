# MVP_SCOPE.md

## Included in Version 1
All 15 items in the "Version 1 complete only when a test company can…" list from the build brief
(section 15), backing all modules in section 7 (7.1–7.14). Full detail in `PRODUCT_REQUIREMENTS.md`.

**Scope expansion, 2026-07-23 (target: controlled real-customer pilot by October 2026):** the user
authorised extending V1 with a telematics *foundation* (provider-neutral interface + mock + manual
fallback + basic geofencing, GPS-001..006), sales-rep vehicle-use policies (POLICY-001/002), dispatch
workflow enhancements (DISPATCH-001..005), and a controlled platform support-access view (SUPPORT-001..004).
These are foundation-level builds, not production vendor integrations — see "Explicit exclusions" below.

## Deferred from Version 1 (do not build as complete modules)
Fuel purchasing/fraud analytics, full workshop management, work orders/technician scheduling, full
tyre-lifecycle/procurement, full procurement/supplier management, financial/profitability accounting,
predictive maintenance, custom facial-recognition models, custom AI damage-detection models, custom GPS
or ANPR hardware, digital twins, ESG reporting, native mobile apps, automated disciplinary conclusions,
full industry-specific modules, subscription billing, full investigation-case management. Extension points
are prepared (adapter interfaces, config-driven inspection templates) but these are not implemented.
Advanced telematics (multi-provider production connections, high-frequency maps, journey playback,
predictive analysis, deeper driver-behaviour analytics) is explicitly deferred past the October pilot.

## Explicit exclusions
- No production facial-recognition or telematics vendor integration — mock/interface only, blocked on a
  provider decision (`INTEGRATIONS.md`). October pilot target: one production telematics provider matched
  to the pilot customer's existing tracker, once selected.
- No SSO in V1 — architecture is SSO-ready (permission model is provider-agnostic) but no IdP integration
  is built.
- No production deployment performed without explicit sign-off (hard rule — irreversibility).
- No unrestricted/invisible platform support impersonation — support access is always through the audited
  `SupportAccessSession` mechanism (DECISIONS.md D-016), read-only by default.

## Assumptions
- Local development uses Docker Postgres, not a hosted Supabase project, until a hosting decision is made
  (avoids creating external accounts without approval).
- Single currency/timezone per tenant is sufficient for V1 (multi-currency-per-site not required).
- No dedicated Department entity in V1 — `Driver.department` is a plain string (D-006 in DECISIONS.md).

## Version 1 completion criteria
Exactly the 15-step workflow in build-brief section 15, reproduced in `PRODUCT_REQUIREMENTS.md` with a
requirement ID per step and an implementation-status column, kept current as work lands.

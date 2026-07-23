# MVP_SCOPE.md

## Included in Version 1
All 15 items in the "Version 1 complete only when a test company can…" list from the build brief
(section 15), backing all modules in section 7 (7.1–7.14). Full detail in `PRODUCT_REQUIREMENTS.md`.

## Deferred from Version 1 (do not build as complete modules)
Fuel purchasing/fraud analytics, full workshop management, work orders/technician scheduling, full
tyre-lifecycle/procurement, full procurement/supplier management, financial/profitability accounting,
predictive maintenance, custom facial-recognition models, custom AI damage-detection models, custom GPS
or ANPR hardware, digital twins, ESG reporting, native mobile apps, automated disciplinary conclusions,
full industry-specific modules. Extension points are prepared (adapter interfaces, config-driven
inspection templates) but these are not implemented.

## Explicit exclusions
- No production facial-recognition or telematics vendor integration — mock/interface only, blocked on a
  provider decision (`INTEGRATIONS.md`).
- No SSO in V1 — architecture is SSO-ready (permission model is provider-agnostic) but no IdP integration
  is built.
- No production deployment performed without explicit sign-off (hard rule — irreversibility).

## Assumptions
- Local development uses Docker Postgres, not a hosted Supabase project, until a hosting decision is made
  (avoids creating external accounts without approval).
- Single currency/timezone per tenant is sufficient for V1 (multi-currency-per-site not required).
- No dedicated Department entity in V1 — `Driver.department` is a plain string (D-006 in DECISIONS.md).

## Version 1 completion criteria
Exactly the 15-step workflow in build-brief section 15, reproduced in `PRODUCT_REQUIREMENTS.md` with a
requirement ID per step and an implementation-status column, kept current as work lands.

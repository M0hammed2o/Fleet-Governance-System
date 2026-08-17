# Phase 18A demonstration onboarding guide

## Safety boundary

This is a controlled, tenant-isolated demonstration. Use invented company, person, vehicle and location data only. Self-registration is disabled unless `DEMO_SELF_SERVICE_ENABLED=true`; production rejects it regardless of configuration. Staging additionally requires `DEMO_ENVIRONMENT_APPROVED=true`. No email, payment, live tracking or biometric provider is contacted.

Wherever the simulator is offered, its label is exact:

> SYNTHETIC BIOMETRIC TEST — NOT REAL FACIAL VERIFICATION

## Registration and resumption

1. Open `/register`, enter an invented company, workspace code and first administrator, accept both demonstration disclosures, then create the workspace.
2. Tenant, role catalogue, first approved Company Administrator, session, onboarding row and audit event are created in one serializable database transaction. Duplicate email/workspace outcomes use the same generic response.
3. The new session opens `/onboarding`. A later login checks the saved onboarding row and resumes the incomplete wizard.

## Eight saved steps

1. **Company:** legal/trading information, contact details and departments.
2. **Fleet plan:** declared fleet size and category totals. Totals must reconcile exactly.
3. **Sites and gates:** manually add sites, then tenant-owned gates.
4. **Vehicles:** add registration, fleet number, category, capacity, make/model, division, fuel and odometer. Truck capacity is conditional; a sales vehicle needs a department or employee assignment.
5. **Drivers:** add contact, department, licence issue/expiry and professional-permit data.
6. **Staff:** create local invitation records for supported roles. No email is sent. Guards remain pending until independently approved.
7. **Assignments:** select a driver and vehicle, record a reason and optionally make an explicit history-preserving reassignment.
8. **Review:** resolve incomplete sections, acknowledge synthetic boundaries and launch the dashboard.

Every step can be revisited with the keyboard, and **Save and continue later** persists the current step. Detail screens provide private image/document controls and richer fields after the base record exists.

## Permissions and privacy

The Company Administrator configures the demo workspace and master data. Existing roles remain separate: dispatch prepares movements; approved guards perform gate work; approving managers make independent decisions; fleet managers maintain master data; finance, investigators/auditors and executives receive their existing bounded views. Tenant IDs come from the authenticated server session, never request input. Private documents and images require permission, tenant ownership and short-lived signed access.

Driver photographs are ordinary private profile media. Uploading one never creates a facial template or enrolment.

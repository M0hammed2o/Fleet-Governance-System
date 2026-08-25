# Genbridge Fleet Governance — Customer Demonstration Runbook

**Environment:** SYNTHETIC CUSTOMER DEMONSTRATION — no real customer, employee, driver, vehicle, tracking or biometric data anywhere in this tenant.

**Live URL:** https://genbridge-fleet-governance.onrender.com
**Company:** Genbridge Demonstration Logistics (`genbridge-demo-logistics`)
**Login details:** `.data/private/demo-login-details.txt` (gitignored, local only — open it yourself, never shared)

Before you start: Render's free/starter tier can be slow on the very first request after a period of inactivity. **Load the login page and sign in once, a few minutes before the customer arrives**, so the app is warm.

---

## Sequence (15–20 minutes)

### 1. Log in as Company Administrator (~1 min)
Company: `genbridge-demo-logistics` · Email: `demo.admin@genbridge.co.za` · password from the credentials file.

### 2. Company onboarding and declared fleet composition (~2 min)
Navigate to **Onboarding**. Point out:
- Declared fleet size: **15 vehicles**
- Fleet composition breakdown (trucks, bakkies, van, sales vehicles, trailer)
- This demonstrates the onboarding wizard a real customer completes — 12 of the 15 are loaded into the system now; 3 remain as a deliberately incomplete example so you can show the "in-progress" state honestly if asked.

### 3. Dashboard (~2 min)
Navigate to **Dashboard**. Point out fleet totals, driver/vehicle assignment summary, open exceptions, recent gate activity, and licence/document expiry warnings.

### 4. Explain driver governance ratings (~1 min)
Explain the three-tier system before opening a driver: **Good standing** (green), **Review required** (yellow), **Serious attention** (red) — each with plain-language reasons, never an accusation of wrongdoing.

### 5. Open a green driver (~1 min)
**Drivers → Thabo Nkosi** (`live-demo-driver-1`). Shows: valid licence, valid permit, active assignment, "Good standing," synthetic biometric enrolment badge (`SYNTHETIC BIOMETRIC TEST — NOT REAL FACIAL VERIFICATION`).

### 6. Open a yellow driver and show the review reason (~2 min)
**Drivers → Precious Khoza** (`live-demo-driver-6`). Shows: missing employee number, missing contact details, professional permit under review — "Review required," with each factor individually explained.

### 7. Open a red driver and show the required corrective action (~2 min)
**Drivers → Andile Cele** (`live-demo-driver-8`). Shows: expired licence, expired professional permit — "Serious attention," with the recommended corrective actions listed per factor, and the disclaimer that this is an operational indicator, not a finding of misconduct.

### 8. Add or edit a vehicle (~2 min)
**Vehicles → DEMO-TRK-001** (`live-demo-vehicle-1`). Show the edit form. Point out the synthetic VIN prefix and the "no real asset" baseline-condition note.

### 9. Show truck tonnage and a sales-representative vehicle (~1 min)
- **DEMO-TRK-003**: 20-tonne heavy truck, currently under review.
- **DEMO-SALES-002**: sales-representative vehicle, unassigned — a legitimate "spare capacity" example, not a red flag.

### 10. Open a driver licence and assignment (~1 min)
On any driver detail page, show the compliance-documents panel (licence record, verification status, expiry) and the assignment-history panel (which vehicle, since when, who assigned it).

### 11. Show approved and pending security guards (~2 min)
**Staff**: `demo.guard@genbridge.co.za` (Approved, Central Depot Entrance) vs. `demo.guard.pending@genbridge.co.za` (Pending — cannot yet perform gate duties; a different authorised user must approve them, and no one can approve their own access).

### 12. Show a gate departure and return (~2 min)
Log in as `demo.guard@genbridge.co.za`, open **Gate**, walk through the departure/return flow structure. The two demo gate-event pairs (`live-demo-gate-event-normal-out/in`) show a clean completed cycle.

### 13. Show inspection evidence and audit history (~1 min)
On the driver or vehicle detail page: inspection outcomes, exceptions raised, resolution notes, and the audit chronology entry recorded when this demo tenant was provisioned.

### 14. Show synthetic tracking (~1 min)
**Vehicles → DEMO-TRK-001**. Point out the tracker-provenance label — explicitly marked `synthetic`, with the note that no real tracker provider (Netstar/Ctrack/MiX Powerfleet) is connected.

### 15. Show the synthetic facial-verification rehearsal (~1 min)
Back on Thabo Nkosi's driver page, open the biometric enrolment panel. The warning `SYNTHETIC BIOMETRIC TEST — NOT REAL FACIAL VERIFICATION` must be visible at all times this feature is shown.

### 16. Close honestly on tracker integration status (~1 min)
State plainly: live tracker-provider integration (Netstar, Ctrack, MiX/Powerfleet, or another provider) is **pending client-authorised API access and a provider decision** — everything shown today is a deterministic synthetic simulation of that integration point, not a live connection.

---

## Backup route if a screen is unavailable

If any single page is slow or briefly unavailable (Render cold start), fall back to:
1. Dashboard (almost always fastest to load, already cached from your warm-up).
2. Any driver detail page — the rating explanation carries most of the governance story on its own.
3. Vehicles list → any vehicle detail page for the tracking/synthetic-label story.

If the whole app is slow, mention once, matter-of-factly, that this is a local demonstration environment on a lower-tier hosting plan, and continue — do not apologize repeatedly or draw extra attention to it.

## What not to do
- Do not attempt real facial verification (no camera capture is expected to produce a real result — it is a synthetic simulator).
- Do not imply any live tracker provider is connected.
- Do not describe any driver's rating as a finding of dishonesty or fraud — the app's own disclaimer text already avoids this language; stay consistent with it.

# Driver and vehicle governance rating rules

## Purpose and boundary

Rule version `phase18a-driver-governance-v1` is a deterministic operational-review indicator. It is not artificial intelligence, a fraud score, a disciplinary finding, or evidence of dishonesty or misconduct. The detail view shows the calculation time, every contributing factor and a corrective action.

## Calculation

Each driver starts at 100. Deductions are additive and the result is clamped to 0–100.

| Factor | Deduction | Suggested action |
| --- | ---: | --- |
| Missing employee number / contact | 5 each | Complete authorised profile data |
| Missing licence / missing expiry | 20 / 15 | Record and verify licence |
| Expired / expires within 45 days | 35 / 15 | Renew before duty / start renewal |
| Professional permit expired | 25 | Renew and verify permit |
| Permit pending or suspended | 20 | Resolve status before applicable duty |
| Permit expiry missing / within 45 days | 10 / 10 | Record or renew |
| No current vehicle assignment | 5 | Assign only if expected on duty |
| Open Critical exceptions | 30 each, capped at 40 | Resolve or formally escalate |
| Open High exceptions | 15 each, capped at 30 | Review and resolve |
| Failed inspection items | 10 each, capped at 20 | Review corrective actions |
| Denied gate decisions | 15 each, capped at 30 | Review recorded reasons |
| Open departure/return discrepancies | 10 each, capped at 20 | Reconcile factual differences |
| Verified High/Critical driver indicators | 10 each, capped at 20 | Review source records |

Scores of 80–100 are **✓ Good standing** (green), 50–79 are **! Review required** (yellow), and 0–49 are **× Serious attention required** (red). Text and icons accompany colour everywhere.

Valid licences, valid applicable permits and an active assignment are displayed as positive factors with zero points; they explain why a record remains healthy without inflating its score. A rating is calculated from current stored facts on read, so correcting a record changes the next calculation predictably. Historical audit, assignment and operational records are not rewritten.

Vehicle health remains factual in Phase 18A: operational status, assignment, expiry, service, inspection, exception and tracker-provenance fields are shown separately. No opaque vehicle score was introduced merely to create a number.

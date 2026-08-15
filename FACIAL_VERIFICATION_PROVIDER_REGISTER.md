# Facial Verification Provider Register

| Candidate | Type | Current state | Real biometric processing | Network | Production allowed |
|---|---|---|---:|---:|---:|
| Genbridge deterministic biometric simulator | Contract test double | Implemented for development/test | No | No | No |
| Existing local browser/on-device engineering model | Local model foundation | Implemented, not approved/calibrated | Yes, if an operator uses a real face; prohibited in Phase 17A rehearsal | Model assets are local | No |
| Real provider or approved local model | To be selected | None selected or connected | Unknown | Unknown | No |

Every simulator interface and response must display `SYNTHETIC BIOMETRIC TEST — NOT REAL FACIAL VERIFICATION`. The simulator has no credentials and refuses production; staging requires both test-only approval and isolation flags.

Before registering a real provider, record legal entity, service/model and version, hosting regions, controller/operator roles, DPA, sub-processors, deletion SLA and proof, breach SLA, data residency/transfers, encryption/key custody, authentication, rate/availability limits, liveness/PAD standard, supported devices, threshold semantics, false-acceptance/rejection evidence, demographic testing, accessibility, retention behavior, incident contact, exit/export/deletion plan, cost owner, and approval dates. No field may be filled with a placeholder that implies approval.

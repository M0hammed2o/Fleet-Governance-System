export type InternalPilotReadinessStatus = "PASS" | "BLOCKED";

export interface InternalPilotEvidence {
  environment?: string;
  catalogueCaseCount?: number;
  automatedGate?: { commit?: string; passCount?: number; failedCount?: number; completedAt?: string };
  physicalAndroid?: { manufacturer?: string; model?: string; androidVersion?: string; serialHash?: string; apkSha256?: string; passed?: boolean; completedAt?: string };
  humanUat?: { completedCases?: number; failedCases?: number; blockedCases?: number; coordinator?: string; completedAt?: string };
  defects?: { criticalOpen?: number; highOpen?: number };
  signoffs?: Record<string, { name?: string; approved?: boolean; approvedAt?: string }>;
  handoverAuthorizer?: string;
  facialDisclosurePresent?: boolean;
  trackerDisclosurePresent?: boolean;
}

export interface InternalPilotReadinessItem {
  id: string;
  label: string;
  status: InternalPilotReadinessStatus;
  message: string;
}

const REQUIRED_SIGNOFFS = ["technicalOwner", "businessOwner", "securityPrivacyOwner", "uatCoordinator", "internalPilotApprover"] as const;

export function buildInternalPilotReadinessReport(evidence: InternalPilotEvidence) {
  const environmentAllowed = ["development", "test", "staging-test-only"].includes(evidence.environment ?? "");
  const automatedPass = !!evidence.automatedGate?.commit && (evidence.automatedGate?.passCount ?? 0) > 0 && evidence.automatedGate?.failedCount === 0;
  const physicalPass = evidence.physicalAndroid?.passed === true && !!evidence.physicalAndroid.model && !!evidence.physicalAndroid.androidVersion && /^[a-f0-9]{64}$/.test(evidence.physicalAndroid.serialHash ?? "") && /^[a-f0-9]{64}$/.test(evidence.physicalAndroid.apkSha256 ?? "");
  const humanPass = evidence.humanUat?.completedCases === 42 && evidence.humanUat.failedCases === 0 && evidence.humanUat.blockedCases === 0 && !!evidence.humanUat.coordinator;
  const defectPass = evidence.defects?.criticalOpen === 0 && evidence.defects?.highOpen === 0;
  const signoffMissing = REQUIRED_SIGNOFFS.filter((role) => !evidence.signoffs?.[role]?.approved || !evidence.signoffs?.[role]?.name || !evidence.signoffs?.[role]?.approvedAt);
  const items: InternalPilotReadinessItem[] = [
    { id: "environment", label: "Approved internal environment", status: environmentAllowed ? "PASS" : "BLOCKED", message: environmentAllowed ? `Internal execution environment: ${evidence.environment}.` : "Use development, test, or explicitly isolated staging-test-only; production is forbidden." },
    { id: "catalogue", label: "Complete rehearsal catalogue", status: evidence.catalogueCaseCount === 42 ? "PASS" : "BLOCKED", message: evidence.catalogueCaseCount === 42 ? "All 42 cases are catalogued." : "The combined 27 existing and 15 Phase 17A cases must validate." },
    { id: "automated", label: "Automated final gate evidence", status: automatedPass ? "PASS" : "BLOCKED", message: automatedPass ? `Passing evidence recorded for ${evidence.automatedGate!.commit}.` : "A passing automated gate tied to the candidate commit is required." },
    { id: "physical-android", label: "Physical Android verification", status: physicalPass ? "PASS" : "BLOCKED", message: physicalPass ? `${evidence.physicalAndroid!.manufacturer ?? "Android"} ${evidence.physicalAndroid!.model} on Android ${evidence.physicalAndroid!.androidVersion}.` : "A real authorized Android device result, hashed serial, and matching APK hash are required." },
    { id: "human-uat", label: "Internal synthetic human UAT", status: humanPass ? "PASS" : "BLOCKED", message: humanPass ? "All 42 cases have passing human execution evidence." : "Human UAT is incomplete; automated or simulated checks cannot satisfy it." },
    { id: "defects", label: "Critical and High defects", status: defectPass ? "PASS" : "BLOCKED", message: defectPass ? "No unresolved Critical or High defect is recorded." : "A reviewed defect register with zero open Critical and High defects is required." },
    { id: "facial-disclosure", label: "Facial-verification representation", status: evidence.facialDisclosurePresent ? "PASS" : "BLOCKED", message: evidence.facialDisclosurePresent ? "Synthetic facial verification is explicitly disclosed." : "The exact synthetic biometric disclosure must remain present." },
    { id: "tracker-disclosure", label: "Tracker representation", status: evidence.trackerDisclosurePresent ? "PASS" : "BLOCKED", message: evidence.trackerDisclosurePresent ? "Synthetic/imported tracker provenance is disclosed." : "Tracker data must remain explicitly labelled synthetic or imported." },
    { id: "signoffs", label: "Internal owner sign-offs", status: signoffMissing.length === 0 ? "PASS" : "BLOCKED", message: signoffMissing.length === 0 ? "All five required roles approved the candidate." : `Missing sign-off: ${signoffMissing.join(", ")}.` },
    { id: "handover", label: "Named Genbridge handover authorization", status: evidence.handoverAuthorizer?.trim() ? "PASS" : "BLOCKED", message: evidence.handoverAuthorizer?.trim() ? `Customer handover authorizer: ${evidence.handoverAuthorizer}.` : "A named Genbridge person must authorize customer handover." },
  ];
  return { ready: items.every((item) => item.status === "PASS"), items };
}

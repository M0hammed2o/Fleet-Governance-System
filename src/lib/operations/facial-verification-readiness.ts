export interface FacialVerificationReadinessItem {
  id: string;
  ready: boolean;
  message: string;
}

export interface FacialVerificationReadinessReport {
  activationReady: boolean;
  simulatorSelected: boolean;
  items: FacialVerificationReadinessItem[];
}

export class FacialVerificationActivationBlockedError extends Error {
  constructor(public readonly missingItemIds: string[]) {
    super("Facial verification is not approved for production activation.");
    this.name = "FacialVerificationActivationBlockedError";
  }
}

type ReadinessInput = Record<string, string | undefined>;

const REQUIRED_CONFIRMATIONS = [
  ["provider-or-model", "FACIAL_PROVIDER_APPROVED", "Approved provider or approved local model"],
  ["contract-dpa", "FACIAL_PROVIDER_DPA_EXECUTED", "Executed provider contract/DPA where required"],
  ["popia-decision", "FACIAL_POPIA_DECISION_APPROVED", "Approved POPIA biometric-processing decision"],
  ["information-officer", "FACIAL_INFORMATION_OFFICER_APPROVED", "Information Officer approval"],
  ["retention", "FACIAL_RETENTION_APPROVED", "Approved biometric retention and deletion schedule"],
  ["thresholds", "FACIAL_THRESHOLDS_APPROVED", "Approved verification and review thresholds"],
  ["bias-performance", "FACIAL_BIAS_PERFORMANCE_TESTED", "Bias and performance evaluation completed"],
  ["customer-authorization", "FACIAL_CUSTOMER_AUTHORIZED", "Customer authorization"],
  ["driver-authority", "FACIAL_DRIVER_AUTHORITY_APPROVED", "Driver notice/consent or alternative lawful authority"],
  ["credentials", "FACIAL_PRODUCTION_CREDENTIALS_CONFIGURED", "Production credentials configured outside source control"],
  ["encryption", "FACIAL_ENCRYPTION_KEYS_CONFIGURED", "Production encryption keys and rotation procedure"],
  ["incident", "FACIAL_INCIDENT_PROCEDURE_APPROVED", "Approved biometric incident procedure"],
  ["physical-device", "FACIAL_PHYSICAL_DEVICE_TESTED", "Physical Android-device verification completed"],
  ["human-uat", "FACIAL_HUMAN_UAT_APPROVED", "Human UAT completed and approved"],
  ["operational-owner", "FACIAL_OPERATIONAL_OWNER_NAMED", "Named operational owner"],
] as const;

export function buildFacialVerificationReadinessReport(
  input: ReadinessInput,
): FacialVerificationReadinessReport {
  const provider = input.FACIAL_VERIFICATION_PROVIDER?.trim().toLowerCase() ?? "disabled";
  const simulatorSelected = ["mock", "simulator", "synthetic", "disabled", ""].includes(provider);
  const items: FacialVerificationReadinessItem[] = [
    {
      id: "environment",
      ready: input.APP_ENV === "production",
      message: "Activation evaluation must run against an explicit production configuration.",
    },
    {
      id: "real-provider",
      ready: !simulatorSelected,
      message: "A simulator, mock, synthetic or disabled provider can never satisfy production activation.",
    },
    ...REQUIRED_CONFIRMATIONS.map(([id, variable, message]) => ({
      id,
      ready: input[variable] === "true",
      message,
    })),
  ];
  return {
    activationReady: items.every((item) => item.ready),
    simulatorSelected,
    items,
  };
}

export function assertFacialVerificationRuntimeAllowed(
  input: ReadinessInput,
): void {
  if (input.APP_ENV !== "production") return;
  const report = buildFacialVerificationReadinessReport(input);
  if (!report.activationReady) {
    throw new FacialVerificationActivationBlockedError(
      report.items.filter((item) => !item.ready).map((item) => item.id),
    );
  }
}

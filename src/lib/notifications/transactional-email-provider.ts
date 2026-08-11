import "server-only";

export type EmailFailureClassification = "NOT_CONFIGURED" | "AUTHENTICATION" | "RATE_LIMIT" | "TIMEOUT" | "REJECTED" | "INVALID_RECIPIENT" | "UNKNOWN";

export interface TransactionalEmailInput {
  templateId: string;
  recipient: string;
  subjectData: Record<string, string>;
  templateVariables: Record<string, string | number | boolean | null>;
  correlationId: string;
  idempotencyKey: string;
  unsubscribe: "NOT_APPLICABLE" | "TRANSACTIONAL_PREFERENCES";
}

export interface TransactionalEmailResult {
  provider: string;
  delivered: boolean;
  duplicate: boolean;
  providerMessageReference: string | null;
  failureClassification: EmailFailureClassification | null;
  retryEligible: boolean;
  auditMetadata: { templateId: string; recipientDomain: string; correlationId: string };
}

export interface TransactionalEmailProvider {
  readonly providerId: string;
  readonly isProductionCapable: boolean;
  send(input: TransactionalEmailInput): Promise<TransactionalEmailResult>;
}

function auditMetadata(input: TransactionalEmailInput) {
  return { templateId: input.templateId, recipientDomain: input.recipient.split("@")[1] ?? "invalid", correlationId: input.correlationId };
}

export class NoOpTransactionalEmailProvider implements TransactionalEmailProvider {
  readonly providerId: string;
  readonly isProductionCapable = false;
  constructor(providerId = "noop") { this.providerId = providerId; }
  async send(input: TransactionalEmailInput): Promise<TransactionalEmailResult> {
    return { provider: this.providerId, delivered: false, duplicate: false, providerMessageReference: null, failureClassification: "NOT_CONFIGURED", retryEligible: false, auditMetadata: auditMetadata(input) };
  }
}

export class SyntheticTransactionalEmailProvider implements TransactionalEmailProvider {
  readonly providerId = "synthetic";
  readonly isProductionCapable = false;
  private readonly deliveries = new Map<string, TransactionalEmailResult>();
  async send(input: TransactionalEmailInput): Promise<TransactionalEmailResult> {
    const existing = this.deliveries.get(input.idempotencyKey);
    if (existing) return { ...existing, duplicate: true };
    const result: TransactionalEmailResult = {
      provider: this.providerId,
      delivered: true,
      duplicate: false,
      providerMessageReference: `synthetic:${input.idempotencyKey}`,
      failureClassification: null,
      retryEligible: false,
      auditMetadata: auditMetadata(input),
    };
    this.deliveries.set(input.idempotencyKey, result);
    return result;
  }
  deliveryCount(): number { return this.deliveries.size; }
}

export function genericEmailSubject(kind: "INVOICE" | "INVESTIGATION" | "RETENTION"): string {
  if (kind === "INVOICE") return "A billing document is available";
  if (kind === "INVESTIGATION") return "A governance workflow requires your attention";
  return "A data-retention action may be required";
}

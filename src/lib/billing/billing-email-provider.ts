/**
 * Phase 10 (P10H) — invoice-email delivery abstraction, the same
 * provider-neutral pattern as `RetentionNotificationProvider` (Phase
 * 8E-003): a dev-console mock that never sends a real external email, plus
 * an honest no-op for when no production email vendor is configured. A
 * real provider (e.g. an existing transactional-email vendor) can be added
 * later as a third implementation without touching invoice/payment logic.
 */

export interface BillingEmailInput {
  to: string;
  invoiceNumber: string;
  subject: string;
  bodyText: string;
  pdfFileName: string;
  pdfBytes: Buffer;
}

export interface BillingEmailSendResult {
  provider: string;
  delivered: boolean;
  errorMessage?: string;
}

export interface BillingEmailProvider {
  readonly name: string;
  send(input: BillingEmailInput): Promise<BillingEmailSendResult>;
}

/** Honest failure — reports no production email provider configured, never fabricates delivery. */
export class NoOpBillingEmailProvider implements BillingEmailProvider {
  readonly name = "noop";
  async send(_input: BillingEmailInput): Promise<BillingEmailSendResult> {
    void _input;
    return { provider: this.name, delivered: false, errorMessage: "No production billing-email provider is configured." };
  }
}

/**
 * Dev/test provider: logs the email safely to the server console (subject,
 * recipient, invoice number, PDF byte size — never the full PDF content or
 * any secret) and records it as "delivered" for workflow-testing purposes.
 * Never sends a real external email, in any environment.
 */
export class MockBillingEmailProvider implements BillingEmailProvider {
  readonly name = "mock";
  private sent: BillingEmailInput[] = [];

  async send(input: BillingEmailInput): Promise<BillingEmailSendResult> {
    this.sent.push(input);
    console.log(`[MockBillingEmailProvider] would send "${input.subject}" to ${input.to} (invoice ${input.invoiceNumber}, PDF ${input.pdfBytes.byteLength} bytes)`);
    return { provider: this.name, delivered: true };
  }

  /** Test/dev-console helper — never exposes the PDF bytes, only the metadata a developer needs to confirm the workflow fired. */
  getSentSummaries(): Array<{ to: string; invoiceNumber: string; subject: string }> {
    return this.sent.map((s) => ({ to: s.to, invoiceNumber: s.invoiceNumber, subject: s.subject }));
  }
}

let cachedProvider: BillingEmailProvider | null = null;

/** `BILLING_EMAIL_PROVIDER=mock` for dev/test; anything else (including unset) is the honest NoOp. */
export function getDefaultBillingEmailProvider(): BillingEmailProvider {
  if (cachedProvider) return cachedProvider;
  cachedProvider = process.env.BILLING_EMAIL_PROVIDER === "mock" ? new MockBillingEmailProvider() : new NoOpBillingEmailProvider();
  return cachedProvider;
}

/**
 * Phase 10 (P10F) — payment-provider abstraction, following the exact
 * established pattern (`FacialVerificationProvider`, `TelematicsProvider`,
 * `ObjectStorageProvider`, `RetentionNotificationProvider`,
 * `CloudLivenessProvider`): a provider-neutral interface plus a safe no-op
 * (reports no production provider configured, never fabricates success)
 * and a deterministic mock (dev/test only, never contacts a real external
 * service). A real gateway (PayFast/Peach Payments/Yoco/Stitch) can be
 * added later as a third implementation of this same interface without
 * touching subscription/invoice logic — see INTEGRATIONS.md.
 */

export type PaymentProviderPaymentStatus = "PENDING" | "SUCCESSFUL" | "FAILED";

export interface CreateCheckoutSessionInput {
  /** Idempotency reference — calling this twice with the same value must never create two checkout sessions/attempts at the provider. */
  idempotencyKey: string;
  invoiceId: string;
  amountMinorUnits: number;
  currency: string;
  description: string;
  /** Where the provider should send the customer back after payment (mock/no-op providers never navigate anywhere real). */
  returnUrl: string;
}

export interface CheckoutSession {
  provider: string;
  providerReference: string;
  checkoutUrl: string | null;
  status: PaymentProviderPaymentStatus;
}

export interface PaymentStatusResult {
  providerReference: string;
  status: PaymentProviderPaymentStatus;
  amountMinorUnits: number;
  currency: string;
}

export interface PaymentProviderCapabilities {
  checkout: boolean;
  recurringSubscriptions: boolean;
  cancellation: boolean;
  reactivation: boolean;
  refunds: boolean;
  reconciliation: boolean;
}

export interface BillingCustomerResult { providerCustomerReference: string; }
export interface ProviderSubscriptionResult {
  providerSubscriptionReference: string;
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED";
  billingCycleStart: Date;
  billingCycleEnd: Date;
}

export interface WebhookEvent {
  provider: string;
  externalEventId: string;
  eventType: string;
  providerReference: string | null;
  status: PaymentProviderPaymentStatus | null;
  amountMinorUnits: number | null;
  currency: string | null;
  raw: unknown;
}

export class PaymentProviderUnavailableError extends Error {
  constructor(provider: string) {
    super(`Payment provider "${provider}" is not configured for production use. No payment can be processed.`);
    this.name = "PaymentProviderUnavailableError";
  }
}

export class InvalidWebhookSignatureError extends Error {
  constructor(provider: string) {
    super(`Webhook signature/authenticity check failed for provider "${provider}".`);
    this.name = "InvalidWebhookSignatureError";
  }
}

export interface PaymentProvider {
  readonly name: string;
  /** True for a provider that can actually process a real payment; false for NoOp. */
  readonly isProductionCapable: boolean;
  readonly capabilities: PaymentProviderCapabilities;

  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession>;
  getPaymentStatus(providerReference: string): Promise<PaymentStatusResult>;
  /** Verifies the request genuinely came from this provider (signature/secret check) before any event is trusted — never trust a browser-supplied success without this. */
  validateWebhookAuthenticity(rawBody: string, headers: Record<string, string | undefined>): boolean;
  parseWebhookEvent(rawBody: string, headers: Record<string, string | undefined>): WebhookEvent;
  /** Optional — returns null when refunds are not supported by this provider/phase (explicitly deferred, per P10F). */
  refund(providerReference: string, amountMinorUnits: number): Promise<{ providerReference: string; status: PaymentProviderPaymentStatus } | null>;
  upsertCustomer(input: { idempotencyKey: string; tenantReference: string }): Promise<BillingCustomerResult>;
  upsertSubscription(input: { idempotencyKey: string; providerCustomerReference: string; planReference: string; trialEndsAt: Date | null }): Promise<ProviderSubscriptionResult>;
  cancelSubscription(providerSubscriptionReference: string, effectiveAt: Date): Promise<ProviderSubscriptionResult>;
  reactivateSubscription(providerSubscriptionReference: string): Promise<ProviderSubscriptionResult>;
  reconcilePayment(providerReference: string): Promise<PaymentStatusResult>;
}

/**
 * Reports "no production payment provider is configured" honestly on every
 * call — never fabricates a successful payment. This is what runs if
 * `PAYMENT_PROVIDER` is unset/misconfigured in an environment that expects
 * a real gateway.
 */
export class NoOpPaymentProvider implements PaymentProvider {
  readonly name: string;
  readonly isProductionCapable = false;
  readonly capabilities = { checkout: false, recurringSubscriptions: false, cancellation: false, reactivation: false, refunds: false, reconciliation: false };

  constructor(name = "noop") {
    this.name = name;
  }

  async createCheckoutSession(): Promise<CheckoutSession> {
    throw new PaymentProviderUnavailableError(this.name);
  }
  async getPaymentStatus(): Promise<PaymentStatusResult> {
    throw new PaymentProviderUnavailableError(this.name);
  }
  validateWebhookAuthenticity(): boolean {
    return false;
  }
  parseWebhookEvent(): WebhookEvent {
    throw new PaymentProviderUnavailableError(this.name);
  }
  async refund(): Promise<null> {
    return null;
  }
  async upsertCustomer(input: { idempotencyKey: string; tenantReference: string }): Promise<BillingCustomerResult> { void input; throw new PaymentProviderUnavailableError(this.name); }
  async upsertSubscription(input: { idempotencyKey: string; providerCustomerReference: string; planReference: string; trialEndsAt: Date | null }): Promise<ProviderSubscriptionResult> { void input; throw new PaymentProviderUnavailableError(this.name); }
  async cancelSubscription(providerSubscriptionReference: string, effectiveAt: Date): Promise<ProviderSubscriptionResult> { void providerSubscriptionReference; void effectiveAt; throw new PaymentProviderUnavailableError(this.name); }
  async reactivateSubscription(providerSubscriptionReference: string): Promise<ProviderSubscriptionResult> { void providerSubscriptionReference; throw new PaymentProviderUnavailableError(this.name); }
  async reconcilePayment(providerReference: string): Promise<PaymentStatusResult> { void providerReference; throw new PaymentProviderUnavailableError(this.name); }
}

interface MockSessionRecord {
  providerReference: string;
  invoiceId: string;
  amountMinorUnits: number;
  currency: string;
  status: PaymentProviderPaymentStatus;
}

/**
 * Deterministic, in-memory dev/test provider — never contacts any real
 * external service. The outcome is controlled entirely by the caller via
 * `description`/a forced-outcome suffix on the idempotency key (mirrors the
 * existing `force:<outcome>` convention already used by
 * `MockTelematicsProvider`), so tests can exercise SUCCESSFUL/FAILED/
 * PENDING deterministically rather than relying on randomness.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";
  readonly isProductionCapable = false;
  readonly capabilities = { checkout: true, recurringSubscriptions: true, cancellation: true, reactivation: true, refunds: true, reconciliation: true };

  private sessions = new Map<string, MockSessionRecord>();
  private webhookSecret = "mock-webhook-secret";

  private forcedOutcomeFor(idempotencyKey: string): PaymentProviderPaymentStatus {
    if (idempotencyKey.includes("force:failed")) return "FAILED";
    if (idempotencyKey.includes("force:pending")) return "PENDING";
    return "SUCCESSFUL";
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
    const existing = this.sessions.get(input.idempotencyKey);
    if (existing) {
      return { provider: this.name, providerReference: existing.providerReference, checkoutUrl: null, status: existing.status };
    }
    const providerReference = `mock_${input.idempotencyKey}`;
    const status = this.forcedOutcomeFor(input.idempotencyKey);
    this.sessions.set(input.idempotencyKey, { providerReference, invoiceId: input.invoiceId, amountMinorUnits: input.amountMinorUnits, currency: input.currency, status });
    return { provider: this.name, providerReference, checkoutUrl: null, status };
  }

  async getPaymentStatus(providerReference: string): Promise<PaymentStatusResult> {
    const record = Array.from(this.sessions.values()).find((s) => s.providerReference === providerReference);
    if (!record) throw new Error(`No mock session found for reference "${providerReference}".`);
    return { providerReference, status: record.status, amountMinorUnits: record.amountMinorUnits, currency: record.currency };
  }

  validateWebhookAuthenticity(rawBody: string, headers: Record<string, string | undefined>): boolean {
    return headers["x-mock-signature"] === this.webhookSecret;
  }

  parseWebhookEvent(rawBody: string): WebhookEvent {
    const parsed = JSON.parse(rawBody) as { externalEventId: string; eventType: string; providerReference: string; status: PaymentProviderPaymentStatus; amountMinorUnits: number; currency: string };
    return {
      provider: this.name,
      externalEventId: parsed.externalEventId,
      eventType: parsed.eventType,
      providerReference: parsed.providerReference,
      status: parsed.status,
      amountMinorUnits: parsed.amountMinorUnits,
      currency: parsed.currency,
      raw: parsed,
    };
  }

  async refund(providerReference: string): Promise<{ providerReference: string; status: PaymentProviderPaymentStatus } | null> {
    return { providerReference, status: "SUCCESSFUL" };
  }

  async upsertCustomer(input: { idempotencyKey: string; tenantReference: string }): Promise<BillingCustomerResult> {
    return { providerCustomerReference: `mock_customer_${input.tenantReference}` };
  }

  private subscription(providerSubscriptionReference: string, status: ProviderSubscriptionResult["status"]): ProviderSubscriptionResult {
    const start = new Date("2026-08-01T00:00:00.000Z");
    return { providerSubscriptionReference, status, billingCycleStart: start, billingCycleEnd: new Date("2026-09-01T00:00:00.000Z") };
  }

  async upsertSubscription(input: { idempotencyKey: string; providerCustomerReference: string; planReference: string; trialEndsAt: Date | null }): Promise<ProviderSubscriptionResult> {
    return this.subscription(`mock_subscription_${input.providerCustomerReference}_${input.planReference}`, input.trialEndsAt ? "TRIAL" : "ACTIVE");
  }
  async cancelSubscription(providerSubscriptionReference: string, effectiveAt: Date): Promise<ProviderSubscriptionResult> { void effectiveAt; return this.subscription(providerSubscriptionReference, "CANCELLED"); }
  async reactivateSubscription(providerSubscriptionReference: string): Promise<ProviderSubscriptionResult> { return this.subscription(providerSubscriptionReference, "ACTIVE"); }
  async reconcilePayment(providerReference: string): Promise<PaymentStatusResult> { return this.getPaymentStatus(providerReference); }

  /** Test/dev helper — builds a webhook payload+headers pair matching this provider's own signature rule. */
  buildWebhookRequest(event: { externalEventId: string; eventType: string; providerReference: string; status: PaymentProviderPaymentStatus; amountMinorUnits: number; currency: string }): { rawBody: string; headers: Record<string, string> } {
    return { rawBody: JSON.stringify(event), headers: { "x-mock-signature": this.webhookSecret } };
  }
}

let cachedProvider: PaymentProvider | null = null;

/** `PAYMENT_PROVIDER=mock` for dev/test; anything else (including unset) is the honest NoOp — never a fabricated production integration (standing instruction). */
export function getDefaultPaymentProvider(): PaymentProvider {
  if (cachedProvider) return cachedProvider;
  const selected = process.env.PAYMENT_PROVIDER ?? "noop";
  if (selected === "mock" && process.env.APP_ENV !== "production") {
    cachedProvider = new MockPaymentProvider();
  } else {
    // `payfast` names the future boundary only. Until an official adapter
    // and credentials exist it remains an honest fail-closed provider.
    cachedProvider = new NoOpPaymentProvider(selected);
  }
  return cachedProvider;
}

import { describe, expect, it, vi } from "vitest";
import { genericEmailSubject, NoOpTransactionalEmailProvider, SyntheticTransactionalEmailProvider } from "@/lib/notifications/transactional-email-provider";
import { MockPaymentProvider, NoOpPaymentProvider } from "@/lib/billing/payment-provider";
import { InvalidPaymentReturnUrlError, validatePaymentReturnUrl } from "@/lib/repositories/payment-repository";
import {
  callTrackerWithPolicy,
  classifyTrackerFreshness,
  SyntheticTrackerAdapter,
  TrackerProviderError,
  UnsupportedTrackerCapabilityError,
  validateVehicleMapping,
  type TrackerConnectionContext,
} from "@/lib/telematics/integration-contract";

const connection: TrackerConnectionContext = {
  tenantId: "tenant-a",
  connectionId: "connection-a",
  providerId: "synthetic",
  customerAuthorizationReference: "synthetic-authorisation",
  credentialVersion: 1,
};

describe("tracker provider-neutral contract", () => {
  it("discovers capabilities and handles unsupported capabilities explicitly", async () => {
    const adapter = new SyntheticTrackerAdapter();
    expect(adapter.capabilities()).toContain("LATEST_POSITION");
    expect(adapter.capabilities()).not.toContain("TRIPS");
    await expect(adapter.listEvents(connection, "TRIPS", null, 20, { correlationId: "test", signal: new AbortController().signal })).rejects.toBeInstanceOf(UnsupportedTrackerCapabilityError);
  });

  it("classifies mock freshness honestly", () => {
    const now = new Date("2026-08-11T12:00:00.000Z");
    expect(classifyTrackerFreshness(now, now)).toBe("FRESH");
    expect(classifyTrackerFreshness(new Date("2026-08-11T10:00:00.000Z"), now)).toBe("STALE");
    expect(classifyTrackerFreshness(null, now)).toBe("UNAVAILABLE");
  });

  it("bounds retries, applies backoff, propagates one correlation id, and normalises errors", async () => {
    const sleep = vi.fn(async () => undefined);
    const correlations: string[] = [];
    let calls = 0;
    const result = await callTrackerWithPolicy({
      correlationId: "correlation-safe",
      policy: { maxAttempts: 3, timeoutMs: 500, backoffMs: () => 10 },
      sleep,
      operation: async ({ correlationId }) => {
        correlations.push(correlationId);
        calls += 1;
        if (calls < 3) throw new TrackerProviderError("RATE_LIMIT", "Synthetic rate limit", true);
        return "ok";
      },
    });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(new Set(correlations)).toEqual(new Set(["correlation-safe"]));
  });

  it("times out and never exceeds the configured attempt bound", async () => {
    let calls = 0;
    await expect(callTrackerWithPolicy({
      policy: { maxAttempts: 2, timeoutMs: 100, backoffMs: () => 0 },
      sleep: async () => undefined,
      operation: async () => { calls += 1; return new Promise<string>(() => undefined); },
    })).rejects.toMatchObject({ classification: "TIMEOUT" });
    expect(calls).toBe(2);
  });

  it("enforces tenant/provider mapping boundaries and revocation", async () => {
    const adapter = new SyntheticTrackerAdapter();
    expect(() => validateVehicleMapping(connection, "tenant-b", "synthetic", "asset-1")).toThrow(/does not belong/);
    expect(() => validateVehicleMapping(connection, "tenant-a", "synthetic", "asset-1")).not.toThrow();
    await adapter.writePollingCheckpoint(connection, "cursor-1");
    expect(await adapter.readPollingCheckpoint(connection)).toBe("cursor-1");
    await adapter.revoke(connection);
    expect(await adapter.connectionStatus(connection)).toBe("REVOKED");
    await expect(adapter.latestPosition(connection, "asset-1", { correlationId: "safe", signal: new AbortController().signal })).rejects.toMatchObject({ classification: "REVOKED" });
  });
});

describe("transactional email contract", () => {
  const email = { templateId: "invoice-ready", recipient: "person@example.test", subjectData: {}, templateVariables: {}, correlationId: "corr-1", idempotencyKey: "delivery-1", unsubscribe: "NOT_APPLICABLE" as const };
  it("never sends from the no-op provider and exposes audit-safe metadata only", async () => {
    const result = await new NoOpTransactionalEmailProvider().send(email);
    expect(result).toMatchObject({ delivered: false, retryEligible: false, failureClassification: "NOT_CONFIGURED", auditMetadata: { recipientDomain: "example.test" } });
    expect(JSON.stringify(result)).not.toContain("person@example.test");
  });
  it("deduplicates synthetic delivery without contacting a real provider", async () => {
    const provider = new SyntheticTransactionalEmailProvider();
    expect((await provider.send(email)).duplicate).toBe(false);
    expect((await provider.send(email)).duplicate).toBe(true);
    expect(provider.deliveryCount()).toBe(1);
    expect(provider.isProductionCapable).toBe(false);
  });
  it("uses generic subjects without sensitive case or invoice details", () => {
    expect(genericEmailSubject("INVESTIGATION")).toBe("A governance workflow requires your attention");
    expect(genericEmailSubject("INVOICE")).not.toMatch(/INV-|case|allegation/i);
  });
});

describe("payment provider contract", () => {
  it("represents customer/subscription lifecycle, reconciliation and refund support synthetically", async () => {
    const provider = new MockPaymentProvider();
    const customer = await provider.upsertCustomer({ idempotencyKey: "customer-1", tenantReference: "tenant-a" });
    const subscription = await provider.upsertSubscription({ idempotencyKey: "subscription-1", providerCustomerReference: customer.providerCustomerReference, planReference: "pilot", trialEndsAt: null });
    expect(subscription.status).toBe("ACTIVE");
    expect((await provider.cancelSubscription(subscription.providerSubscriptionReference, new Date())).status).toBe("CANCELLED");
    expect((await provider.reactivateSubscription(subscription.providerSubscriptionReference)).status).toBe("ACTIVE");
    expect(provider.capabilities.reconciliation).toBe(true);
  });
  it("keeps the PayFast boundary disabled and fail-closed", async () => {
    const provider = new NoOpPaymentProvider("payfast");
    expect(provider.isProductionCapable).toBe(false);
    await expect(provider.upsertCustomer({ idempotencyKey: "x", tenantReference: "tenant-a" })).rejects.toThrow(/not configured/);
  });
  it("rejects open redirects and accepts only the configured application origin", () => {
    expect(validatePaymentReturnUrl("https://app.example.test/billing", "https://app.example.test")).toBe("https://app.example.test/billing");
    expect(() => validatePaymentReturnUrl("https://evil.example/steal", "https://app.example.test")).toThrow(InvalidPaymentReturnUrlError);
    expect(() => validatePaymentReturnUrl("javascript:alert(1)", "https://app.example.test")).toThrow(InvalidPaymentReturnUrlError);
  });
});

import { describe, expect, it, vi } from "vitest";
import { DisconnectedMutationError, GenbridgeMobileClient, MobileApiError } from "@genbridge/api-client";

function tokenStore(initial: string | null = "token_value_abcdefghijklmnopqrstuvwxyz") {
  let token = initial;
  return { async get() { return token; }, async set(value: string) { token = value; }, async clear() { token = null; }, value: () => token };
}

describe("mobile API client", () => {
  it("uses the bearer token, server response and idempotency key for mutations", async () => {
    const tokens = tokenStore();
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${tokens.value()}`);
      expect(headers.get("idempotency-key")).toBe("guard-action-0001");
      return new Response(JSON.stringify({ gateEvent: { id: "event-1", status: "CLEARED" } }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const client = new GenbridgeMobileClient("http://127.0.0.1:3000", tokens, { isOnline: () => true }, fetcher as typeof fetch);
    const result = await client.gateAction("event-1", { action: "CLEAR" }, "guard-action-0001");
    expect(result).toEqual({ gateEvent: { id: "event-1", status: "CLEARED" } });
  });

  it("prevents critical mutations while disconnected", async () => {
    const client = new GenbridgeMobileClient("http://localhost:3000", tokenStore(), { isOnline: () => false }, vi.fn() as typeof fetch);
    await expect(client.movementDecision("movement-1", "APPROVE", "Reviewed", "decision-0001")).rejects.toBeInstanceOf(DisconnectedMutationError);
    await expect(
      client.decideFacialFallback("fallback-1", "APPROVED", "fallback-0001"),
    ).rejects.toBeInstanceOf(DisconnectedMutationError);
  });

  it("sends synthetic scenario and manager fallback decisions through distinct idempotent endpoints", async () => {
    const calls: Array<{ url: string; body: unknown; key: string | null }> = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
        key: new Headers(init?.headers).get("idempotency-key"),
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const client = new GenbridgeMobileClient(
      "http://localhost:3000",
      tokenStore(),
      { isOnline: () => true },
      fetcher as typeof fetch,
    );
    await client.gateAction(
      "event-1",
      { action: "SYNTHETIC_IDENTITY_VERIFY", scenario: "LIVENESS_FAILURE" },
      "facial-attempt-0001",
    );
    await client.decideFacialFallback(
      "fallback-1",
      "DENIED",
      "fallback-decision-0001",
    );
    expect(calls).toEqual([
      expect.objectContaining({
        url: "http://localhost:3000/api/mobile/gate/events/event-1/actions",
        body: { action: "SYNTHETIC_IDENTITY_VERIFY", scenario: "LIVENESS_FAILURE" },
        key: "facial-attempt-0001",
      }),
      expect.objectContaining({
        url: "http://localhost:3000/api/mobile/facial-verification/fallbacks/fallback-1/decision",
        body: { decision: "DENIED" },
        key: "fallback-decision-0001",
      }),
    ]);
  });

  it("clears the local token when the server reports expiry or revocation", async () => {
    const tokens = tokenStore();
    const client = new GenbridgeMobileClient("http://localhost:3000", tokens, { isOnline: () => true }, vi.fn(async () => new Response(JSON.stringify({ error: "Session expired or revoked." }), { status: 401 })) as typeof fetch);
    await expect(client.bootstrap()).rejects.toBeInstanceOf(MobileApiError);
    expect(tokens.value()).toBeNull();
  });

  it("rejects insecure non-local API origins", () => {
    expect(() => new GenbridgeMobileClient("http://fleet.example.test", tokenStore(), { isOnline: () => true })).toThrow(/HTTPS/);
  });
});

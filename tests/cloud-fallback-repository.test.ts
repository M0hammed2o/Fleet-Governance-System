import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { invokeCloudLivenessFallback, getCloudFallbackUsageForTenant } from "@/lib/repositories/cloud-fallback-repository";
import { NoOpCloudLivenessProvider, MockCloudLivenessProvider } from "@/lib/facial-verification/cloud-liveness-provider";
import { createTenant, createRole, createUser, createDriver } from "./helpers/fixtures";

function unique() {
  return crypto.randomUUID();
}

async function makeActor(tenantId: string) {
  const role = await createRole(tenantId);
  return createUser({ tenantId, roleId: role.id, email: `${unique()}@example.test` });
}

describe("Phase 9F: cloud-liveness-provider", () => {
  it("NoOpCloudLivenessProvider is always honestly PROVIDER_UNAVAILABLE — never fabricates a result", async () => {
    const provider = new NoOpCloudLivenessProvider();
    const outcome = await provider.checkLiveness({ tenantId: "t", driverId: "d", frameCount: 5, reason: "RANDOM_SAMPLE" });
    expect(outcome.result).toBe("PROVIDER_UNAVAILABLE");
    expect(outcome.failureReason).toBeTruthy();
  });

  it("MockCloudLivenessProvider returns whichever outcome it was constructed to force, for deterministic tests", async () => {
    const live = await new MockCloudLivenessProvider("LIVE").checkLiveness({ tenantId: "t", driverId: "d", frameCount: 5, reason: "SUPERVISOR_REQUESTED" });
    expect(live.result).toBe("LIVE");

    const notLive = await new MockCloudLivenessProvider("NOT_LIVE").checkLiveness({ tenantId: "t", driverId: "d", frameCount: 5, reason: "REPEATED_FAILURE" });
    expect(notLive.result).toBe("NOT_LIVE");
  });
});

describe("Phase 9F: cloud-fallback-repository", () => {
  it("records one CloudFallbackInvocation and an audit row per invocation, tracked per tenant", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);

    const { invocation, outcome } = await invokeCloudLivenessFallback(
      { tenantId: tenant.id, actorUserId: actor.id, driverId: driver.id, reason: "REVIEW_REQUIRED", frameCount: 8 },
      new MockCloudLivenessProvider("LIVE"),
    );

    expect(outcome.result).toBe("LIVE");
    expect(invocation.reason).toBe("REVIEW_REQUIRED");
    expect(invocation.tenantId).toBe(tenant.id);

    const auditRow = await prisma.auditLog.findFirst({ where: { tenantId: tenant.id, action: "facialVerification.cloudFallbackInvoked", entityId: invocation.id } });
    expect(auditRow).not.toBeNull();
  });

  it("getCloudFallbackUsageForTenant aggregates invocation counts by reason, scoped to one tenant", async () => {
    const tenant = await createTenant();
    const actor = await makeActor(tenant.id);
    const driver = await createDriver(tenant.id);
    const otherTenant = await createTenant();
    const otherActor = await makeActor(otherTenant.id);
    const otherDriver = await createDriver(otherTenant.id);

    await invokeCloudLivenessFallback({ tenantId: tenant.id, actorUserId: actor.id, driverId: driver.id, reason: "REVIEW_REQUIRED", frameCount: 5 });
    await invokeCloudLivenessFallback({ tenantId: tenant.id, actorUserId: actor.id, driverId: driver.id, reason: "REVIEW_REQUIRED", frameCount: 5 });
    await invokeCloudLivenessFallback({ tenantId: tenant.id, actorUserId: actor.id, driverId: driver.id, reason: "RANDOM_SAMPLE", frameCount: 5 });
    await invokeCloudLivenessFallback({ tenantId: otherTenant.id, actorUserId: otherActor.id, driverId: otherDriver.id, reason: "REVIEW_REQUIRED", frameCount: 5 });

    const usage = await getCloudFallbackUsageForTenant(tenant.id);
    const byReason = new Map(usage.map((u) => [u.reason, u._count._all]));
    expect(byReason.get("REVIEW_REQUIRED")).toBe(2);
    expect(byReason.get("RANDOM_SAMPLE")).toBe(1);

    const totalAcrossReasons = usage.reduce((sum, u) => sum + u._count._all, 0);
    expect(totalAcrossReasons).toBe(3); // never counts the other tenant's invocation
  });
});

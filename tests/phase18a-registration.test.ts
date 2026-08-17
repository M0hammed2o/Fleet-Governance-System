import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { DemoRegistrationRejectedError, provisionDemoWorkspace } from "@/lib/demo/registration";
import { getOnboardingSummary, updateOnboarding } from "@/lib/repositories/onboarding-repository";
import { deleteTenantForCleanup } from "./helpers/fixtures";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const tenantId of createdTenantIds.splice(0)) await deleteTenantForCleanup(tenantId);
});

function registration(suffix = crypto.randomUUID()) {
  return {
    companyName: `Synthetic Demo ${suffix}`, workspaceSlug: `synthetic-${suffix}`.toLowerCase(), industry: "Synthetic logistics",
    companyRegistrationNumber: "SYNTHETIC-ONLY", contactPhone: "+27000000000", address: "Example Test Avenue",
    administratorName: "Synthetic Administrator", email: `admin.${suffix}@example.test`, password: "LocalSynthetic!12345",
    acceptDemoTerms: true as const, acceptSyntheticDisclosure: true as const,
  };
}

describe("Phase 18A atomic demo provisioning", () => {
  it("creates one tenant, supported roles, first approved administrator, onboarding, session and audit atomically", async () => {
    const input = registration(); const result = await provisionDemoWorkspace(input);
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: result.tenantSlug }, include: { users: { include: { role: true } }, roles: { include: { rolePermissions: { include: { permission: true } } } }, onboardingProgress: true, auditLogs: true, sessions: true } });
    createdTenantIds.push(tenant.id);
    expect(tenant.demoWorkspace).toBe(true); expect(tenant.demoTermsAcceptedAt).not.toBeNull(); expect(tenant.onboardingProgress?.currentStep).toBe(1);
    expect(tenant.users).toHaveLength(1); expect(tenant.users[0]).toMatchObject({ email: input.email, approvalStatus: "APPROVED", status: "ACTIVE" }); expect(tenant.users[0].role.name).toBe("Company Administrator");
    expect(tenant.roles.map((role) => role.name)).toEqual(expect.arrayContaining(["Company Administrator", "Gate Security Officer", "Fleet and GPS Manager", "Executive Viewer"]));
    const keys = (roleName: string) => tenant.roles.find((role) => role.name === roleName)!.rolePermissions.map((entry) => `${entry.permission.resource}:${entry.permission.action}`);
    expect(keys("Fleet and GPS Manager")).toEqual(expect.arrayContaining(["driver:CREATE", "vehicle:EDIT", "mediaAsset:DELETE"]));
    expect(keys("Gate Security Officer")).toContain("gateEvent:CREATE"); expect(keys("Gate Security Officer")).not.toContain("vehicle:EDIT");
    expect(tenant.sessions.some((session) => session.tokenHash && session.userId === tenant.users[0].id)).toBe(true);
    expect(tenant.auditLogs.some((entry) => entry.action === "demo.workspaceProvisioned")).toBe(true);
  });

  it("rejects duplicate account information generically without creating a partial second tenant", async () => {
    const input = registration(); await provisionDemoWorkspace(input);
    const first = await prisma.tenant.findUniqueOrThrow({ where: { slug: input.workspaceSlug } }); createdTenantIds.push(first.id);
    const attempted = { ...registration(), email: input.email };
    await expect(provisionDemoWorkspace(attempted)).rejects.toBeInstanceOf(DemoRegistrationRejectedError);
    expect(await prisma.tenant.findUnique({ where: { slug: attempted.workspaceSlug } })).toBeNull();
  });

  it("saves resumable onboarding progress, reconciles the fleet plan and records an audit event", async () => {
    const input = registration(); const result = await provisionDemoWorkspace(input);
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: result.tenantSlug }, include: { users: true } }); createdTenantIds.push(tenant.id);
    await updateOnboarding(tenant.id, tenant.users[0].id, {
      currentStep: 3,
      completedSections: ["company", "fleet"],
      company: { name: input.companyName, industry: input.industry, companyRegistrationNumber: null, contactEmail: input.email, contactPhone: null, address: null, departments: ["Synthetic Operations"] },
      fleet: { declaredFleetSize: 5, fleetComposition: { TRUCK: 2, BAKKIE_PICKUP: 1, PASSENGER: 2 } },
    });
    const summary = await getOnboardingSummary(tenant.id);
    expect(summary?.onboarding).toMatchObject({ currentStep: 3, completedSections: ["company", "fleet"], declaredFleetSize: 5 });
    expect(summary?.counts).toMatchObject({ declaredFleetSize: 5, loadedVehicles: 0, outstandingVehicles: 5 });
    expect(await prisma.auditLog.count({ where: { tenantId: tenant.id, action: "demo.onboardingSaved" } })).toBe(1);
  });
});

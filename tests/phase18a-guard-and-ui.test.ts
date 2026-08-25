import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { gateDutyApprovalError, staffApprovalDecisionError } from "@/lib/auth/gate-duty";
import { prisma } from "@/lib/db/prisma";
import type { AuthenticatedSession } from "@/lib/auth/session";
import { createGate, createRole, createSite, createTenant, createUser } from "./helpers/fixtures";

const read = (relative: string) => fs.readFileSync(path.resolve(relative), "utf8");

describe("Phase 18A guard separation and accessible UI contracts", () => {
  it("prevents self-approval and limits the workflow to security guards", () => {
    expect(staffApprovalDecisionError({ actorUserId: "same", targetUserId: "same", targetRoleName: "Gate Security Officer" })).toMatch(/cannot approve/i);
    expect(staffApprovalDecisionError({ actorUserId: "manager", targetUserId: "staff", targetRoleName: "Dispatch and Logistics Officer" })).toMatch(/security officers/i);
    expect(staffApprovalDecisionError({ actorUserId: "manager", targetUserId: "guard", targetRoleName: "Gate Security Officer" })).toBeNull();
  });

  it("denies pending guards and enforces their approved gate placement", async () => {
    const tenant = await createTenant("Guard approval tenant"); const role = await createRole(tenant.id, "Guard role"); await prisma.role.update({ where: { id: role.id }, data: { name: "Gate Security Officer" } });
    const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` }); const site = await createSite(tenant.id); const assignedGate = await createGate(tenant.id, site.id); const otherGate = await createGate(tenant.id, site.id);
    const session: AuthenticatedSession = { sessionId: "test", tenantId: tenant.id, userId: user.id, roleId: role.id, roleName: "Gate Security Officer", userStatus: "ACTIVE", tenantStatus: "ACTIVE" };
    await prisma.user.update({ where: { id: user.id }, data: { approvalStatus: "PENDING", assignedSiteId: site.id, assignedGateId: assignedGate.id } });
    await expect(gateDutyApprovalError(session, assignedGate.id)).resolves.toMatch(/independently approved/i);
    await prisma.user.update({ where: { id: user.id }, data: { approvalStatus: "APPROVED" } });
    await expect(gateDutyApprovalError(session, assignedGate.id)).resolves.toBeNull();
    await expect(gateDutyApprovalError(session, otherGate.id)).resolves.toMatch(/different gate/i);
  });

  it("renders text and icon status, keyboard controls, responsive layouts and exact synthetic warnings", () => {
    const dashboard = read("src/app/dashboard/page.tsx"); const onboarding = read("src/components/onboarding-wizard.tsx"); const driver = read("src/app/admin/drivers/[id]/driver-detail-client.tsx"); const vehicle = read("src/app/admin/vehicles/[id]/page.tsx");
    expect(dashboard).toMatch(/GOOD_STANDING/); expect(dashboard).toMatch(/REVIEW_REQUIRED/); expect(dashboard).toMatch(/SERIOUS_ATTENTION/); expect(dashboard).toMatch(/rating\.label/);
    expect(dashboard).toMatch(/aria-hidden|aria-label/); expect(dashboard).toMatch(/sm:|lg:/);
    expect(onboarding).toMatch(/aria-current/); expect(onboarding).toMatch(/Save and continue later/); expect(onboarding).toMatch(/sm:|lg:/);
    expect(driver).toContain("SYNTHETIC BIOMETRIC TEST"); expect(driver).toContain("NOT REAL FACIAL VERIFICATION");
    expect(vehicle).toContain("NOT A LIVE PROVIDER FEED");
  });
});

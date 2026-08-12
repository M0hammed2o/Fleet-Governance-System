import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createMobileBootstrap } from "@/lib/mobile/bootstrap";
import { getMobileGateQueue } from "@/lib/mobile/gate-queue";
import { listMobileNotifications } from "@/lib/mobile/notifications";
import { getMobileOwnerOverview } from "@/lib/mobile/owner-overview";
import {
  createDriver,
  createGate,
  createRole,
  createSite,
  createTenant,
  createUser,
  createVehicle,
  grantPermission,
} from "./helpers/fixtures";

describe("mobile API repository contracts", () => {
  let tenantId = "";
  let userId = "";
  let roleId = "";
  let sessionId = "";
  let visibleMovementId = "";
  let hiddenMovementId = "";
  let foreignSiteId = "";

  beforeAll(async () => {
    const tenant = await createTenant("Mobile API tenant");
    const foreign = await createTenant("Mobile API foreign tenant");
    tenantId = tenant.id;
    const role = await createRole(tenant.id, "Mobile owner guard");
    roleId = role.id;
    for (const [resource, action] of [
      ["site", "VIEW"],
      ["gate", "VIEW"],
      ["gateEvent", "VIEW"],
      ["gateEvent", "CREATE"],
      ["gateEvent", "EDIT"],
      ["movement", "VIEW"],
      ["movement", "APPROVE"],
      ["governanceAnalytics", "VIEW"],
      ["analyticsIndicator", "VIEW"],
      ["exception", "VIEW"],
      ["telematics", "VIEW"],
    ] as const)
      await grantPermission(role.id, resource, action);
    const user = await createUser({
      tenantId: tenant.id,
      roleId: role.id,
      email: `mobile-contract-${tenant.id}@example.test`,
    });
    userId = user.id;
    const session = await prisma.session.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        tokenHash: `mobile-contract-${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    sessionId = session.id;

    async function movementFor(
      ownerTenantId: string,
      requesterUserId: string,
      referenceCode: string,
    ) {
      const site = await createSite(ownerTenantId, "Mobile site");
      await createGate(ownerTenantId, site.id, "Mobile gate");
      const vehicle = await createVehicle(ownerTenantId);
      const driver = await createDriver(ownerTenantId);
      return prisma.movementAuthorisation.create({
        data: {
          tenantId: ownerTenantId,
          referenceCode,
          movementType: "DELIVERY",
          status: "APPROVED",
          vehicleId: vehicle.id,
          driverId: driver.id,
          siteId: site.id,
          requesterUserId,
          purpose: "Synthetic mobile contract verification",
        },
      });
    }
    visibleMovementId = (
      await movementFor(tenant.id, user.id, "MOB-VISIBLE")
    ).id;
    const foreignRole = await createRole(foreign.id, "Foreign requester");
    const foreignUser = await createUser({
      tenantId: foreign.id,
      roleId: foreignRole.id,
      email: `mobile-contract-foreign-${foreign.id}@example.test`,
    });
    hiddenMovementId = (
      await movementFor(foreign.id, foreignUser.id, "MOB-HIDDEN")
    ).id;
    foreignSiteId = (
      await prisma.movementAuthorisation.findUniqueOrThrow({
        where: { id: hiddenMovementId },
        select: { siteId: true },
      })
    ).siteId;
  });

  const session = () => ({
    sessionId,
    tenantId,
    userId,
    roleId,
    roleName: "Mobile owner guard",
    userStatus: "ACTIVE",
    tenantStatus: "ACTIVE",
  });

  it("derives capabilities from canonical permissions and returns only tenant sites", async () => {
    const bootstrap = await createMobileBootstrap(session());
    expect(bootstrap.capabilities).toMatchObject({
      guard: true,
      ownerOverview: true,
      approvals: true,
    });
    expect(bootstrap.sites.length).toBeGreaterThan(0);
    expect(bootstrap.sites.every((site) => site.id !== foreignSiteId)).toBe(
      true,
    );
  });

  it("filters queue, overview, and notification contracts by tenant", async () => {
    const queue = await getMobileGateQueue(session(), { query: "MOB-" });
    expect(queue.items.map((item) => item.id)).toContain(visibleMovementId);
    expect(queue.items.map((item) => item.id)).not.toContain(hiddenMovementId);
    const overview = await getMobileOwnerOverview(session());
    expect(overview.counts.awaitingApproval).toBe(0);
    expect(overview).not.toHaveProperty("providerAssetId");
    const notices = await listMobileNotifications(session());
    expect(JSON.stringify(notices)).not.toContain("MOB-HIDDEN");
  });
});

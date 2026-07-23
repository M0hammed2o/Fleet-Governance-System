import { describe, it, expect } from "vitest";
import { createTenant, createRole, createUser } from "./helpers/fixtures";
import { createSite, getSiteInTenant, listSitesInTenant, updateSite, archiveSite } from "@/lib/repositories/site-repository";
import { createGate, getGateInTenant, listGatesInTenant } from "@/lib/repositories/gate-repository";
import { listUsersInTenant, findUserByIdInTenant } from "@/lib/repositories/user-repository";

// Mandatory gate, extended: a normal (non-platform) tenant administrator's
// session must never be able to reach another tenant's data through the real
// repository functions the app actually uses — not just a raw permission check.
describe("cross-tenant access denied for ordinary tenant administrators", () => {
  it("a site created in Tenant A is invisible and unreachable from Tenant B", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");

    const site = await createSite(tenantA.id, { name: "Warehouse A" });

    expect(await getSiteInTenant(tenantB.id, site.id)).toBeNull();
    const tenantBSites = await listSitesInTenant(tenantB.id);
    expect(tenantBSites.find((s) => s.id === site.id)).toBeUndefined();

    // Attempting to update/archive a Tenant A site while scoped as Tenant B
    // must silently affect zero rows, not throw and not succeed.
    expect(await updateSite(tenantB.id, site.id, { name: "Renamed by attacker" })).toBe(false);
    expect(await archiveSite(tenantB.id, site.id)).toBe(false);

    const stillIntact = await getSiteInTenant(tenantA.id, site.id);
    expect(stillIntact?.name).toBe("Warehouse A");
    expect(stillIntact?.archivedAt).toBeNull();
  });

  it("a gate cannot be created by Tenant B against Tenant A's site id", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const siteA = await createSite(tenantA.id, { name: "Site A" });

    const result = await createGate(tenantB.id, { siteId: siteA.id, name: "Sneaky Gate" });
    expect(result).toBeNull();

    const tenantAGates = await listGatesInTenant(tenantA.id);
    expect(tenantAGates.find((g) => g.name === "Sneaky Gate")).toBeUndefined();
  });

  it("a gate in Tenant A is invisible from Tenant B", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const siteA = await createSite(tenantA.id, { name: "Site A" });
    const gate = await createGate(tenantA.id, { siteId: siteA.id, name: "Main Gate" });

    expect(gate).not.toBeNull();
    expect(await getGateInTenant(tenantB.id, gate!.id)).toBeNull();
  });

  it("a Company Administrator in Tenant B cannot list or fetch Tenant A's users", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");
    const roleA = await createRole(tenantA.id, "Company Administrator");
    const userA = await createUser({ tenantId: tenantA.id, roleId: roleA.id, email: "admin-a@example.test" });

    const tenantBUsers = await listUsersInTenant(tenantB.id);
    expect(tenantBUsers.find((u) => u.id === userA.id)).toBeUndefined();
    expect(await findUserByIdInTenant(tenantB.id, userA.id)).toBeNull();
  });
});

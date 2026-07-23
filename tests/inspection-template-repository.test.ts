import { describe, it, expect } from "vitest";
import {
  createInspectionTemplate,
  createNewTemplateVersion,
  getActiveTemplateForCategory,
  getInspectionTemplateInTenant,
} from "@/lib/repositories/inspection-template-repository";
import { createTenant, createRole, createUser } from "./helpers/fixtures";

async function baseSetup() {
  const tenant = await createTenant();
  const role = await createRole(tenant.id);
  const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `${crypto.randomUUID()}@example.test` });
  return { tenant, user };
}

describe("inspection template versioning", () => {
  it("publishing a new version deactivates the previous version and increments the version number", async () => {
    const { tenant, user } = await baseSetup();
    const v1 = await createInspectionTemplate({
      tenantId: tenant.id,
      actorUserId: user.id,
      name: "Truck Inspection",
      vehicleCategory: "TRUCK",
      items: [{ section: "VEHICLE_IDENTITY", label: "Registration matches" }],
    });
    expect(v1.version).toBe(1);
    expect(v1.isActive).toBe(true);

    const v2 = await createNewTemplateVersion(tenant.id, v1.id, {
      actorUserId: user.id,
      items: [
        { section: "VEHICLE_IDENTITY", label: "Registration matches" },
        { section: "LIGHTS", label: "Headlights operational" },
      ],
    });
    expect(v2?.version).toBe(2);
    expect(v2?.isActive).toBe(true);
    expect(v2?.name).toBe("Truck Inspection");

    const reloadedV1 = await getInspectionTemplateInTenant(tenant.id, v1.id);
    expect(reloadedV1?.isActive).toBe(false);
  });

  it("a GateEvent that already references an old version keeps pointing at it after a new version is published (existing rows are not rewritten)", async () => {
    const { tenant, user } = await baseSetup();
    const v1 = await createInspectionTemplate({
      tenantId: tenant.id,
      actorUserId: user.id,
      name: "Passenger Inspection",
      vehicleCategory: "PASSENGER",
      items: [{ section: "VEHICLE_IDENTITY", label: "Registration matches" }],
    });
    await createNewTemplateVersion(tenant.id, v1.id, {
      actorUserId: user.id,
      items: [{ section: "VEHICLE_IDENTITY", label: "Registration matches (revised wording)" }],
    });

    // v1's own row and its items are untouched — this is the guarantee a
    // GateEvent's inspectionTemplateId relies on.
    const stillThere = await getInspectionTemplateInTenant(tenant.id, v1.id);
    expect(stillThere?.items[0]?.label).toBe("Registration matches");
  });

  it("getActiveTemplateForCategory prefers a category-specific active template over the generic fallback", async () => {
    const { tenant, user } = await baseSetup();
    await createInspectionTemplate({
      tenantId: tenant.id,
      actorUserId: user.id,
      name: "Generic Inspection",
      vehicleCategory: null,
      items: [{ section: "VEHICLE_IDENTITY", label: "Generic check" }],
    });
    await createInspectionTemplate({
      tenantId: tenant.id,
      actorUserId: user.id,
      name: "Trailer Inspection",
      vehicleCategory: "TRAILER",
      items: [{ section: "VEHICLE_IDENTITY", label: "Trailer-specific check" }],
    });

    const picked = await getActiveTemplateForCategory(tenant.id, "TRAILER");
    expect(picked?.name).toBe("Trailer Inspection");

    const fallback = await getActiveTemplateForCategory(tenant.id, "TRUCK");
    expect(fallback?.name).toBe("Generic Inspection");
  });

  it("returns null when no active template exists for the category and no generic fallback exists", async () => {
    const { tenant } = await baseSetup();
    const picked = await getActiveTemplateForCategory(tenant.id, "TRUCK");
    expect(picked).toBeNull();
  });
});

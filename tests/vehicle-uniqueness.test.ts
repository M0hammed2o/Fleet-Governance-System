import { describe, it, expect } from "vitest";
import { createVehicle, DuplicateVehicleIdentifierError, updateVehicle } from "@/lib/repositories/vehicle-repository";
import { createTenant, createVehicle as createVehicleFixture } from "./helpers/fixtures";

describe("vehicle registration/VIN uniqueness (server-side, not just frontend validation)", () => {
  it("rejects creating a second vehicle with the same registration number in the same tenant", async () => {
    const tenant = await createTenant();
    await createVehicle(tenant.id, { registrationNumber: "DUPE001GP" });

    await expect(createVehicle(tenant.id, { registrationNumber: "DUPE001GP" })).rejects.toBeInstanceOf(
      DuplicateVehicleIdentifierError,
    );
  });

  it("rejects creating a second vehicle with the same VIN in the same tenant", async () => {
    const tenant = await createTenant();
    await createVehicle(tenant.id, { registrationNumber: "AAA111GP", vin: "VINDUPETEST0001" });

    await expect(
      createVehicle(tenant.id, { registrationNumber: "BBB222GP", vin: "VINDUPETEST0001" }),
    ).rejects.toBeInstanceOf(DuplicateVehicleIdentifierError);
  });

  it("allows the same registration number to exist in two different tenants", async () => {
    const tenantA = await createTenant("Tenant A");
    const tenantB = await createTenant("Tenant B");

    const a = await createVehicle(tenantA.id, { registrationNumber: "SHARED001GP" });
    const b = await createVehicle(tenantB.id, { registrationNumber: "SHARED001GP" });

    expect(a.id).not.toBe(b.id);
  });

  it("allows multiple vehicles with no VIN set (VIN uniqueness only applies when VIN is provided)", async () => {
    const tenant = await createTenant();
    const a = await createVehicle(tenant.id, { registrationNumber: "NOVIN001GP" });
    const b = await createVehicle(tenant.id, { registrationNumber: "NOVIN002GP" });
    expect(a.vin).toBeNull();
    expect(b.vin).toBeNull();
  });

  it("rejects updating a vehicle's registration number to one already used by another vehicle in the same tenant", async () => {
    const tenant = await createTenant();
    await createVehicleFixture(tenant.id, { registrationNumber: "TAKEN001GP" });
    const other = await createVehicleFixture(tenant.id, { registrationNumber: "FREE001GP" });

    await expect(updateVehicle(tenant.id, other.id, { registrationNumber: "TAKEN001GP" })).rejects.toBeInstanceOf(
      DuplicateVehicleIdentifierError,
    );
  });
});

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { generateBillableVehicleSnapshot, countActiveVehiclesForTenant } from "@/lib/repositories/billable-vehicle-repository";
import { createTenantPricingAgreement } from "@/lib/repositories/tenant-billing-repository";
import { calculateBillableFees } from "@/lib/billing/money";
import { createVehicle, createTenant } from "./helpers/fixtures";
import { makeSession } from "./helpers/billing-session";

const REFERENCE_MONTH = new Date(Date.UTC(2026, 6, 1)); // 2026-07 — a fixed reference so every test in this file shares one deterministic billing period per tenant

describe("Phase 10 (P10D): billable-vehicle snapshot", () => {
  it("0 active vehicles: an empty, valid snapshot, not an error", async () => {
    const tenant = await createTenant();
    const snapshot = await generateBillableVehicleSnapshot(tenant.id, REFERENCE_MONTH, null);
    expect(snapshot.vehicleCount).toBe(0);
    expect(snapshot.vehicleIds).toEqual([]);
  });

  it("1 active vehicle is counted; a DECOMMISSIONED and an archived vehicle are excluded", async () => {
    const tenant = await createTenant();
    const active = await createVehicle(tenant.id);
    await createVehicle(tenant.id, { operationalStatus: "DECOMMISSIONED" });
    const archived = await createVehicle(tenant.id);
    await prisma.vehicle.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });

    const { vehicleIds, count } = await countActiveVehiclesForTenant(tenant.id);
    expect(count).toBe(1);
    expect(vehicleIds).toEqual([active.id]);
  });

  it("a WORKSHOP_LOCKOUT or SECURITY_LOCKOUT vehicle is still billable — only DECOMMISSIONED/archived are excluded", async () => {
    const tenant = await createTenant();
    await createVehicle(tenant.id, { operationalStatus: "WORKSHOP_LOCKOUT" });
    await createVehicle(tenant.id, { operationalStatus: "SECURITY_LOCKOUT" });

    const { count } = await countActiveVehiclesForTenant(tenant.id);
    expect(count).toBe(2);
  });

  it("matches the approved worked example: 15 active vehicles produces a snapshot with count 15 and the exact platform default fees applied", async () => {
    const tenant = await createTenant();
    for (let i = 0; i < 15; i++) await createVehicle(tenant.id);

    const snapshot = await generateBillableVehicleSnapshot(tenant.id, REFERENCE_MONTH, null);
    expect(snapshot.vehicleCount).toBe(15);
    expect(snapshot.vehicleIds).toHaveLength(15);
    // Platform default fees (R1,999 base / R299 per vehicle) are untouched
    // by any other test in this suite — the approved worked example's exact
    // R6,484 subtotal before VAT.
    expect(snapshot.baseFeeMinorUnitsApplied).toBe(199_900);
    expect(snapshot.perVehicleFeeMinorUnitsApplied).toBe(29_900);
    const fees = calculateBillableFees({ baseFeeMinorUnits: snapshot.baseFeeMinorUnitsApplied, perVehicleFeeMinorUnits: snapshot.perVehicleFeeMinorUnitsApplied, vehicleCount: snapshot.vehicleCount });
    expect(fees.subtotalMinorUnits).toBe(648_400);
  });

  it("a larger fleet (40 vehicles) is counted exactly", async () => {
    const tenant = await createTenant();
    for (let i = 0; i < 40; i++) await createVehicle(tenant.id);
    const snapshot = await generateBillableVehicleSnapshot(tenant.id, REFERENCE_MONTH, null);
    expect(snapshot.vehicleCount).toBe(40);
  });

  it("uses the tenant's own negotiated price, not the platform default, when one exists", async () => {
    const { session, tenant } = await makeSession("Platform Administrator", [["pricingAgreement", "EDIT"]]);
    // Effective at/before the billing period being snapshotted — an
    // agreement negotiated "now" (after REFERENCE_MONTH) would not yet be
    // in effect for that historical period (D-035, append-only pricing).
    await createTenantPricingAgreement(session, tenant.id, { baseFeeMinorUnits: 111_100, perVehicleFeeMinorUnits: 22_200, effectiveFrom: REFERENCE_MONTH });
    await createVehicle(tenant.id);

    const snapshot = await generateBillableVehicleSnapshot(tenant.id, REFERENCE_MONTH, null);
    expect(snapshot.baseFeeMinorUnitsApplied).toBe(111_100);
    expect(snapshot.perVehicleFeeMinorUnitsApplied).toBe(22_200);
  });

  it("is idempotent for the same tenant+period: a second call returns the identical snapshot, never a duplicate", async () => {
    const tenant = await createTenant();
    await createVehicle(tenant.id);

    const first = await generateBillableVehicleSnapshot(tenant.id, REFERENCE_MONTH, null);
    const second = await generateBillableVehicleSnapshot(tenant.id, REFERENCE_MONTH, null);
    expect(second.id).toBe(first.id);

    const allSnapshots = await prisma.billableVehicleSnapshot.findMany({ where: { tenantId: tenant.id } });
    expect(allSnapshots).toHaveLength(1);
  });

  it("is idempotent under real concurrency: many simultaneous calls for the same tenant+period never create more than one snapshot row", async () => {
    const tenant = await createTenant();
    await createVehicle(tenant.id);

    const results = await Promise.all(Array.from({ length: 10 }, () => generateBillableVehicleSnapshot(tenant.id, REFERENCE_MONTH, null)));
    const distinctIds = new Set(results.map((r) => r.id));
    expect(distinctIds.size).toBe(1);

    const allSnapshots = await prisma.billableVehicleSnapshot.findMany({ where: { tenantId: tenant.id } });
    expect(allSnapshots).toHaveLength(1);
  });

  it("a price change between periods does not retroactively affect an already-generated snapshot", async () => {
    const { session, tenant } = await makeSession("Platform Administrator", [["pricingAgreement", "EDIT"]]);
    const july = new Date(Date.UTC(2026, 6, 1));
    const august = new Date(Date.UTC(2026, 7, 1));
    await createTenantPricingAgreement(session, tenant.id, { baseFeeMinorUnits: 100_000, perVehicleFeeMinorUnits: 10_000, effectiveFrom: july });
    await createVehicle(tenant.id);

    const julySnapshot = await generateBillableVehicleSnapshot(tenant.id, july, null);
    expect(julySnapshot.baseFeeMinorUnitsApplied).toBe(100_000);

    await createTenantPricingAgreement(session, tenant.id, { baseFeeMinorUnits: 999_000, perVehicleFeeMinorUnits: 99_000, effectiveFrom: august });

    const augustSnapshot = await generateBillableVehicleSnapshot(tenant.id, august, null);
    expect(augustSnapshot.baseFeeMinorUnitsApplied).toBe(999_000);

    // Re-fetching July's own snapshot (not regenerating) proves it was never rewritten.
    const julyReloaded = await prisma.billableVehicleSnapshot.findUniqueOrThrow({ where: { id: julySnapshot.id } });
    expect(julyReloaded.baseFeeMinorUnitsApplied).toBe(100_000);
  });
});

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { ForbiddenError } from "@/lib/auth/authorize";
import {
  getPlatformBillingSettings,
  updatePlatformBillingSettings,
  allocateNextInvoiceNumber,
  createPlatformPricingVersion,
  getCurrentPlatformPricing,
  listPlatformPricingVersions,
} from "@/lib/repositories/platform-billing-repository";
import { makeSession } from "./helpers/billing-session";

describe("Phase 10 (P10B): platform billing configuration", () => {
  it("auto-creates the singleton settings row with schema defaults on first access", async () => {
    const settings = await getPlatformBillingSettings();
    expect(settings.id).toBe("platform");
    expect(settings.currency).toBe("ZAR");
    expect(settings.invoicePrefix).toBe("INV");
  });

  it("a Platform Administrator (platformBilling:CONFIGURE) can update settings; an ordinary role cannot", async () => {
    const { session: adminSession } = await makeSession("Platform Administrator", [["platformBilling", "CONFIGURE"]]);
    const updated = await updatePlatformBillingSettings(adminSession, { legalName: "Gate Fleet Governance (Pty) Ltd", vatEnabled: false });
    expect(updated.legalName).toBe("Gate Fleet Governance (Pty) Ltd");

    const { session: unauthorisedSession } = await makeSession("Company Administrator", []);
    await expect(updatePlatformBillingSettings(unauthorisedSession, { legalName: "Should not work" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses to enable VAT without a rate configured first", async () => {
    const { session } = await makeSession("Platform Administrator", [["platformBilling", "CONFIGURE"]]);
    // PlatformBillingSettings is a genuine platform-wide singleton (not
    // tenant-scoped, so never touched by the per-test-file tenant cleanup)
    // — explicitly arrange the starting state this test depends on rather
    // than assuming a fresh default, so it stays correct on a repeat run
    // against the same database, not just the first run ever.
    await updatePlatformBillingSettings(session, { vatEnabled: false, vatRateBasisPoints: null });

    await expect(updatePlatformBillingSettings(session, { vatEnabled: true })).rejects.toThrow(/VAT rate must be set/);

    const withRate = await updatePlatformBillingSettings(session, { vatEnabled: true, vatRateBasisPoints: 1500 });
    expect(withRate.vatEnabled).toBe(true);
    expect(withRate.vatRateBasisPoints).toBe(1500);
  });

  it("allocateNextInvoiceNumber is sequential and never duplicates under concurrency", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => allocateNextInvoiceNumber()));
    const unique = new Set(results);
    expect(unique.size).toBe(20); // no two concurrent calls ever received the same number
  });

  it("createPlatformPricingVersion is append-only and getCurrentPlatformPricing resolves the latest effectiveFrom <= now", async () => {
    const { session } = await makeSession("Platform Administrator", [["platformBilling", "CONFIGURE"], ["platformBilling", "VIEW"]]);
    // PlatformPricingVersion is a genuine platform-wide append-only table
    // (not tenant-scoped, so never touched by per-test-file tenant
    // cleanup) — this is the only test file that exercises it, so it's
    // safe to start from a known-empty table rather than let stale rows
    // from an earlier run (whose "future" offset has since become "past")
    // outrank this test's own assertions.
    await prisma.platformPricingVersion.deleteMany({});
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);

    await createPlatformPricingVersion(session, { baseFeeMinorUnits: 100_000, perVehicleFeeMinorUnits: 10_000, effectiveFrom: past });
    const beforeFuture = await getCurrentPlatformPricing();
    expect(beforeFuture.baseFeeMinorUnits).toBe(100_000);

    // A future-dated version must not be picked up yet — never a duplicate/duplicate-charge risk from a scheduled price change landing early.
    await createPlatformPricingVersion(session, { baseFeeMinorUnits: 999_999, perVehicleFeeMinorUnits: 999, effectiveFrom: future });
    const stillCurrent = await getCurrentPlatformPricing();
    expect(stillCurrent.baseFeeMinorUnits).toBe(100_000);

    const versions = await listPlatformPricingVersions(session);
    expect(versions.length).toBeGreaterThanOrEqual(2);
  });
});

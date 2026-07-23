import { describe, it, expect } from "vitest";
import { evaluateDocumentExpiry } from "@/lib/documents/expiry-rules";
import { upsertExpiryRule, getExpiryRuleAction } from "@/lib/repositories/document-expiry-rule-repository";
import { createComplianceDocument } from "@/lib/repositories/compliance-document-repository";
import { createTenant, createDriver } from "./helpers/fixtures";

describe("evaluateDocumentExpiry (pure)", () => {
  it("a document with no expiry date is never expired", () => {
    expect(evaluateDocumentExpiry(null, "BLOCK_CLEARANCE")).toEqual({ isExpired: false, action: null });
  });

  it("a future expiry date is not expired, regardless of configured action", () => {
    const future = new Date(Date.now() + 86_400_000);
    expect(evaluateDocumentExpiry(future, "BLOCK_CLEARANCE").isExpired).toBe(false);
  });

  it("a past expiry date with no configured rule is expired but has no action (does not auto-deny)", () => {
    const past = new Date(Date.now() - 86_400_000);
    expect(evaluateDocumentExpiry(past, null)).toEqual({ isExpired: true, action: null });
  });

  it("a past expiry date with a configured BLOCK_CLEARANCE rule surfaces that action", () => {
    const past = new Date(Date.now() - 86_400_000);
    expect(evaluateDocumentExpiry(past, "BLOCK_CLEARANCE")).toEqual({ isExpired: true, action: "BLOCK_CLEARANCE" });
  });

  it("a past expiry date with a configured WARN rule surfaces WARN, not a hard block", () => {
    const past = new Date(Date.now() - 86_400_000);
    expect(evaluateDocumentExpiry(past, "WARN")).toEqual({ isExpired: true, action: "WARN" });
  });
});

describe("tenant-configured document expiry rules", () => {
  it("an expired document follows the tenant's configured action for that document type", async () => {
    const tenant = await createTenant();
    await upsertExpiryRule(tenant.id, "DRIVER_LICENCE", "BLOCK_CLEARANCE");
    await upsertExpiryRule(tenant.id, "OTHER", "WARN");

    const driver = await createDriver(tenant.id);
    const expiredLicence = await createComplianceDocument({
      tenantId: tenant.id,
      ownerType: "DRIVER",
      driverId: driver.id,
      documentType: "DRIVER_LICENCE",
      expiryDate: new Date(Date.now() - 86_400_000),
    });

    const action = await getExpiryRuleAction(tenant.id, expiredLicence.documentType);
    const evaluation = evaluateDocumentExpiry(expiredLicence.expiryDate, action);
    expect(evaluation).toEqual({ isExpired: true, action: "BLOCK_CLEARANCE" });
  });

  it("different tenants can configure different actions for the same document type", async () => {
    const tenantA = await createTenant("Strict Co");
    const tenantB = await createTenant("Lenient Co");
    await upsertExpiryRule(tenantA.id, "INSURANCE", "BLOCK_CLEARANCE");
    await upsertExpiryRule(tenantB.id, "INSURANCE", "WARN");

    expect(await getExpiryRuleAction(tenantA.id, "INSURANCE")).toBe("BLOCK_CLEARANCE");
    expect(await getExpiryRuleAction(tenantB.id, "INSURANCE")).toBe("WARN");
  });

  it("a document type with no configured rule at all returns a null action (expired documents never auto-deny by default)", async () => {
    const tenant = await createTenant();
    expect(await getExpiryRuleAction(tenant.id, "ROADWORTHY_CERTIFICATE")).toBeNull();
  });
});

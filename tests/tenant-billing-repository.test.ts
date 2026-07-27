import { describe, it, expect } from "vitest";
import { ForbiddenError } from "@/lib/auth/authorize";
import {
  upsertTenantBillingProfile,
  getTenantBillingProfile,
  createCustomerBillingContact,
  listCustomerBillingContacts,
  setCustomerBillingContactActive,
  listActiveCustomerBillingContactEmailsUnchecked,
  createTenantPricingAgreement,
  getEffectivePricingForTenant,
  InvalidPricingAmountError,
} from "@/lib/repositories/tenant-billing-repository";
import { makeSession } from "./helpers/billing-session";

describe("Phase 10 (P10C): tenant billing profile and negotiated pricing", () => {
  it("a tenant can view/edit its own billing profile via tenantBilling:VIEW/EDIT; an unauthorised role cannot", async () => {
    const { session, tenant } = await makeSession("Accountant", [["tenantBilling", "VIEW"], ["tenantBilling", "EDIT"]]);

    const updated = await upsertTenantBillingProfile(session, tenant.id, { registeredBusinessName: "Acme Logistics (Pty) Ltd", billingEmail: "billing@acme.test", paymentTermsDays: 14 });
    expect(updated.registeredBusinessName).toBe("Acme Logistics (Pty) Ltd");

    const fetched = await getTenantBillingProfile(session, tenant.id);
    expect(fetched?.billingEmail).toBe("billing@acme.test");

    const { session: unauthorisedSession } = await makeSession("Gate Security Officer", []);
    await expect(getTenantBillingProfile(unauthorisedSession, tenant.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("customer billing contacts: create, list, and deactivate feed listActiveCustomerBillingContactEmailsUnchecked", async () => {
    const { session, tenant } = await makeSession("Accountant", [["tenantBilling", "VIEW"], ["tenantBilling", "EDIT"]]);
    await upsertTenantBillingProfile(session, tenant.id, { accountsContactEmail: "accounts@acme.test" });

    const contact1 = await createCustomerBillingContact(session, tenant.id, { name: "Finance Lead", email: "finance@acme.test" });
    await createCustomerBillingContact(session, tenant.id, { name: "Old Contact", email: "old@acme.test" });

    let emails = await listActiveCustomerBillingContactEmailsUnchecked(tenant.id);
    expect(emails.sort()).toEqual(["accounts@acme.test", "finance@acme.test", "old@acme.test"].sort());

    await setCustomerBillingContactActive(session, tenant.id, contact1.id, false);
    emails = await listActiveCustomerBillingContactEmailsUnchecked(tenant.id);
    expect(emails).not.toContain("finance@acme.test");
    expect(emails).toContain("old@acme.test");

    const contacts = await listCustomerBillingContacts(session, tenant.id);
    expect(contacts).toHaveLength(2);
  });

  it("a negotiated TenantPricingAgreement overrides the platform default for that tenant only", async () => {
    const { session, tenant } = await makeSession("Platform Administrator", [["pricingAgreement", "EDIT"], ["pricingAgreement", "VIEW"]]);
    const { tenant: otherTenant } = await makeSession("Company Administrator", []);

    await createTenantPricingAgreement(session, tenant.id, { baseFeeMinorUnits: 150_000, perVehicleFeeMinorUnits: 25_000 });

    const negotiated = await getEffectivePricingForTenant(tenant.id);
    expect(negotiated.source).toBe("TENANT_NEGOTIATED");
    expect(negotiated.baseFeeMinorUnits).toBe(150_000);
    expect(negotiated.perVehicleFeeMinorUnits).toBe(25_000);

    // A different tenant with no agreement of its own is unaffected.
    const other = await getEffectivePricingForTenant(otherTenant.id);
    expect(other.source).toBe("PLATFORM_DEFAULT");
    expect(other.baseFeeMinorUnits).not.toBe(150_000);
  });

  it("append-only: a later negotiated price does not change what an earlier moment resolved to", async () => {
    const { session, tenant } = await makeSession("Platform Administrator", [["pricingAgreement", "EDIT"]]);
    const early = new Date(Date.now() - 5000);
    await createTenantPricingAgreement(session, tenant.id, { baseFeeMinorUnits: 100_000, perVehicleFeeMinorUnits: 10_000, effectiveFrom: early });

    const atEarly = await getEffectivePricingForTenant(tenant.id, early);
    expect(atEarly.baseFeeMinorUnits).toBe(100_000);

    await createTenantPricingAgreement(session, tenant.id, { baseFeeMinorUnits: 200_000, perVehicleFeeMinorUnits: 20_000 });

    // Resolving "at" the same early moment again must be unaffected by the newer row (D-035).
    const atEarlyAgain = await getEffectivePricingForTenant(tenant.id, early);
    expect(atEarlyAgain.baseFeeMinorUnits).toBe(100_000);

    const now = await getEffectivePricingForTenant(tenant.id);
    expect(now.baseFeeMinorUnits).toBe(200_000);
  });

  it("rejects a negative or non-integer pricing amount", async () => {
    const { session, tenant } = await makeSession("Platform Administrator", [["pricingAgreement", "EDIT"]]);
    await expect(createTenantPricingAgreement(session, tenant.id, { baseFeeMinorUnits: -100, perVehicleFeeMinorUnits: 10_000 })).rejects.toBeInstanceOf(InvalidPricingAmountError);
    await expect(createTenantPricingAgreement(session, tenant.id, { baseFeeMinorUnits: 1.5, perVehicleFeeMinorUnits: 10_000 })).rejects.toBeInstanceOf(InvalidPricingAmountError);
  });

  it("a customer-tenant role can never edit pricing directly (pricingAgreement is platform-only in the seed)", async () => {
    const { session, tenant } = await makeSession("Accountant", [["tenantBilling", "EDIT"]]); // no pricingAgreement grant
    await expect(createTenantPricingAgreement(session, tenant.id, { baseFeeMinorUnits: 1, perVehicleFeeMinorUnits: 1 })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

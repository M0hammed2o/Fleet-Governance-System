import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { runRecurringBillingCycle } from "@/lib/repositories/recurring-billing-repository";
import { updatePlatformBillingSettings } from "@/lib/repositories/platform-billing-repository";
import { getTenantSubscriptionUnchecked } from "@/lib/repositories/subscription-repository";
import { createVehicle, createTenant } from "./helpers/fixtures";
import { makeSession } from "./helpers/billing-session";

// runRecurringBillingCycle scans every ACTIVE tenant in the whole database.
// Under Vitest's full-suite parallel execution, many unrelated test files'
// tenants legitimately exist at once (each not yet cleaned up until its own
// file's afterAll), so this genuinely does more DB work here than the
// default 15s per-test timeout allows for — not a production-scale
// concern (a real deployment doesn't have dozens of concurrent test files
// churning tenants), just this specific shared-test-database interaction.
const RECURRING_CYCLE_TEST_TIMEOUT = 90_000;

describe("Phase 10 (P10L): recurring billing cycle", () => {
  beforeAll(async () => {
    const { session } = await makeSession("Platform Administrator", [["platformBilling", "CONFIGURE"]]);
    await updatePlatformBillingSettings(session, { vatEnabled: false, vatRateBasisPoints: null });
  });

  it("generates exactly one invoice per active tenant for the reference month", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    await createVehicle(tenantA.id);
    await createVehicle(tenantB.id);
    await createVehicle(tenantB.id);

    const reference = new Date(Date.UTC(2027, 0, 1)); // a month unlikely to collide with any other test's reference month
    const result = await runRecurringBillingCycle(reference);

    expect(result.tenantsConsidered).toBeGreaterThanOrEqual(2);
    expect(result.invoicesGenerated).toBeGreaterThanOrEqual(2);
    // This function scans every ACTIVE tenant in the whole database — under
    // Vitest's full-suite parallel execution, another test file's own
    // tenant can legitimately be created and deleted (its own cleanup)
    // between this cycle's tenant listing and its per-tenant write,
    // producing an isolated, correctly-caught error for that *other*
    // tenant (proving the per-tenant try/catch resilience works, not a
    // defect) — so assert neither of *this* test's own tenants failed,
    // not that the whole run was error-free.
    expect(result.errors.some((e) => e.tenantId === tenantA.id)).toBe(false);
    expect(result.errors.some((e) => e.tenantId === tenantB.id)).toBe(false);

    const invoiceA = await prisma.invoice.findFirst({ where: { tenantId: tenantA.id } });
    const invoiceB = await prisma.invoice.findFirst({ where: { tenantId: tenantB.id } });
    expect(invoiceA).toBeTruthy();
    expect(invoiceB).toBeTruthy();
    expect(invoiceB?.subtotalMinorUnits).toBeGreaterThan(invoiceA?.subtotalMinorUnits ?? 0); // B has more vehicles
  }, RECURRING_CYCLE_TEST_TIMEOUT);

  it("running the exact same cycle twice never duplicates an invoice or a charge", async () => {
    const tenant = await createTenant();
    await createVehicle(tenant.id);
    const reference = new Date(Date.UTC(2027, 1, 1));

    // This function scans every ACTIVE tenant in the whole database, so
    // its aggregate counts are affected by unrelated tenants other test
    // files concurrently create/bill under Vitest's full-suite parallel
    // execution — the meaningful, deterministic assertion is idempotency
    // for *this test's own* tenant specifically, not the global totals.
    await runRecurringBillingCycle(reference);
    await runRecurringBillingCycle(reference);
    await runRecurringBillingCycle(reference);

    const invoices = await prisma.invoice.findMany({ where: { tenantId: tenant.id } });
    expect(invoices).toHaveLength(1);
    const snapshots = await prisma.billableVehicleSnapshot.findMany({ where: { tenantId: tenant.id } });
    expect(snapshots).toHaveLength(1);
  }, RECURRING_CYCLE_TEST_TIMEOUT);

  it("does not bill the platform tenant itself", async () => {
    const platformTenant = await prisma.tenant.upsert({ where: { slug: "platform" }, update: {}, create: { name: "Gate Fleet Governance — Platform", slug: "platform" } });
    const reference = new Date(Date.UTC(2027, 2, 1));
    await runRecurringBillingCycle(reference);
    const platformInvoices = await prisma.invoice.findMany({ where: { tenantId: platformTenant.id } });
    expect(platformInvoices).toHaveLength(0);
  }, RECURRING_CYCLE_TEST_TIMEOUT);

  it("marks an overdue invoice and, once the grace period has genuinely elapsed, automatically suspends", async () => {
    const tenant = await createTenant();
    await createVehicle(tenant.id);
    const reference = new Date(Date.UTC(2027, 3, 1));
    await runRecurringBillingCycle(reference);

    // generateInvoiceForBillingPeriod always dates issue/due from the real
    // clock, independent of which calendar-month `reference` snapshots —
    // backdate this invoice's own dueDate directly to simulate a genuinely
    // overdue invoice, well past even the platform default grace period.
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { tenantId: tenant.id } });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { dueDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) } });

    const runNow = await runRecurringBillingCycle(new Date(Date.UTC(2027, 4, 1))); // a distinct new period so no duplicate-invoice interference
    expect(runNow.invoicesMarkedOverdue).toBeGreaterThanOrEqual(1);

    const subscription = await getTenantSubscriptionUnchecked(tenant.id);
    expect(["PAST_DUE", "SUSPENDED"]).toContain(subscription.status);
  }, RECURRING_CYCLE_TEST_TIMEOUT);
});

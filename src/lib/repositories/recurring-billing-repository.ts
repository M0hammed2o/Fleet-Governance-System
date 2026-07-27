import "server-only";
import { prisma } from "@/lib/db/prisma";
import { generateBillableVehicleSnapshot } from "@/lib/repositories/billable-vehicle-repository";
import { generateInvoiceForBillingPeriod, markOverdueInvoices } from "@/lib/repositories/invoice-repository";
import { evaluateAutomatedSuspensionsForAllPastDueTenants } from "@/lib/repositories/subscription-repository";

/**
 * Phase 10 (P10L) — the idempotent recurring billing cycle: identifies
 * every subscription due for billing, captures its active-vehicle
 * snapshot, generates exactly one invoice per correct billing period,
 * marks overdue invoices, and applies the grace-period/automated-suspension
 * policy. Wrapped in `runJob()` (lib/jobs/run-job.ts) for the same
 * concurrency guarantee and JobRun audit record every other background job
 * gets — see lib/jobs/jobs.ts.
 *
 * Idempotent by construction: `generateBillableVehicleSnapshot()` and
 * `generateInvoiceForBillingPeriod()` are both hard-constraint-backed
 * idempotent (BillingPeriod's unique (tenantId, periodStart), Invoice's
 * unique billingPeriodId) — repeating this entire cycle for the same date
 * never duplicates a snapshot, invoice, or charge, whether run once or run
 * five times for the same month.
 *
 * Which tenants are billed: every tenant with `status: "ACTIVE"` other than
 * the system "platform" tenant itself. A tenant's own subscription status
 * (PENDING/ACTIVE/PAST_DUE/SUSPENDED) does not gate whether it gets billed
 * — even a SUSPENDED tenant should keep receiving invoices for what it
 * actually owes; suspension only blocks *new movement creation*
 * (subscription-repository.ts).
 */

export interface RecurringBillingCycleResult {
  tenantsConsidered: number;
  invoicesGenerated: number;
  invoicesAlreadyExisted: number;
  invoicesMarkedOverdue: number;
  subscriptionsAutomaticallySuspended: number;
  errors: Array<{ tenantId: string; message: string }>;
}

export async function runRecurringBillingCycle(reference: Date = new Date()): Promise<RecurringBillingCycleResult> {
  const tenants = await prisma.tenant.findMany({ where: { status: "ACTIVE", slug: { not: "platform" } } });

  let invoicesGenerated = 0;
  let invoicesAlreadyExisted = 0;
  const errors: Array<{ tenantId: string; message: string }> = [];

  for (const tenant of tenants) {
    try {
      const snapshot = await generateBillableVehicleSnapshot(tenant.id, reference, null);
      const existingInvoice = await prisma.invoice.findUnique({ where: { billingPeriodId: snapshot.billingPeriodId } });
      const invoice = await generateInvoiceForBillingPeriod(snapshot.billingPeriodId, null);
      if (existingInvoice) invoicesAlreadyExisted++;
      else invoicesGenerated++;
      void invoice;
    } catch (err) {
      errors.push({ tenantId: tenant.id, message: err instanceof Error ? err.message : "unknown error" });
    }
  }

  const invoicesMarkedOverdue = await markOverdueInvoices(new Date());
  const subscriptionsAutomaticallySuspended = await evaluateAutomatedSuspensionsForAllPastDueTenants(new Date());

  return {
    tenantsConsidered: tenants.length,
    invoicesGenerated,
    invoicesAlreadyExisted,
    invoicesMarkedOverdue,
    subscriptionsAutomaticallySuspended,
    errors,
  };
}

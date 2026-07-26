import type { ArchivePricingTier } from "./archive-pricing";

/**
 * Boundary for a future real billing system (Phase 8C) — same "interface +
 * no-op, real integration blocked pending a vendor decision" pattern as
 * every other unselected provider in this codebase
 * (FacialVerificationProvider, TelematicsProvider, R2CompatibleStorageProvider).
 * Payment collection is explicitly out of scope for this phase.
 */
export interface StorageBillingUsageReport {
  tenantId: string;
  billingPeriodStart: Date;
  billingPeriodEnd: Date;
  archivedBytes: number;
  tier: ArchivePricingTier;
}

export interface StorageBillingHookProvider {
  reportUsage(report: StorageBillingUsageReport): Promise<void>;
}

/** No real billing integration exists — this is a no-op by design, not a stub for something already working. */
export class NoOpStorageBillingHookProvider implements StorageBillingHookProvider {
  async reportUsage(report: StorageBillingUsageReport): Promise<void> {
    void report; // intentionally not sent anywhere — see this module's docstring.
  }
}

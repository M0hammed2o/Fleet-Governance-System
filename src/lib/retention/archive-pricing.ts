/**
 * Archive storage pricing — configuration data, not scattered hard-coded UI
 * values (Phase 8C). Payment collection is explicitly NOT implemented yet
 * (no billing provider chosen — a paid third-party integration requires the
 * user's sign-off first, same status as every other unselected vendor in
 * this codebase). All prices are excluding VAT, in ZAR.
 */
export interface ArchivePricingTier {
  label: string;
  /** Upper bound of this tier in GB, inclusive. `null` = "more than 1TB", custom quotation only. */
  maxGb: number | null;
  monthlyPriceZarExclVat: number | null;
  annualPriceZarExclVat: number | null;
  customQuote: boolean;
}

export const ARCHIVE_PRICING_TIERS: ArchivePricingTier[] = [
  { label: "Up to 100GB", maxGb: 100, monthlyPriceZarExclVat: 149, annualPriceZarExclVat: 1500, customQuote: false },
  { label: "101GB-250GB", maxGb: 250, monthlyPriceZarExclVat: 299, annualPriceZarExclVat: 3000, customQuote: false },
  { label: "251GB-500GB", maxGb: 500, monthlyPriceZarExclVat: 499, annualPriceZarExclVat: 5000, customQuote: false },
  { label: "501GB-1TB", maxGb: 1000, monthlyPriceZarExclVat: 899, annualPriceZarExclVat: 9000, customQuote: false },
  { label: "More than 1TB", maxGb: null, monthlyPriceZarExclVat: null, annualPriceZarExclVat: null, customQuote: true },
];

const BYTES_PER_GB = 1024 ** 3;

export function getArchiveTierForBytes(bytes: number): ArchivePricingTier {
  const gb = bytes / BYTES_PER_GB;
  for (const tier of ARCHIVE_PRICING_TIERS) {
    if (tier.maxGb === null || gb <= tier.maxGb) return tier;
  }
  return ARCHIVE_PRICING_TIERS[ARCHIVE_PRICING_TIERS.length - 1];
}

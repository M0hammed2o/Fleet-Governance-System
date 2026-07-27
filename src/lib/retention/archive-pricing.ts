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
  // maxGb is 1024, not the decimal 1000, because `BYTES_PER_GB` below is the
  // binary (1024-based) gibibyte already used throughout this codebase — a
  // literal 1TB byte count (1024**4 bytes) converts to exactly 1024 in these
  // units. Using 1000 here was Phase 8C's original bug (8E-002): a customer
  // with exactly 1TB archived fell through to "More than 1TB"/custom-quote
  // instead of this tier's flat price.
  { label: "501GB-1TB", maxGb: 1024, monthlyPriceZarExclVat: 899, annualPriceZarExclVat: 9000, customQuote: false },
  { label: "More than 1TB", maxGb: null, monthlyPriceZarExclVat: null, annualPriceZarExclVat: null, customQuote: true },
];

/** Nothing archived — must never carry a phantom charge for the lowest paid tier (8E-002). */
export const NO_ARCHIVE_TIER: ArchivePricingTier = {
  label: "No archived storage",
  maxGb: 0,
  monthlyPriceZarExclVat: 0,
  annualPriceZarExclVat: 0,
  customQuote: false,
};

const BYTES_PER_GB = 1024 ** 3;

export function getArchiveTierForBytes(bytes: number): ArchivePricingTier {
  if (bytes <= 0) return NO_ARCHIVE_TIER;
  const gb = bytes / BYTES_PER_GB;
  for (const tier of ARCHIVE_PRICING_TIERS) {
    if (tier.maxGb === null || gb <= tier.maxGb) return tier;
  }
  return ARCHIVE_PRICING_TIERS[ARCHIVE_PRICING_TIERS.length - 1];
}

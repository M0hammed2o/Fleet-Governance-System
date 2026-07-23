export type ExpiryRuleAction = "WARN" | "REQUIRE_SUPERVISOR_APPROVAL" | "BLOCK_CLEARANCE";

export interface ExpiryEvaluation {
  isExpired: boolean;
  action: ExpiryRuleAction | null;
}

/**
 * Pure function: given a document's expiry date and the tenant's configured
 * rule for that document type, what should happen? Build brief: "Expired
 * documents must not automatically deny every movement" — so an expired
 * document with no configured rule (or a WARN rule) never blocks anything by
 * itself; only BLOCK_CLEARANCE does, and that's a tenant's explicit choice.
 */
export function evaluateDocumentExpiry(
  expiryDate: Date | null,
  configuredAction: ExpiryRuleAction | null,
  now: Date = new Date(),
): ExpiryEvaluation {
  if (!expiryDate) return { isExpired: false, action: null };
  const isExpired = expiryDate.getTime() < now.getTime();
  return { isExpired, action: isExpired ? configuredAction : null };
}

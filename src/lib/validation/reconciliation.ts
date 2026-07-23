import { z } from "zod";

export const buildReconciliationSchema = z
  .object({
    movementAuthorisationId: z.string().trim().min(1).optional(),
    departureGateEventId: z.string().trim().min(1).optional(),
    returnGateEventId: z.string().trim().min(1).optional(),
  })
  .refine(
    (data) => Boolean(data.movementAuthorisationId) || Boolean(data.departureGateEventId && data.returnGateEventId),
    { message: "Provide either movementAuthorisationId, or both departureGateEventId and returnGateEventId." },
  );

export const resolveDiscrepancySchema = z.object({
  resolutionNotes: z.string().trim().min(1, "A resolution explanation is required").max(2000),
  correctiveAction: z.string().trim().max(1000).optional(),
});

export const reconciliationStatusSchema = z.enum(["NO_DISCREPANCIES", "OPEN", "RESOLVED"]);

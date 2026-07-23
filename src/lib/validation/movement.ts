import { z } from "zod";

const isoDateTimeToDate = z
  .string()
  .trim()
  .min(1)
  .transform((val) => new Date(val))
  .refine((d) => !Number.isNaN(d.getTime()), "Invalid date/time");

export const movementTypeSchema = z.enum([
  "ENTRY",
  "EXIT",
  "DELIVERY",
  "COLLECTION",
  "RETURN",
  "SITE_TRANSFER",
  "MAINTENANCE",
  "OTHER",
  // Phase 5C (DISPATCH-001).
  "SALES_VISIT",
  "SERVICE",
  "AUTHORISED_PRIVATE_USE",
]);

export const createMovementSchema = z.object({
  siteId: z.string().trim().min(1, "Site is required"),
  vehicleId: z.string().trim().min(1, "Vehicle is required"),
  driverId: z.string().trim().min(1, "Driver is required"),
  trailerVehicleId: z.string().trim().optional().or(z.literal("")),
  movementType: movementTypeSchema,
  purpose: z.string().trim().max(500).optional(),
  destination: z.string().trim().max(500).optional(),
  expectedDepartureAt: isoDateTimeToDate.optional(),
  expectedReturnAt: isoDateTimeToDate.optional(),
  expectedDistanceKm: z.coerce.number().positive().max(100000).optional(),
  customerProjectJobReference: z.string().trim().max(100).optional(),
  deliveryOrCollectionReference: z.string().trim().max(100).optional(),
  purchaseOrderReference: z.string().trim().max(100).optional(),
  approvedCargoSummary: z.string().trim().max(1000).optional(),
  sealOrContainerReference: z.string().trim().max(100).optional(),
  // Phase 5C (DISPATCH-002) — free text, not FKs; a sender/recipient is very
  // often an external party with no account in this system.
  senderName: z.string().trim().max(200).optional(),
  senderContact: z.string().trim().max(200).optional(),
  recipientName: z.string().trim().max(200).optional(),
  recipientContact: z.string().trim().max(200).optional(),
  // Phase 5C (DISPATCH-004) — plain optional reference, no FK yet (target
  // model VehicleUsePolicy doesn't exist until Phase 6).
  vehicleUsePolicyId: z.string().trim().max(200).optional(),
});
export type CreateMovementInput = z.infer<typeof createMovementSchema>;

export const approveMovementSchema = z.object({
  comments: z.string().trim().max(1000).optional(),
});

export const rejectMovementSchema = z.object({
  comments: z.string().trim().min(1, "A reason is required when rejecting").max(1000),
});

export const cancelMovementSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

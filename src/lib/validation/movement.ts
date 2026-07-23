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
  customerProjectJobReference: z.string().trim().max(100).optional(),
  deliveryOrCollectionReference: z.string().trim().max(100).optional(),
  purchaseOrderReference: z.string().trim().max(100).optional(),
  approvedCargoSummary: z.string().trim().max(1000).optional(),
  sealOrContainerReference: z.string().trim().max(100).optional(),
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

import { z } from "zod";

const isoDateTimeToDate = z
  .string()
  .trim()
  .min(1)
  .transform((val) => new Date(val))
  .refine((d) => !Number.isNaN(d.getTime()), "Invalid date/time");

const hhmm = z.string().trim().regex(/^\d{1,2}:\d{2}$/, "Expected HH:MM");

export const requestManualGpsConfirmationSchema = z.object({
  vehicleId: z.string().trim().min(1, "Vehicle is required"),
  reason: z.string().trim().min(1, "A reason is required").max(1000),
  positionDescription: z.string().trim().min(1, "A position description is required").max(500),
});

export const resolveManualGpsConfirmationSchema = z.object({
  decision: z.enum(["APPROVED", "DENIED"]),
});

export const createTrackerMappingSchema = z.object({
  providerId: z.string().trim().min(1, "Provider identifier is required").max(100).regex(/^[a-z0-9][a-z0-9-]*$/, "Provider identifier must be a lower-case slug"),
  providerAssetId: z.string().trim().min(1, "Tracker asset identifier is required").max(200),
  source: z.enum(["SYNTHETIC", "LIVE_PROVIDER"]),
  effectiveFrom: isoDateTimeToDate,
  reason: z.string().trim().min(10, "A mapping reason is required").max(1000),
  correctionOfId: z.string().trim().min(1).optional(),
});

export const endTrackerMappingSchema = z.object({
  effectiveTo: isoDateTimeToDate,
  reason: z.string().trim().min(10, "An end reason is required").max(1000),
});

export const createGeofenceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  centerLatitude: z.coerce.number().min(-90).max(90),
  centerLongitude: z.coerce.number().min(-180).max(180),
  radiusMeters: z.coerce.number().positive().max(100000),
});

export const createVehicleUsePolicySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  driverId: z.string().trim().min(1, "Driver is required"),
  vehicleIds: z.array(z.string().trim().min(1)).min(1, "At least one vehicle is required"),
  effectiveFrom: isoDateTimeToDate,
  effectiveTo: isoDateTimeToDate.optional(),
  permittedDaysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  permittedStartTime: hhmm.optional(),
  permittedEndTime: hhmm.optional(),
  approvedDestination: z.string().trim().max(500).optional(),
  approvedGeofenceId: z.string().trim().optional(),
  kmLimitPerTrip: z.coerce.number().positive().optional(),
  kmLimitPerDay: z.coerce.number().positive().optional(),
  kmLimitPerWeek: z.coerce.number().positive().optional(),
  kmLimitPerMonth: z.coerce.number().positive().optional(),
  allowAfterHours: z.boolean().optional(),
  allowWeekend: z.boolean().optional(),
  allowPrivateUse: z.boolean().optional(),
  privateUseKmAllowanceKm: z.coerce.number().positive().optional(),
  expectedReturnTime: hhmm.optional(),
  approvingManagerUserId: z.string().trim().optional(),
});

import { z } from "zod";

const isoDateToDate = z
  .string()
  .trim()
  .min(1)
  .transform((val) => new Date(val))
  .refine((d) => !Number.isNaN(d.getTime()), "Invalid date");

export const vehicleCategorySchema = z.enum(["PASSENGER", "LIGHT_COMMERCIAL", "TRUCK", "TRUCK_DUAL_REAR_WHEEL", "TRAILER", "CUSTOM"]);
export const vehicleOwnershipSchema = z.enum(["OWNED", "LEASED", "CONTRACTOR", "THIRD_PARTY"]);
export const fuelTypeSchema = z.enum(["PETROL", "DIESEL", "ELECTRIC", "HYBRID", "OTHER"]);
export const vehicleOperationalStatusSchema = z.enum(["OPERATIONAL", "WORKSHOP_LOCKOUT", "SECURITY_LOCKOUT", "DECOMMISSIONED"]);

export const createVehicleSchema = z.object({
  fleetNumber: z.string().trim().max(50).optional(),
  registrationNumber: z.string().trim().min(1, "Registration number is required").max(50),
  vin: z.string().trim().max(50).optional().or(z.literal("")),
  engineNumber: z.string().trim().max(50).optional(),
  make: z.string().trim().max(100).optional(),
  model: z.string().trim().max(100).optional(),
  year: z.coerce.number().int().min(1950).max(2100).optional(),
  colour: z.string().trim().max(50).optional(),
  category: vehicleCategorySchema.optional(),
  ownership: vehicleOwnershipSchema.optional(),
  fuelType: fuelTypeSchema.optional(),
  tankCapacityLitres: z.coerce.number().positive().optional(),
  odometerReading: z.coerce.number().int().min(0).optional(),
  fuelLevelPercent: z.coerce.number().min(0).max(100).optional(),
  assignedDriverId: z.string().trim().optional().or(z.literal("")),
  licenceDiscExpiry: isoDateToDate.optional(),
  roadworthyExpiry: isoDateToDate.optional(),
  insuranceExpiry: isoDateToDate.optional(),
  gpsProvider: z.string().trim().max(100).optional(),
  gpsDeviceReference: z.string().trim().max(100).optional(),
  tyrePositionConfigId: z.string().trim().optional().or(z.literal("")),
});
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

export const updateVehicleSchema = createVehicleSchema.partial();

export const vehicleOperationalStatusUpdateSchema = z.object({
  operationalStatus: vehicleOperationalStatusSchema,
});

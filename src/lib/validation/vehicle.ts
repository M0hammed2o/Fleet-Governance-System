import { z } from "zod";

const isoDateToDate = z
  .string()
  .trim()
  .min(1)
  .transform((val) => new Date(val))
  .refine((d) => !Number.isNaN(d.getTime()), "Invalid date");

export const vehicleCategorySchema = z.enum(["PASSENGER", "LIGHT_COMMERCIAL", "TRUCK", "TRUCK_DUAL_REAR_WHEEL", "TRAILER", "BAKKIE_PICKUP", "VAN", "SALES_REPRESENTATIVE", "PLANT_EQUIPMENT", "OTHER", "CUSTOM"]);
export const vehicleOwnershipSchema = z.enum(["OWNED", "LEASED", "CONTRACTOR", "THIRD_PARTY"]);
export const fuelTypeSchema = z.enum(["PETROL", "DIESEL", "ELECTRIC", "HYBRID", "OTHER"]);
export const vehicleOperationalStatusSchema = z.enum(["OPERATIONAL", "WORKSHOP_LOCKOUT", "SECURITY_LOCKOUT", "DECOMMISSIONED"]);

const vehicleFieldsSchema = z.object({
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
  carryingCapacityTonnes: z.coerce.number().positive().max(500).optional(),
  odometerReading: z.coerce.number().int().min(0).optional(),
  fuelLevelPercent: z.coerce.number().min(0).max(100).optional(),
  department: z.string().trim().max(200).optional(),
  serviceIntervalKm: z.coerce.number().int().positive().max(1_000_000).optional(),
  nextServiceOdometer: z.coerce.number().int().min(0).max(10_000_000).optional(),
  nextServiceDate: isoDateToDate.optional(),
  assignedDriverId: z.string().trim().optional().or(z.literal("")),
  licenceDiscExpiry: isoDateToDate.optional(),
  roadworthyExpiry: isoDateToDate.optional(),
  insuranceExpiry: isoDateToDate.optional(),
  tyrePositionConfigId: z.string().trim().optional().or(z.literal("")),
});
export const createVehicleSchema = vehicleFieldsSchema.superRefine((value, context) => {
  if (["TRUCK", "TRUCK_DUAL_REAR_WHEEL"].includes(value.category ?? "") && !value.carryingCapacityTonnes) {
    context.addIssue({ code: "custom", path: ["carryingCapacityTonnes"], message: "Truck carrying capacity or tonnage is required" });
  }
  if (value.category === "SALES_REPRESENTATIVE" && !value.department && !value.assignedDriverId) {
    context.addIssue({ code: "custom", path: ["department"], message: "A sales vehicle needs an employee assignment or department" });
  }
  if (value.nextServiceOdometer !== undefined && value.odometerReading !== undefined && value.nextServiceOdometer < value.odometerReading) {
    context.addIssue({ code: "custom", path: ["nextServiceOdometer"], message: "Next service odometer cannot be below the current odometer" });
  }
});
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

export const updateVehicleSchema = vehicleFieldsSchema.partial().extend({
  imageMediaAssetId: z.string().trim().min(1).max(200).optional(),
}).superRefine((value, context) => {
  if (["TRUCK", "TRUCK_DUAL_REAR_WHEEL"].includes(value.category ?? "") && value.carryingCapacityTonnes === undefined) {
    context.addIssue({ code: "custom", path: ["carryingCapacityTonnes"], message: "Truck carrying capacity or tonnage is required" });
  }
});

export const vehicleOperationalStatusUpdateSchema = z.object({
  operationalStatus: vehicleOperationalStatusSchema,
});

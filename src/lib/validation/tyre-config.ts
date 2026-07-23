import { z } from "zod";
import { vehicleCategorySchema } from "@/lib/validation/vehicle";

export const createTyrePositionConfigSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  category: vehicleCategorySchema,
  positions: z
    .array(z.object({ code: z.string().trim().min(1).max(30), label: z.string().trim().min(1).max(100) }))
    .min(1, "At least one position is required"),
});

export const upsertVehicleTyreSchema = z.object({
  positionDefinitionId: z.string().trim().min(1),
  brand: z.string().trim().max(100).optional(),
  size: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(500).optional(),
});

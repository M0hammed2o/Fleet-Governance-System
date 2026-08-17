import { z } from "zod";

const isoDate = z.string().datetime({ offset: true }).transform((value) => new Date(value));

export const createAssignmentSchema = z.object({
  driverId: z.string().trim().min(1),
  vehicleId: z.string().trim().min(1),
  effectiveFrom: isoDate.optional(),
  reason: z.string().trim().min(5, "An assignment reason of at least 5 characters is required").max(500),
  replaceExisting: z.boolean().default(false),
}).superRefine((value, context) => {
  if (value.replaceExisting && value.reason.length < 10) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Reassignment requires a reason of at least 10 characters" });
  }
});

export const endAssignmentSchema = z.object({
  effectiveTo: isoDate.optional(),
  reason: z.string().trim().min(5, "An end reason of at least 5 characters is required").max(500),
});

import { z } from "zod";

const isoDateToDate = z
  .string()
  .trim()
  .min(1)
  .transform((val) => new Date(val))
  .refine((d) => !Number.isNaN(d.getTime()), "Invalid date");

export const createDriverSchema = z.object({
  employeeNumber: z.string().trim().max(100).optional(),
  name: z.string().trim().min(1, "Name is required").max(200),
  contactPhone: z.string().trim().max(50).optional(),
  contactEmail: z.string().trim().email().optional().or(z.literal("")),
  department: z.string().trim().max(200).optional(),
  licenceNumber: z.string().trim().max(100).optional(),
  licenceClass: z.string().trim().max(50).optional(),
  licenceIssueDate: isoDateToDate.optional(),
  licenceExpiry: isoDateToDate.optional(),
  pdpNumber: z.string().trim().max(100).optional(),
  pdpStatus: z.enum(["NOT_REQUIRED", "VALID", "EXPIRED", "PENDING", "SUSPENDED"]).optional(),
  pdpExpiry: isoDateToDate.optional(),
  authorisedVehicleClasses: z.array(z.string().trim().max(20)).optional(),
  restrictions: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(2000).optional(),
}).superRefine((value, context) => {
  if (value.licenceIssueDate && value.licenceExpiry && value.licenceExpiry <= value.licenceIssueDate) {
    context.addIssue({ code: "custom", path: ["licenceExpiry"], message: "Licence expiry must be after the issue date" });
  }
  if (value.pdpStatus && value.pdpStatus !== "NOT_REQUIRED" && !value.pdpNumber) {
    context.addIssue({ code: "custom", path: ["pdpNumber"], message: "A professional permit number is required for this status" });
  }
});
export type CreateDriverInput = z.infer<typeof createDriverSchema>;

// portraitMediaAssetId is update-only, not create-time: the referenced
// MediaAsset must already exist with ownerId=this driver's id, which is only
// possible once the driver itself exists (upload happens after creation) —
// see DECISIONS.md D-012.
const updateDriverBaseSchema = z.object({
  employeeNumber: z.string().trim().max(100).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  contactPhone: z.string().trim().max(50).optional(),
  contactEmail: z.string().trim().email().optional().or(z.literal("")),
  department: z.string().trim().max(200).optional(),
  licenceNumber: z.string().trim().max(100).optional(),
  licenceClass: z.string().trim().max(50).optional(),
  licenceIssueDate: isoDateToDate.optional(),
  licenceExpiry: isoDateToDate.optional(),
  pdpNumber: z.string().trim().max(100).optional(),
  pdpStatus: z.enum(["NOT_REQUIRED", "VALID", "EXPIRED", "PENDING", "SUSPENDED"]).optional(),
  pdpExpiry: isoDateToDate.optional(),
  authorisedVehicleClasses: z.array(z.string().trim().max(20)).optional(),
  restrictions: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(2000).optional(),
  portraitMediaAssetId: z.string().trim().min(1).max(200).optional(),
});
export const updateDriverSchema = updateDriverBaseSchema.superRefine((value, context) => {
  if (value.licenceIssueDate && value.licenceExpiry && value.licenceExpiry <= value.licenceIssueDate) {
    context.addIssue({ code: "custom", path: ["licenceExpiry"], message: "Licence expiry must be after the issue date" });
  }
});

export const driverStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "BLACKLISTED"]),
});

export const requestManualFallbackSchema = z.object({
  reason: z.string().trim().min(10, "A reason of at least 10 characters is required").max(1000),
  relatedGateEventId: z.string().trim().min(1).max(200).optional(),
});

export const resolveManualFallbackSchema = z.object({
  decision: z.enum(["APPROVED", "DENIED"]),
});

// Evidence is attached in a separate step, after the fallback request (and
// therefore its id) already exists — see attachEvidenceToManualFallback() in
// facial-verification-repository.ts and DECISIONS.md D-012.
export const attachManualFallbackEvidenceSchema = z.object({
  evidenceMediaAssetId: z.string().trim().min(1, "evidenceMediaAssetId is required").max(200),
});

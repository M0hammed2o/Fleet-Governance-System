import { z } from "zod";

const isoDateToDate = z
  .string()
  .trim()
  .min(1)
  .transform((val) => new Date(val))
  .refine((d) => !Number.isNaN(d.getTime()), "Invalid date");

export const complianceDocumentTypeSchema = z.enum([
  "DRIVER_LICENCE",
  "PDP",
  "VEHICLE_LICENCE",
  "ROADWORTHY_CERTIFICATE",
  "INSURANCE",
  "OTHER",
]);

export const createComplianceDocumentSchema = z
  .object({
    ownerType: z.enum(["DRIVER", "VEHICLE"]),
    driverId: z.string().trim().optional(),
    vehicleId: z.string().trim().optional(),
    documentType: complianceDocumentTypeSchema,
    documentNumber: z.string().trim().max(100).optional(),
    issueDate: isoDateToDate.optional(),
    expiryDate: isoDateToDate.optional(),
    issuer: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((v) => (v.ownerType === "DRIVER" ? Boolean(v.driverId) && !v.vehicleId : Boolean(v.vehicleId) && !v.driverId), {
    message: "Provide exactly one owner matching ownerType",
  });

export const verifyComplianceDocumentSchema = z.object({
  decision: z.enum(["VERIFIED", "REJECTED"]),
});

// Attachment is linked in a separate step, after the document (and therefore
// its id) already exists — see attachAttachmentToComplianceDocument() in
// compliance-document-repository.ts and DECISIONS.md D-012.
export const attachComplianceDocumentAttachmentSchema = z.object({
  attachmentMediaAssetId: z.string().trim().min(1, "attachmentMediaAssetId is required").max(200),
});

export const expiryRuleActionSchema = z.enum(["WARN", "REQUIRE_SUPERVISOR_APPROVAL", "BLOCK_CLEARANCE"]);

export const upsertExpiryRuleSchema = z.object({
  documentType: complianceDocumentTypeSchema,
  action: expiryRuleActionSchema,
});

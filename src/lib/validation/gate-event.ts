import { z } from "zod";

export const gateEventDirectionSchema = z.enum(["ENTRY", "EXIT"]);

export const startGateEventSchema = z.object({
  movementAuthorisationId: z.string().trim().min(1, "Movement is required"),
  gateId: z.string().trim().min(1, "Gate is required"),
  direction: gateEventDirectionSchema,
});

export const verifyIdentitySchema = z.object({
  capturedImageRef: z.string().trim().min(1, "A capture reference is required"),
});

export const manualIdentityVerifiedSchema = z.object({
  manualFallbackId: z.string().trim().min(1, "manualFallbackId is required"),
});

export const inspectionOutcomeSchema = z.enum(["PASS", "FAIL", "NOT_APPLICABLE", "UNABLE_TO_VERIFY"]);

export const recordInspectionResultSchema = z.object({
  inspectionItemId: z.string().trim().min(1, "Inspection item is required"),
  outcome: inspectionOutcomeSchema,
  readingValue: z.string().trim().max(200).optional(),
  readingUnit: z.string().trim().max(50).optional(),
  comment: z.string().trim().max(1000).optional(),
  // A MediaAsset id previously uploaded via POST /api/media/upload, not an
  // arbitrary string — see DECISIONS.md D-012.
  evidenceMediaAssetId: z.string().trim().min(1).max(200).optional(),
});

export const exceptionSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const raiseExceptionSchema = z.object({
  description: z.string().trim().min(1, "A description is required").max(1000),
  severity: exceptionSeveritySchema.optional(),
  requiresSupervisorApproval: z.boolean().optional(),
  exceptionTypeId: z.string().trim().optional(),
  inspectionResultId: z.string().trim().optional(),
});

export const exceptionOutcomeActionSchema = z.enum([
  "WARNING",
  "MANUAL_REVIEW",
  "SUPERVISOR_APPROVAL",
  "WORKSHOP_LOCKOUT",
  "SECURITY_HOLD",
  "DENIED",
  "CLEARED_WITH_OBSERVATION",
]);

export const resolveExceptionSchema = z.object({
  outcomeAction: exceptionOutcomeActionSchema,
  resolutionNotes: z.string().trim().max(1000).optional(),
});

export const gateEventDecisionSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

export const denyGateEventSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required when denying").max(1000),
});

export const cancelGateEventSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

export const inspectionSectionSchema = z.enum([
  "DRIVER_AUTHORISATION",
  "VEHICLE_IDENTITY",
  "EXTERIOR_CONDITION",
  "LIGHTS",
  "TYRES_WHEELS",
  "OPERATIONAL_INFO",
  "LOAD_VERIFICATION",
]);

export const inspectionResponseTypeSchema = z.enum(["CHECK", "READING", "TEXT"]);

export const inspectionItemInputSchema = z.object({
  section: inspectionSectionSchema,
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
  responseType: inspectionResponseTypeSchema.optional(),
  unit: z.string().trim().max(50).optional(),
  isRequired: z.boolean().optional(),
  defaultExceptionSeverity: exceptionSeveritySchema.optional(),
  requiresSupervisorApprovalOnFail: z.boolean().optional(),
});

export const vehicleCategorySchema = z.enum([
  "PASSENGER",
  "LIGHT_COMMERCIAL",
  "TRUCK",
  "TRUCK_DUAL_REAR_WHEEL",
  "TRAILER",
  "CUSTOM",
]);

export const createInspectionTemplateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().trim().max(1000).optional(),
  vehicleCategory: vehicleCategorySchema.optional(),
  items: z.array(inspectionItemInputSchema).min(1, "At least one inspection item is required"),
});

export const exceptionOutcomeActionDefaultSchema = exceptionOutcomeActionSchema;

export const upsertExceptionTypeSchema = z.object({
  code: z.string().trim().min(1, "Code is required").max(100),
  label: z.string().trim().min(1, "Label is required").max(200),
  description: z.string().trim().max(1000).optional(),
  defaultSeverity: exceptionSeveritySchema,
  defaultOutcomeAction: exceptionOutcomeActionDefaultSchema,
  requiresSupervisorApproval: z.boolean(),
});

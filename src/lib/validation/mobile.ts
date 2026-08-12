import { z } from "zod";
import {
  recordInspectionResultSchema,
  raiseExceptionSchema,
} from "@/lib/validation/gate-event";

export const mobileGateActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("IDENTITY_PENDING") }),
  z.object({
    action: z.literal("SYNTHETIC_IDENTITY_VERIFY"),
    capturedImageRef: z
      .string()
      .trim()
      .regex(/^synthetic:[A-Za-z0-9._:-]{1,160}$/),
  }),
  z.object({ action: z.literal("BEGIN_CHECKS") }),
  z.object({
    action: z.literal("RECORD_INSPECTION"),
    input: recordInspectionResultSchema,
  }),
  z.object({
    action: z.literal("RAISE_EXCEPTION"),
    input: raiseExceptionSchema,
  }),
  z.object({ action: z.literal("ESCALATE") }),
  z.object({
    action: z.literal("CLEAR"),
    reason: z.string().trim().max(1000).optional(),
  }),
  z.object({
    action: z.literal("DENY"),
    reason: z.string().trim().min(1).max(1000),
  }),
  z.object({ action: z.literal("COMPLETE") }),
]);

export const mobileMovementApprovalSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  comments: z.string().trim().max(2000).optional(),
});

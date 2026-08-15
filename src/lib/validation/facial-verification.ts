import { z } from "zod";
import { MIN_ENROLMENT_CAPTURES, MAX_ENROLMENT_CAPTURES } from "@/lib/repositories/facial-enrolment-repository";

const descriptorSchema = z.array(z.number()).length(128, "Each capture must be a 128-dimension face descriptor");

export const enrolDriverSchema = z.object({
  captureDescriptors: z.array(descriptorSchema).min(MIN_ENROLMENT_CAPTURES).max(MAX_ENROLMENT_CAPTURES),
  consentAcknowledged: z.literal(true, { message: "The biometric-processing notice must be acknowledged before enrolment." }),
  lawfulAuthority: z.enum(["CONSENT", "APPROVED_ALTERNATIVE"]).default("CONSENT"),
  lawfulAuthorityReference: z.string().trim().min(1).max(200).optional(),
  noticeVersion: z.string().trim().min(1).max(100).default("phase17a-biometric-notice-v1"),
  retentionPolicyVersion: z.string().trim().min(1).max(100).default("phase17a-pending-approval-v1"),
  synthetic: z.boolean().default(false),
}).superRefine((value, context) => {
  if (value.lawfulAuthority === "APPROVED_ALTERNATIVE" && !value.lawfulAuthorityReference) {
    context.addIssue({
      code: "custom",
      path: ["lawfulAuthorityReference"],
      message: "An approved alternative lawful authority requires a decision reference.",
    });
  }
});

export const revokeFacialTemplateSchema = z.object({
  reason: z.string().trim().min(1, "reason is required"),
});

export const runVerificationAttemptSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
  liveDescriptor: descriptorSchema.optional(),
  captureQuality: z
    .object({
      score: z.number(),
      passed: z.boolean(),
      issues: z.array(z.string()),
    })
    .optional(),
  livenessResult: z.enum(["PASSED", "FAILED", "NOT_REQUIRED", "SKIPPED"]).default("NOT_REQUIRED"),
  livenessChallenge: z.string().optional(),
  deviceLabel: z.string().optional(),
  captureFailed: z.boolean().optional(),
  providerUnavailable: z.boolean().optional(),
});

export const biometricDeletionRequestSchema = z.object({
  reason: z.string().trim().min(10).max(500),
});

export const biometricDeletionDecisionSchema = z.object({
  requestId: z.string().trim().min(1),
  action: z.enum(["APPROVE", "COMPLETE"]),
});

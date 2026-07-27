import { z } from "zod";
import { MIN_ENROLMENT_CAPTURES, MAX_ENROLMENT_CAPTURES } from "@/lib/repositories/facial-enrolment-repository";

const descriptorSchema = z.array(z.number()).length(128, "Each capture must be a 128-dimension face descriptor");

export const enrolDriverSchema = z.object({
  captureDescriptors: z.array(descriptorSchema).min(MIN_ENROLMENT_CAPTURES).max(MAX_ENROLMENT_CAPTURES),
  consentAcknowledged: z.literal(true, { message: "The biometric-processing notice must be acknowledged before enrolment." }),
});

export const revokeFacialTemplateSchema = z.object({
  reason: z.string().trim().min(1, "reason is required"),
});

export const runVerificationAttemptSchema = z.object({
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

import { z } from "zod";
import { invitePasswordSchema } from "@/lib/validation/auth";

export const DEMO_DISCLOSURE_VERSION = "phase18a-synthetic-v1";
export const ONBOARDING_SECTIONS = [
  "company",
  "fleet",
  "sites",
  "vehicles",
  "drivers",
  "staff",
  "assignments",
  "review",
] as const;

const workspaceSlug = z
  .string()
  .trim()
  .min(3, "Workspace code must be at least 3 characters")
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens only");

export const demoRegistrationSchema = z.object({
  companyName: z.string().trim().min(2, "Company name is required").max(200),
  workspaceSlug,
  industry: z.string().trim().max(120).optional(),
  companyRegistrationNumber: z.string().trim().max(100).optional(),
  contactPhone: z.string().trim().max(50).optional(),
  address: z.string().trim().max(500).optional(),
  administratorName: z.string().trim().min(2, "Administrator name is required").max(200),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  password: invitePasswordSchema.max(128),
  acceptDemoTerms: z.literal(true, { error: "Demonstration terms must be accepted" }),
  acceptSyntheticDisclosure: z.literal(true, { error: "Synthetic-data disclosure must be accepted" }),
});

const fleetCompositionSchema = z.partialRecord(
  z.enum(["TRUCK", "BAKKIE_PICKUP", "VAN", "PASSENGER", "SALES_REPRESENTATIVE", "TRAILER", "PLANT_EQUIPMENT", "OTHER"]),
  z.coerce.number().int().min(0).max(100_000),
);

export const onboardingUpdateSchema = z.object({
  currentStep: z.coerce.number().int().min(1).max(8).optional(),
  completedSections: z.array(z.enum(ONBOARDING_SECTIONS)).max(8).optional(),
  company: z.object({
    name: z.string().trim().min(2).max(200),
    companyRegistrationNumber: z.string().trim().max(100).nullable().optional(),
    industry: z.string().trim().max(120).nullable().optional(),
    contactEmail: z.string().trim().email().max(254).nullable().optional(),
    contactPhone: z.string().trim().max(50).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    departments: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  }).optional(),
  fleet: z.object({
    declaredFleetSize: z.coerce.number().int().min(0).max(100_000),
    fleetComposition: fleetCompositionSchema,
  }).superRefine((value, context) => {
    const total = Object.values(value.fleetComposition).reduce((sum, count) => sum + count, 0);
    if (total !== value.declaredFleetSize) {
      context.addIssue({ code: "custom", path: ["fleetComposition"], message: "Category counts must equal the declared fleet size" });
    }
  }).optional(),
  complete: z.boolean().optional(),
});

export type DemoRegistrationInput = z.infer<typeof demoRegistrationSchema>;
export type OnboardingUpdateInput = z.infer<typeof onboardingUpdateSchema>;

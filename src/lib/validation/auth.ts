import { z } from "zod";

export const loginSchema = z.object({
  tenantSlug: z
    .string()
    .trim()
    .min(1, "Company is required")
    .regex(/^[a-z0-9-]+$/, "Use the company slug shown on your invite (lowercase letters, numbers, hyphens)"),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const invitePasswordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[0-9]/, "Password must include a number");

export const inviteUserSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  name: z.string().trim().min(1, "Name is required").max(200),
  roleId: z.string().trim().min(1, "Role is required"),
  employeeNumber: z.string().trim().max(100).optional(),
  assignedSiteId: z.string().trim().max(200).optional().or(z.literal("")),
  assignedGateId: z.string().trim().max(200).optional().or(z.literal("")),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().trim().min(1, "Invitation token is required"),
  password: invitePasswordSchema,
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const createTenantSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, and hyphens only"),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const tenantStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
});

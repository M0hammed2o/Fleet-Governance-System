import { z } from "zod";

export const createSiteSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  address: z.string().trim().max(500).optional(),
});
export type CreateSiteInput = z.infer<typeof createSiteSchema>;

export const updateSiteSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  address: z.string().trim().max(500).nullable().optional(),
});

export const gateDirectionSchema = z.enum(["ENTRY", "EXIT", "BOTH"]);

export const createGateSchema = z.object({
  siteId: z.string().trim().min(1, "Site is required"),
  name: z.string().trim().min(1, "Name is required").max(200),
  direction: gateDirectionSchema.optional(),
});
export type CreateGateInput = z.infer<typeof createGateSchema>;

export const updateGateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  direction: gateDirectionSchema.optional(),
});

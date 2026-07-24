import { z } from "zod";

export const startSupportAccessSessionSchema = z.object({
  customerTenantId: z.string().trim().min(1, "Customer tenant is required"),
  reason: z.string().trim().min(1, "A reason is required").max(1000),
  ticketReference: z.string().trim().max(200).optional(),
});

export const elevateSupportAccessSessionSchema = z.object({
  elevatedReason: z.string().trim().min(1, "An elevation reason is required").max(1000),
});

export const createSupportNoteSchema = z.object({
  note: z.string().trim().min(1, "Note text is required").max(2000),
});

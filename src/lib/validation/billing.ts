import { z } from "zod";

export const updatePlatformBillingSettingsSchema = z.object({
  legalName: z.string().trim().min(1).max(200).optional(),
  tradingName: z.string().trim().max(200).nullable().optional(),
  registrationNumber: z.string().trim().max(100).nullable().optional(),
  vatRegistrationNumber: z.string().trim().max(100).nullable().optional(),
  vatEnabled: z.boolean().optional(),
  vatRateBasisPoints: z.number().int().min(0).max(10_000).nullable().optional(),
  addressLine1: z.string().trim().max(200).nullable().optional(),
  addressLine2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  country: z.string().trim().max(100).optional(),
  billingEmail: z.string().trim().email().nullable().optional(),
  telephone: z.string().trim().max(50).nullable().optional(),
  bankingInstructions: z.string().trim().max(2000).nullable().optional(),
  invoicePrefix: z.string().trim().min(1).max(20).optional(),
  currency: z.string().trim().length(3).optional(),
  defaultPaymentTermsDays: z.number().int().min(0).max(365).optional(),
  defaultGracePeriodDays: z.number().int().min(0).max(365).optional(),
  defaultBaseFeeMinorUnits: z.number().int().min(0).optional(),
  defaultPerVehicleFeeMinorUnits: z.number().int().min(0).optional(),
});

export const upsertTenantBillingProfileSchema = z.object({
  registeredBusinessName: z.string().trim().max(200).nullable().optional(),
  tradingName: z.string().trim().max(200).nullable().optional(),
  registrationNumber: z.string().trim().max(100).nullable().optional(),
  vatNumber: z.string().trim().max(100).nullable().optional(),
  billingAddressLine1: z.string().trim().max(200).nullable().optional(),
  billingAddressLine2: z.string().trim().max(200).nullable().optional(),
  billingCity: z.string().trim().max(100).nullable().optional(),
  billingPostalCode: z.string().trim().max(20).nullable().optional(),
  billingCountry: z.string().trim().max(100).optional(),
  billingEmail: z.string().trim().email().nullable().optional().or(z.literal("")),
  accountsContactName: z.string().trim().max(200).nullable().optional(),
  accountsContactEmail: z.string().trim().email().nullable().optional().or(z.literal("")),
  accountsContactPhone: z.string().trim().max(50).nullable().optional(),
  poRequired: z.boolean().optional(),
  customerReference: z.string().trim().max(200).nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
  gracePeriodDays: z.number().int().min(0).max(365).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const createCustomerBillingContactSchema = z.object({
  name: z.string().trim().max(200).optional(),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
});

export const setCustomerBillingContactActiveSchema = z.object({
  isActive: z.boolean(),
});

export const createTenantPricingAgreementSchema = z.object({
  baseFeeMinorUnits: z.number().int().min(0),
  perVehicleFeeMinorUnits: z.number().int().min(0),
  currency: z.string().trim().length(3).optional(),
  effectiveFrom: z.coerce.date().optional(),
  note: z.string().trim().max(500).optional(),
});

export const generateInvoiceSchema = z.object({
  periodStart: z.coerce.date().optional(),
});

export const voidInvoiceSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required"),
});

export const reissueInvoiceSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required"),
});

export const recordManualPaymentSchema = z.object({
  amountMinorUnits: z.number().int().min(0),
  currency: z.string().trim().length(3),
  proofReference: z.string().trim().min(1, "A proof/reference is required"),
  note: z.string().trim().max(1000).optional(),
});

export const initiateProviderPaymentSchema = z.object({
  returnUrl: z.string().trim().min(1).max(2000).optional(),
});

export const resendInvoiceEmailSchema = z.object({
  recipientEmail: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
});

export const suspendSubscriptionSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required"),
});

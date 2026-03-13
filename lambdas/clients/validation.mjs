/**
 * Client Lambda Validation Schemas
 */

import { z } from 'zod';
import {
  emailSchema,
  ukPhoneSchema,
  passwordSchema,
  ukPostcodeSchema,
} from '/opt/nodejs/lib/validation.mjs';

// Organisation types enum
export const OrganisationType = {
  NHS_TRUST: 'nhs-trust',
  PRIVATE_HOSPITAL: 'private-hospital',
  CARE_HOME: 'care-home',
  NURSING_HOME: 'nursing-home',
  SUPPORTED_LIVING: 'supported-living',
  DOMICILIARY_CARE: 'domiciliary-care',
  HOSPICE: 'hospice',
  MENTAL_HEALTH: 'mental-health',
  OTHER: 'other',
};

const organisationTypeSchema = z.enum([
  OrganisationType.NHS_TRUST,
  OrganisationType.PRIVATE_HOSPITAL,
  OrganisationType.CARE_HOME,
  OrganisationType.NURSING_HOME,
  OrganisationType.SUPPORTED_LIVING,
  OrganisationType.DOMICILIARY_CARE,
  OrganisationType.HOSPICE,
  OrganisationType.MENTAL_HEALTH,
  OrganisationType.OTHER,
]);

// Address schema
const addressSchema = z.object({
  line1: z.string().min(1, 'Address line 1 is required').max(100),
  line2: z.string().max(100).optional(),
  city: z.string().min(1, 'City is required').max(50),
  county: z.string().max(50).optional(),
  postcode: ukPostcodeSchema,
});

// Client registration schema
export const RegisterClientSchema = z.object({
  organisationName: z.string()
    .min(2, 'Organisation name is required')
    .max(100, 'Organisation name too long'),
  organisationType: organisationTypeSchema,
  contactName: z.string()
    .min(2, 'Contact name is required')
    .max(100, 'Contact name too long'),
  contactEmail: emailSchema,
  contactPhone: ukPhoneSchema,
  billingEmail: emailSchema,
  password: passwordSchema,
  address: addressSchema.optional(),
  cqcNumber: z.string()
    .regex(/^[0-9]{1,8}$/, 'Invalid CQC number format')
    .optional(),
});

// Client login schema
export const LoginClientSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

// Verify email schema (same as candidate)
export const VerifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

// Update client profile schema (all fields optional for partial updates)
export const UpdateClientSchema = z.object({
  organisationName: z.string()
    .min(2, 'Organisation name is required')
    .max(100, 'Organisation name too long')
    .optional(),
  organisationType: organisationTypeSchema.optional(),
  contactName: z.string()
    .min(2, 'Contact name is required')
    .max(100, 'Contact name too long')
    .optional(),
  contactPhone: ukPhoneSchema.optional(),
  billingEmail: emailSchema.optional(),
  address: addressSchema.optional(),
  cqcNumber: z.string()
    .regex(/^[0-9]{1,8}$/, 'Invalid CQC number format')
    .optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' }
);

// Forgot password schema
export const ForgotPasswordSchema = z.object({
  email: emailSchema,
});

// Reset password schema
export const ResetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: passwordSchema,
});

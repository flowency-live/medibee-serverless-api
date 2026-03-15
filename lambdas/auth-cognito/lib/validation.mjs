/**
 * Validation Schemas for Auth Cognito
 *
 * All external input MUST be validated using these schemas.
 * Per CLAUDE.md: "Validate All External Data"
 */

import { z } from 'zod';

// UK phone number regex - accepts 07xxx, +447xxx formats
const UK_PHONE_REGEX = /^(?:(?:\+44)|(?:0))7\d{9}$/;

/**
 * Normalize phone to E.164 format (+447xxxxxxxxx)
 */
function normalizePhone(phone) {
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  if (cleaned.startsWith('0')) {
    return '+44' + cleaned.slice(1);
  }
  return cleaned;
}

/**
 * Phone OTP Request Schema
 */
export const PhoneRequestSchema = z.object({
  phone: z
    .string({ required_error: 'Phone number is required' })
    .transform((val) => val.replace(/[\s\-\(\)]/g, ''))
    .refine(
      (val) => UK_PHONE_REGEX.test(val.startsWith('+44') ? val : val.replace(/^0/, '+44')),
      { message: 'Invalid UK mobile number. Must start with 07 or +447' }
    )
    .transform(normalizePhone),
});

/**
 * Phone OTP Verify Schema
 */
export const PhoneVerifySchema = z.object({
  phone: z
    .string({ required_error: 'Phone number is required' })
    .transform((val) => val.replace(/[\s\-\(\)]/g, ''))
    .refine(
      (val) => UK_PHONE_REGEX.test(val.startsWith('+44') ? val : val.replace(/^0/, '+44')),
      { message: 'Invalid UK mobile number' }
    )
    .transform(normalizePhone),
  otp: z
    .string({ required_error: 'Verification code is required' })
    .regex(/^\d{6}$/, { message: 'Verification code must be 6 digits' }),
});

/**
 * Email Request Schema
 */
export const EmailRequestSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email({ message: 'Invalid email address' })
    .transform((val) => val.toLowerCase().trim()),
});

/**
 * OAuth Callback Schema
 */
export const OAuthCallbackSchema = z.object({
  code: z.string({ required_error: 'Authorization code is required' }),
  state: z.string({ required_error: 'State parameter is required' }),
});

/**
 * Validate input and return result
 * @template T
 * @param {z.ZodSchema<T>} schema
 * @param {unknown} data
 * @returns {{ success: true, data: T } | { success: false, error: string }}
 */
export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const firstError = result.error.errors[0];
  return {
    success: false,
    error: firstError?.message || 'Validation failed',
  };
}

/**
 * Create a 400 response for validation errors
 */
export function validationError(message) {
  return {
    statusCode: 400,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message }),
  };
}

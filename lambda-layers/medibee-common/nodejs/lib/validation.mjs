/**
 * Common validation schemas and utilities for Medibee Lambdas
 */

import { z } from 'zod';

// ===========================================
// Common Schemas
// ===========================================

// UK phone number regex
export const ukPhoneRegex = /^(?:(?:\+44\s?|0)(?:\d\s?){9,10})$/;

// UK postcode regex
export const ukPostcodeRegex = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;

// Password requirements: min 8 chars, 1 uppercase, 1 number
export const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

// Email schema (lowercase, trimmed)
export const emailSchema = z.string()
  .email('Invalid email address')
  .transform(val => val.toLowerCase().trim());

// UK phone schema
export const ukPhoneSchema = z.string()
  .regex(ukPhoneRegex, 'Invalid UK phone number');

// UK postcode schema with parsing
export const ukPostcodeSchema = z.string()
  .regex(ukPostcodeRegex, 'Invalid UK postcode')
  .transform(val => {
    // Normalize: uppercase, single space
    const normalized = val.toUpperCase().replace(/\s+/g, ' ').trim();

    // Parse into components
    const match = normalized.match(/^([A-Z]{1,2}\d[A-Z\d]?)\s?(\d[A-Z]{2})$/);
    if (!match) {
      return { full: normalized, outward: normalized.split(' ')[0], inward: '' };
    }

    return {
      full: `${match[1]} ${match[2]}`,
      outward: match[1],
      inward: match[2],
    };
  });

// Password schema
export const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/\d/, 'Password must contain at least one number');

// ===========================================
// Candidate Enums
// ===========================================

export const CandidateStatusSchema = z.enum([
  'pending_verification',
  'pending_profile',
  'pending_review',
  'active',
  'suspended',
  'rejected',
]);

export const ExperienceLevelSchema = z.enum([
  'newly-qualified',
  '1-2-years',
  '3-5-years',
  '5-plus-years',
]);

export const CareSettingSchema = z.enum([
  'mental-health',
  'acute-care',
  'private-hospital',
  'care-home',
  'supported-living',
  'end-of-life',
  'community',
  'learning-disabilities',
  'dementia-care',
  'paediatric',
]);

export const DBSStatusSchema = z.enum([
  'none',
  'applied',
  'cleared',
]);

// ===========================================
// Extended Profile Schemas (Value Objects)
// ===========================================

/**
 * Tagline - Professional headline (max 100 chars)
 * Like LinkedIn's headline: "Senior HCA | Mental Health Specialist"
 */
export const TaglineSchema = z.string()
  .max(100, 'Tagline must be 100 characters or less')
  .optional();

/**
 * Skill - Individual healthcare skill (max 100 chars)
 */
export const SkillSchema = z.string()
  .min(1, 'Skill cannot be empty')
  .max(100, 'Skill must be 100 characters or less');

/**
 * Skills array - Up to 20 skills, deduplicated
 */
export const SkillsArraySchema = z.array(SkillSchema)
  .max(20, 'Maximum 20 skills allowed')
  .transform(skills => [...new Set(skills)]) // Deduplicate
  .optional();

/**
 * ISO date string (YYYY-MM-DD)
 */
export const ISODateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

/**
 * WorkHistoryEntry - Single employment record
 */
export const WorkHistoryEntrySchema = z.object({
  role: z.string().min(1, 'Role is required').max(100),
  employer: z.string().min(1, 'Employer is required').max(150),
  startDate: ISODateSchema,
  endDate: ISODateSchema.nullable().optional(),
  description: z.string().max(500).optional(),
  isCurrent: z.boolean().default(false),
});

/**
 * WorkHistory array - Up to 10 entries
 */
export const WorkHistorySchema = z.array(WorkHistoryEntrySchema)
  .max(10, 'Maximum 10 work history entries allowed')
  .optional();

// ===========================================
// Validation Helpers
// ===========================================

/**
 * Parse and validate request body
 * @param {string} body - JSON string from event.body
 * @param {ZodSchema} schema - Zod schema to validate against
 * @returns {{ success: true, data: T } | { success: false, errors: ZodError }}
 */
export function validateBody(body, schema) {
  try {
    const parsed = JSON.parse(body || '{}');
    const result = schema.safeParse(parsed);

    if (result.success) {
      return { success: true, data: result.data };
    }

    return {
      success: false,
      errors: result.error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  } catch (error) {
    return {
      success: false,
      errors: [{ path: 'body', message: 'Invalid JSON' }],
    };
  }
}

/**
 * Parse and validate query string parameters
 * @param {Object} query - Query parameters object from event.queryStringParameters
 * @param {ZodSchema} schema - Zod schema to validate against
 * @returns {{ success: true, data: T } | { success: false, errors: ZodError }}
 */
export function validateQuery(query, schema) {
  const result = schema.safeParse(query || {});

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    errors: result.error.issues.map(issue => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

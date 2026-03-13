/**
 * Candidates Lambda Validation Schemas
 */

import { z } from 'zod';
import {
  ukPhoneSchema,
  ukPostcodeSchema,
  ExperienceLevelSchema,
  CareSettingSchema,
  DBSStatusSchema,
} from '/opt/nodejs/lib/validation.mjs';

// Profile update schema (all fields optional for PATCH)
export const UpdateProfileSchema = z.object({
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional(),
  phone: ukPhoneSchema.optional(),
  city: z.string().min(1).max(100).optional(),
  postcode: ukPostcodeSchema.optional(),
  experienceLevel: ExperienceLevelSchema.optional(),
  preferredSettings: z.array(CareSettingSchema).min(1).max(10).optional(),
  professionalSummary: z.string().min(10).max(2000).optional(),
  rightToWork: z.boolean().optional(),
  dbsStatus: DBSStatusSchema.optional(),
}).strict();

// Availability update schema
export const UpdateAvailabilitySchema = z.object({
  available: z.boolean(),
}).strict();

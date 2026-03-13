/**
 * Matching Lambda Validation Schemas
 */

import { z } from 'zod';
import {
  ExperienceLevelSchema,
  CareSettingSchema,
} from '/opt/nodejs/lib/validation.mjs';

// Browse candidates query parameters
export const BrowseCandidatesSchema = z.object({
  location: z.string().max(10).optional(),
  experienceLevel: ExperienceLevelSchema.optional(),
  settings: z.string().optional().transform((val) => {
    if (!val) return undefined;
    return val.split(',').map((s) => s.trim());
  }),
  available: z.enum(['true', 'false']).optional().transform((val) => {
    if (val === undefined) return undefined;
    return val === 'true';
  }),
  cursor: z.string().optional(),
  limit: z.string().optional().transform((val) => {
    if (!val) return 20;
    const num = parseInt(val, 10);
    return Math.min(Math.max(1, num), 50); // Clamp between 1 and 50
  }),
});

// View candidate query parameters
export const ViewCandidateSchema = z.object({
  candidateId: z.string().min(1, 'Candidate ID is required'),
});

// Shortlist schemas
export const CreateShortlistSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  description: z.string().max(500).optional(),
});

export const UpdateShortlistSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long').optional(),
  description: z.string().max(500).optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' }
);

export const AddCandidateToShortlistSchema = z.object({
  candidateId: z.string().min(1, 'Candidate ID is required'),
  notes: z.string().max(500).optional(),
});

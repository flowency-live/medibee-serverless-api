/**
 * Contacts Lambda Validation Schemas
 */

import { z } from 'zod';

// Request contact schema
export const RequestContactSchema = z.object({
  candidateId: z.string().min(1, 'Candidate ID is required'),
  message: z.string()
    .min(10, 'Message must be at least 10 characters')
    .max(1000, 'Message too long (max 1000 characters)'),
});

// Contact status enum
export const ContactStatus = {
  PENDING: 'pending',
  CONTACTED: 'contacted',
  RESPONDED: 'responded',
  NO_RESPONSE: 'no_response',
  HIRED: 'hired',
  CLOSED: 'closed',
};

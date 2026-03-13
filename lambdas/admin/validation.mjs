/**
 * Admin Lambda Validation Schemas
 *
 * Zod schemas for all admin request validation.
 * Validates at the boundary - all external data must be validated before use.
 */

import { z } from 'zod';

// ============================================
// Status Enums (using z.enum for type safety)
// ============================================

export const CandidateStatus = {
  PENDING_VERIFICATION: 'pending_verification',
  PENDING_REVIEW: 'pending_review',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  REJECTED: 'rejected',
};

export const ClientStatus = {
  PENDING_VERIFICATION: 'pending_verification',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
};

export const ContactStatus = {
  PENDING: 'pending',
  CONTACTED: 'contacted',
  HIRED: 'hired',
  DECLINED: 'declined',
  EXPIRED: 'expired',
};

// ============================================
// Admin Login
// ============================================

export const AdminLoginSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Invalid email format')
    .transform((val) => val.toLowerCase().trim()),
  password: z
    .string()
    .min(1, 'Password is required'),
});

// ============================================
// Pagination & Filtering
// ============================================

export const PaginationSchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return 20;
      const num = parseInt(val, 10);
      if (isNaN(num) || num < 1) return 20;
      return Math.min(num, 100); // Max 100 items per page
    }),
  cursor: z
    .string()
    .optional(),
});

export const CandidateFilterSchema = z.object({
  status: z
    .enum([
      CandidateStatus.PENDING_VERIFICATION,
      CandidateStatus.PENDING_REVIEW,
      CandidateStatus.ACTIVE,
      CandidateStatus.SUSPENDED,
      CandidateStatus.REJECTED,
    ])
    .optional(),
  ...PaginationSchema.shape,
});

export const ClientFilterSchema = z.object({
  status: z
    .enum([
      ClientStatus.PENDING_VERIFICATION,
      ClientStatus.ACTIVE,
      ClientStatus.SUSPENDED,
    ])
    .optional(),
  ...PaginationSchema.shape,
});

export const ContactFilterSchema = z.object({
  status: z
    .enum([
      ContactStatus.PENDING,
      ContactStatus.CONTACTED,
      ContactStatus.HIRED,
      ContactStatus.DECLINED,
      ContactStatus.EXPIRED,
    ])
    .optional(),
  ...PaginationSchema.shape,
});

// ============================================
// Candidate Moderation Actions
// ============================================

export const SuspendCandidateSchema = z.object({
  reason: z
    .string()
    .min(10, 'Suspension reason must be at least 10 characters')
    .max(500, 'Suspension reason must be at most 500 characters'),
});

export const RejectCandidateSchema = z.object({
  reason: z
    .string()
    .min(10, 'Rejection reason must be at least 10 characters')
    .max(500, 'Rejection reason must be at most 500 characters'),
});

// ============================================
// Client Moderation Actions
// ============================================

export const SuspendClientSchema = z.object({
  reason: z
    .string()
    .min(10, 'Suspension reason must be at least 10 characters')
    .max(500, 'Suspension reason must be at most 500 characters'),
});

// ============================================
// Contact Resolution
// ============================================

export const ResolveContactSchema = z.object({
  status: z.enum([
    ContactStatus.CONTACTED,
    ContactStatus.HIRED,
    ContactStatus.DECLINED,
    ContactStatus.EXPIRED,
  ]),
  notes: z
    .string()
    .max(1000, 'Notes must be at most 1000 characters')
    .optional(),
});

// ============================================
// Analytics Query
// ============================================

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const AnalyticsQuerySchema = z.object({
  startDate: z
    .string()
    .regex(dateRegex, 'Start date must be in YYYY-MM-DD format')
    .optional(),
  endDate: z
    .string()
    .regex(dateRegex, 'End date must be in YYYY-MM-DD format')
    .optional(),
}).refine(
  (data) => {
    // If both dates are provided, start must be before end
    if (data.startDate && data.endDate) {
      return new Date(data.startDate) <= new Date(data.endDate);
    }
    return true;
  },
  {
    message: 'Start date must be before or equal to end date',
    path: ['startDate'],
  }
);

export const AnalyticsExportSchema = z.object({
  format: z.enum(['csv', 'json']).default('json'),
  entity: z.enum(['candidates', 'clients', 'contacts', 'subscriptions']).optional(),
  ...AnalyticsQuerySchema.shape,
});

// ============================================
// ID Validation
// ============================================

export const CandidateIdSchema = z.object({
  candidateId: z
    .string()
    .regex(/^CAND-[a-zA-Z0-9]+$/, 'Invalid candidate ID format'),
});

export const ClientIdSchema = z.object({
  clientId: z
    .string()
    .regex(/^CLI-[a-zA-Z0-9]+$/, 'Invalid client ID format'),
});

export const ContactIdSchema = z.object({
  contactId: z
    .string()
    .regex(/^CON-[a-zA-Z0-9]+$/, 'Invalid contact ID format'),
});

// ============================================
// Valid Status Transitions
// ============================================

/**
 * Defines valid status transitions for candidates
 * Key: current status, Value: array of valid target statuses
 */
export const validCandidateTransitions = {
  [CandidateStatus.PENDING_VERIFICATION]: [],
  [CandidateStatus.PENDING_REVIEW]: [CandidateStatus.ACTIVE, CandidateStatus.REJECTED],
  [CandidateStatus.ACTIVE]: [CandidateStatus.SUSPENDED],
  [CandidateStatus.SUSPENDED]: [CandidateStatus.ACTIVE],
  [CandidateStatus.REJECTED]: [CandidateStatus.PENDING_REVIEW], // Allow re-review
};

/**
 * Check if a candidate status transition is valid
 */
export function isValidCandidateTransition(currentStatus, targetStatus) {
  const validTargets = validCandidateTransitions[currentStatus];
  if (!validTargets) return false;
  return validTargets.includes(targetStatus);
}

/**
 * Defines valid status transitions for clients
 */
export const validClientTransitions = {
  [ClientStatus.PENDING_VERIFICATION]: [],
  [ClientStatus.ACTIVE]: [ClientStatus.SUSPENDED],
  [ClientStatus.SUSPENDED]: [ClientStatus.ACTIVE],
};

/**
 * Check if a client status transition is valid
 */
export function isValidClientTransition(currentStatus, targetStatus) {
  const validTargets = validClientTransitions[currentStatus];
  if (!validTargets) return false;
  return validTargets.includes(targetStatus);
}

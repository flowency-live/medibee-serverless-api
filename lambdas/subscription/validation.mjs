/**
 * Subscription Lambda Validation Schemas
 */

import { z } from 'zod';
import { SubscriptionTiers } from './config.mjs';

// Checkout request schema
export const CheckoutSchema = z.object({
  tier: z.enum([
    SubscriptionTiers.BRONZE,
    SubscriptionTiers.SILVER,
    SubscriptionTiers.GOLD,
  ], {
    errorMap: () => ({ message: 'Invalid subscription tier. Must be bronze, silver, or gold.' }),
  }),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

// Webhook event schema (basic structure)
export const WebhookEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({
    object: z.record(z.unknown()),
  }),
});

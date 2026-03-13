/**
 * Stripe Client Factory
 * Initializes Stripe with secret from SSM Parameter Store
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import Stripe from 'stripe';

const ssm = new SSMClient({ region: 'eu-west-2' });

// Cache Stripe client
let stripeClient = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get Stripe secret from SSM
 */
async function getStripeSecret() {
  const paramName = process.env.STRIPE_SECRET_PARAM || '/medibee/dev/stripe/secret-key';

  const result = await ssm.send(new GetParameterCommand({
    Name: paramName,
    WithDecryption: true,
  }));

  if (!result.Parameter?.Value) {
    throw new Error('Stripe secret not configured');
  }

  return result.Parameter.Value;
}

/**
 * Get webhook secret from SSM
 */
export async function getWebhookSecret() {
  const paramName = process.env.STRIPE_WEBHOOK_SECRET_PARAM || '/medibee/dev/stripe/webhook-secret';

  const result = await ssm.send(new GetParameterCommand({
    Name: paramName,
    WithDecryption: true,
  }));

  if (!result.Parameter?.Value) {
    throw new Error('Stripe webhook secret not configured');
  }

  return result.Parameter.Value;
}

/**
 * Get initialized Stripe client (with caching)
 */
export async function getStripeClient() {
  const now = Date.now();

  if (stripeClient && now < cacheExpiry) {
    return stripeClient;
  }

  const secret = await getStripeSecret();

  stripeClient = new Stripe(secret, {
    apiVersion: '2024-12-18.acacia',
    typescript: false,
    appInfo: {
      name: 'Medibee Talent Showcase',
      version: '1.0.0',
    },
  });

  cacheExpiry = now + CACHE_TTL_MS;

  return stripeClient;
}

/**
 * Checkout Domain Logic
 * Creates Stripe checkout sessions for subscriptions
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getStripeClient } from '../stripe-client.mjs';
import { getStripePriceId, TierConfig } from '../config.mjs';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;
const SITE_URL = process.env.SITE_URL || 'https://medibee.opstack.uk';

/**
 * Get client profile
 */
async function getClientProfile(clientId) {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: 'PROFILE',
    },
  }));

  return result.Item;
}

/**
 * Get existing subscription
 */
async function getExistingSubscription(clientId) {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: 'SUBSCRIPTION',
    },
  }));

  return result.Item;
}

/**
 * Create Stripe checkout session
 */
export async function createCheckoutSession(clientId, tier, options, logger) {
  logger.info('Creating checkout session', { clientId, tier });

  // Get client profile
  const client = await getClientProfile(clientId);
  if (!client) {
    logger.warn('Client not found', { clientId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Client not found',
      status: 404,
    };
  }

  // Check for existing active subscription
  const existingSub = await getExistingSubscription(clientId);
  if (existingSub && existingSub.status === 'active') {
    logger.warn('Client already has active subscription', { clientId });
    return {
      success: false,
      error: 'SUBSCRIPTION_EXISTS',
      message: 'You already have an active subscription. Please manage it from your account settings.',
      status: 400,
    };
  }

  // Get Stripe price ID for tier
  const priceId = getStripePriceId(tier);
  if (!priceId) {
    logger.error('Stripe price ID not configured for tier', { tier });
    return {
      success: false,
      error: 'CONFIGURATION_ERROR',
      message: 'Subscription tier not configured. Please contact support.',
      status: 500,
    };
  }

  const tierConfig = TierConfig[tier];
  const stripe = await getStripeClient();

  // Build success/cancel URLs
  const successUrl = options.successUrl || `${SITE_URL}/client/subscription/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = options.cancelUrl || `${SITE_URL}/client/subscription/cancelled`;

  try {
    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      customer_email: client.contactEmail,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        clientId,
        tier,
        organisationName: client.organisationName,
      },
      subscription_data: {
        metadata: {
          clientId,
          tier,
        },
      },
      allow_promotion_codes: true,
      billing_address_collection: 'required',
    });

    logger.info('Checkout session created', {
      clientId,
      tier,
      sessionId: session.id,
    });

    return {
      success: true,
      checkoutUrl: session.url,
      sessionId: session.id,
      tier,
      tierName: tierConfig.name,
      priceMonthly: tierConfig.priceMonthly,
      status: 200,
    };
  } catch (error) {
    logger.error('Failed to create Stripe checkout session', {
      clientId,
      tier,
      error: error.message,
    });

    return {
      success: false,
      error: 'STRIPE_ERROR',
      message: 'Failed to create checkout session. Please try again.',
      status: 500,
    };
  }
}

/**
 * Get billing portal URL for managing subscription
 */
export async function createBillingPortalSession(clientId, logger) {
  logger.info('Creating billing portal session', { clientId });

  // Get existing subscription to get Stripe customer ID
  const subscription = await getExistingSubscription(clientId);

  if (!subscription || !subscription.stripeCustomerId) {
    logger.warn('No subscription found for client', { clientId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'No subscription found. Please subscribe first.',
      status: 404,
    };
  }

  const stripe = await getStripeClient();

  try {
    const returnUrl = `${SITE_URL}/client/subscription`;

    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: returnUrl,
    });

    logger.info('Billing portal session created', { clientId });

    return {
      success: true,
      portalUrl: session.url,
      status: 200,
    };
  } catch (error) {
    logger.error('Failed to create billing portal session', {
      clientId,
      error: error.message,
    });

    return {
      success: false,
      error: 'STRIPE_ERROR',
      message: 'Failed to create billing portal session. Please try again.',
      status: 500,
    };
  }
}

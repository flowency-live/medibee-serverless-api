/**
 * Stripe Webhook Handler
 * Processes Stripe webhook events for subscriptions
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getStripeClient, getWebhookSecret } from '../stripe-client.mjs';
import { getTierFromPriceId, getTierCredits, SubscriptionStatus } from '../config.mjs';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Verify Stripe webhook signature
 */
export async function verifyWebhookSignature(payload, signature, logger) {
  const stripe = await getStripeClient();
  const webhookSecret = await getWebhookSecret();

  try {
    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    return { success: true, event };
  } catch (error) {
    logger.warn('Webhook signature verification failed', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Check if event has already been processed (idempotency)
 */
async function isEventProcessed(eventId) {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `STRIPE_EVENT#${eventId}`,
      SK: 'EVENT',
    },
  }));

  return !!result.Item;
}

/**
 * Mark event as processed
 */
async function markEventProcessed(eventId) {
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days

  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `STRIPE_EVENT#${eventId}`,
      SK: 'EVENT',
      processedAt: now,
      TTL: ttl,
    },
  }));
}

/**
 * Handle checkout.session.completed event
 * Creates new subscription record
 */
async function handleCheckoutCompleted(session, logger) {
  const clientId = session.metadata?.clientId;
  const tier = session.metadata?.tier;

  if (!clientId || !tier) {
    logger.error('Missing metadata in checkout session', { sessionId: session.id });
    return;
  }

  logger.info('Processing checkout completion', { clientId, tier });

  const now = new Date().toISOString();
  const credits = getTierCredits(tier);

  // Create/update subscription record
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `CLIENT#${clientId}`,
      SK: 'SUBSCRIPTION',
      clientId,
      tier,
      status: SubscriptionStatus.ACTIVE,
      stripeCustomerId: session.customer,
      stripeSubscriptionId: session.subscription,
      creditsRemaining: credits,
      creditsTotal: credits,
      currentPeriodStart: now,
      createdAt: now,
      updatedAt: now,
    },
  }));

  logger.info('Subscription created', { clientId, tier, credits });
}

/**
 * Handle invoice.payment_succeeded event
 * Resets credits on subscription renewal
 */
async function handleInvoicePaymentSucceeded(invoice, logger) {
  // Only process subscription renewal invoices
  if (invoice.billing_reason !== 'subscription_cycle') {
    logger.info('Ignoring non-renewal invoice', { invoiceId: invoice.id, reason: invoice.billing_reason });
    return;
  }

  const subscriptionId = invoice.subscription;
  const stripe = await getStripeClient();

  // Get subscription to find clientId
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const clientId = subscription.metadata?.clientId;

  if (!clientId) {
    logger.error('Missing clientId in subscription metadata', { subscriptionId });
    return;
  }

  const tier = subscription.metadata?.tier;
  const credits = getTierCredits(tier);
  const now = new Date().toISOString();

  // Reset credits for new billing period
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: 'SUBSCRIPTION',
    },
    UpdateExpression: 'SET creditsRemaining = :credits, currentPeriodStart = :now, updatedAt = :now',
    ExpressionAttributeValues: {
      ':credits': credits,
      ':now': now,
    },
  }));

  logger.info('Credits reset for new billing period', { clientId, credits });
}

/**
 * Handle invoice.payment_failed event
 * Marks subscription as past_due
 */
async function handleInvoicePaymentFailed(invoice, logger) {
  const subscriptionId = invoice.subscription;
  const stripe = await getStripeClient();

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const clientId = subscription.metadata?.clientId;

  if (!clientId) {
    logger.error('Missing clientId in subscription metadata', { subscriptionId });
    return;
  }

  const now = new Date().toISOString();

  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: 'SUBSCRIPTION',
    },
    UpdateExpression: 'SET #status = :status, updatedAt = :now',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': SubscriptionStatus.PAST_DUE,
      ':now': now,
    },
  }));

  logger.warn('Subscription marked as past_due', { clientId, invoiceId: invoice.id });
}

/**
 * Handle customer.subscription.deleted event
 * Marks subscription as cancelled
 */
async function handleSubscriptionDeleted(subscription, logger) {
  const clientId = subscription.metadata?.clientId;

  if (!clientId) {
    logger.error('Missing clientId in subscription metadata', { subscriptionId: subscription.id });
    return;
  }

  const now = new Date().toISOString();

  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: 'SUBSCRIPTION',
    },
    UpdateExpression: 'SET #status = :status, cancelledAt = :now, updatedAt = :now',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': SubscriptionStatus.CANCELLED,
      ':now': now,
    },
  }));

  logger.info('Subscription cancelled', { clientId });
}

/**
 * Handle customer.subscription.updated event
 * Handles tier changes (upgrades/downgrades)
 */
async function handleSubscriptionUpdated(subscription, logger) {
  const clientId = subscription.metadata?.clientId;

  if (!clientId) {
    logger.error('Missing clientId in subscription metadata', { subscriptionId: subscription.id });
    return;
  }

  // Get current price to determine tier
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const newTier = getTierFromPriceId(priceId);

  if (!newTier) {
    logger.warn('Could not determine tier from price', { priceId });
    return;
  }

  const credits = getTierCredits(newTier);
  const now = new Date().toISOString();

  // Update tier and credits
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: 'SUBSCRIPTION',
    },
    UpdateExpression: 'SET tier = :tier, creditsTotal = :credits, updatedAt = :now',
    ExpressionAttributeValues: {
      ':tier': newTier,
      ':credits': credits,
      ':now': now,
    },
  }));

  logger.info('Subscription updated', { clientId, newTier, credits });
}

/**
 * Process webhook event
 */
export async function processWebhookEvent(event, logger) {
  logger.info('Processing webhook event', { type: event.type, id: event.id });

  // Check for duplicate events
  if (await isEventProcessed(event.id)) {
    logger.info('Event already processed, skipping', { eventId: event.id });
    return { success: true, message: 'Event already processed' };
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object, logger);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object, logger);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object, logger);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object, logger);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object, logger);
        break;

      default:
        logger.info('Unhandled event type', { type: event.type });
    }

    // Mark event as processed
    await markEventProcessed(event.id);

    return { success: true };
  } catch (error) {
    logger.error('Failed to process webhook event', {
      eventId: event.id,
      type: event.type,
      error: error.message,
    });

    return {
      success: false,
      error: error.message,
    };
  }
}

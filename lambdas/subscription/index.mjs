/**
 * Subscription Lambda Handler
 * Endpoints: POST /subscriptions/checkout, GET /subscriptions/portal,
 *            GET /subscriptions/me, POST /subscriptions/webhook
 */

import { createLogger } from '/opt/nodejs/lib/logger.mjs';
import { handleOptions } from '/opt/nodejs/lib/cors.mjs';
import { successResponse, errorResponse, ERRORS } from '/opt/nodejs/lib/responses.mjs';
import { validateBody } from '/opt/nodejs/lib/validation.mjs';
import { extractClientId } from '/opt/nodejs/lib/auth.mjs';
import { CheckoutSchema } from './validation.mjs';
import { createCheckoutSession, createBillingPortalSession } from './domain/checkout.mjs';
import { getSubscription } from './domain/subscription.mjs';
import { verifyWebhookSignature, processWebhookEvent } from './domain/webhook.mjs';

export const handler = async (event, context) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return handleOptions(event);
  }

  const logger = createLogger(event, context);
  const origin = event.headers?.origin;
  const path = event.rawPath || event.path;
  const method = event.requestContext?.http?.method || event.httpMethod;

  logger.info('Subscription request received', { path, method });

  try {
    // Webhook endpoint (no auth, uses Stripe signature)
    if (path === '/subscriptions/webhook' && method === 'POST') {
      return await handleWebhook(event, logger);
    }

    // Health check
    if (path === '/subscriptions/health' && method === 'GET') {
      return successResponse(200, {
        status: 'healthy',
        service: 'medibee-subscription',
        timestamp: new Date().toISOString(),
      }, origin);
    }

    // All other routes require client authentication
    let clientId;
    try {
      clientId = extractClientId(event);
    } catch (error) {
      return ERRORS.UNAUTHORIZED('Invalid authorization', origin);
    }

    logger.info('Authenticated client', { clientId });

    // Route to appropriate handler
    switch (path) {
      case '/subscriptions/checkout':
        if (method === 'POST') {
          return await handleCheckout(event, clientId, logger, origin);
        }
        break;

      case '/subscriptions/portal':
        if (method === 'GET') {
          return await handleBillingPortal(clientId, logger, origin);
        }
        break;

      case '/subscriptions/me':
        if (method === 'GET') {
          return await handleGetSubscription(clientId, logger, origin);
        }
        break;
    }

    // Route not found
    return ERRORS.NOT_FOUND('Route not found', origin);

  } catch (error) {
    logger.error('Request failed', { error: error.message, stack: error.stack });
    return ERRORS.INTERNAL_ERROR(origin);
  }
};

/**
 * Handle POST /subscriptions/checkout
 */
async function handleCheckout(event, clientId, logger, origin) {
  const validation = validateBody(event.body, CheckoutSchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  const { tier, successUrl, cancelUrl } = validation.data;

  const result = await createCheckoutSession(clientId, tier, { successUrl, cancelUrl }, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    checkoutUrl: result.checkoutUrl,
    sessionId: result.sessionId,
    tier: result.tier,
    tierName: result.tierName,
    priceMonthly: result.priceMonthly,
  }, origin);
}

/**
 * Handle GET /subscriptions/portal
 */
async function handleBillingPortal(clientId, logger, origin) {
  const result = await createBillingPortalSession(clientId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    portalUrl: result.portalUrl,
  }, origin);
}

/**
 * Handle GET /subscriptions/me
 */
async function handleGetSubscription(clientId, logger, origin) {
  const result = await getSubscription(clientId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    subscription: result.subscription,
  }, origin);
}

/**
 * Handle POST /subscriptions/webhook
 * Processes Stripe webhook events
 */
async function handleWebhook(event, logger) {
  const signature = event.headers?.['stripe-signature'];

  if (!signature) {
    logger.warn('Missing Stripe signature');
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing signature' }),
    };
  }

  // Get raw body for signature verification
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf-8')
    : event.body;

  // Verify signature
  const verification = await verifyWebhookSignature(rawBody, signature, logger);

  if (!verification.success) {
    logger.warn('Invalid webhook signature');
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid signature' }),
    };
  }

  // Process the event
  const result = await processWebhookEvent(verification.event, logger);

  if (!result.success) {
    logger.error('Failed to process webhook event', { error: result.error });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Processing failed' }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true }),
  };
}

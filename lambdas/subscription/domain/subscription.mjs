/**
 * Subscription Domain Logic
 * Handles subscription queries and operations
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TierConfig, hasUnlimitedCredits } from '../config.mjs';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Get subscription for a client
 */
export async function getSubscription(clientId, logger) {
  logger.info('Getting subscription', { clientId });

  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: 'SUBSCRIPTION',
    },
  }));

  if (!result.Item) {
    logger.info('No subscription found', { clientId });
    return {
      success: true,
      subscription: null,
      status: 200,
    };
  }

  const subscription = result.Item;
  const tierConfig = TierConfig[subscription.tier];

  // Add computed fields
  const enrichedSubscription = {
    ...subscription,
    tierName: tierConfig?.name || subscription.tier,
    tierDescription: tierConfig?.description,
    features: tierConfig?.features || [],
    hasUnlimitedCredits: hasUnlimitedCredits(subscription.tier),
    maxShortlists: tierConfig?.maxShortlists || 0,
    maxCandidatesPerShortlist: tierConfig?.maxCandidatesPerShortlist || 0,
  };

  // Remove DynamoDB keys from response
  delete enrichedSubscription.PK;
  delete enrichedSubscription.SK;

  logger.info('Subscription retrieved', { clientId, tier: subscription.tier });

  return {
    success: true,
    subscription: enrichedSubscription,
    status: 200,
  };
}

/**
 * Check if client has active subscription
 */
export async function hasActiveSubscription(clientId) {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: 'SUBSCRIPTION',
    },
  }));

  if (!result.Item) {
    return false;
  }

  return result.Item.status === 'active';
}

/**
 * Check and deduct contact credit
 * Returns true if credit was successfully deducted
 */
export async function deductContactCredit(clientId, logger) {
  logger.info('Attempting to deduct contact credit', { clientId });

  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: 'SUBSCRIPTION',
    },
  }));

  const subscription = result.Item;

  if (!subscription) {
    logger.warn('No subscription found', { clientId });
    return {
      success: false,
      error: 'NO_SUBSCRIPTION',
      message: 'You need an active subscription to contact candidates.',
    };
  }

  if (subscription.status !== 'active') {
    logger.warn('Subscription not active', { clientId, status: subscription.status });
    return {
      success: false,
      error: 'SUBSCRIPTION_INACTIVE',
      message: 'Your subscription is not active. Please update your payment method.',
    };
  }

  // Check for unlimited credits
  if (hasUnlimitedCredits(subscription.tier)) {
    logger.info('Client has unlimited credits', { clientId, tier: subscription.tier });
    return {
      success: true,
      creditsRemaining: -1, // Unlimited
      message: 'Unlimited credits available',
    };
  }

  // Check if credits available
  if (subscription.creditsRemaining <= 0) {
    logger.warn('No credits remaining', { clientId, tier: subscription.tier });
    return {
      success: false,
      error: 'NO_CREDITS',
      message: 'You have no contact credits remaining this month. Upgrade your plan for more credits.',
    };
  }

  // Deduct credit atomically
  try {
    const now = new Date().toISOString();

    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `CLIENT#${clientId}`,
        SK: 'SUBSCRIPTION',
      },
      UpdateExpression: 'SET creditsRemaining = creditsRemaining - :one, updatedAt = :now',
      ConditionExpression: 'creditsRemaining > :zero',
      ExpressionAttributeValues: {
        ':one': 1,
        ':zero': 0,
        ':now': now,
      },
      ReturnValues: 'ALL_NEW',
    }));

    const newCredits = subscription.creditsRemaining - 1;
    logger.info('Credit deducted', { clientId, creditsRemaining: newCredits });

    return {
      success: true,
      creditsRemaining: newCredits,
      message: `Contact credit used. ${newCredits} credits remaining.`,
    };
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      logger.warn('Race condition: credits exhausted', { clientId });
      return {
        success: false,
        error: 'NO_CREDITS',
        message: 'You have no contact credits remaining this month.',
      };
    }
    throw error;
  }
}

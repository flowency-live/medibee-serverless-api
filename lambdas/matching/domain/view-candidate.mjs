/**
 * View Candidate Domain Logic
 * Handles viewing a single candidate profile
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SubscriptionTiers } from '../../subscription/config.mjs';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Get client subscription
 */
async function getClientSubscription(clientId) {
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
 * Get candidate profile
 */
async function getCandidateProfile(candidateId) {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: 'PROFILE',
    },
  }));

  return result.Item;
}

/**
 * Fields to exclude from all responses
 */
const SENSITIVE_FIELDS = ['PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', 'passwordHash'];

/**
 * Fields hidden for bronze tier
 */
const BRONZE_HIDDEN_FIELDS = ['email', 'phone', 'cvKey'];

/**
 * Strip sensitive fields and apply tier-based masking
 */
function maskCandidateForTier(candidate, tier) {
  const result = { ...candidate };

  // Remove sensitive fields
  for (const field of SENSITIVE_FIELDS) {
    delete result[field];
  }

  // Bronze tier gets masked data
  if (tier === SubscriptionTiers.BRONZE) {
    // Hide contact info
    for (const field of BRONZE_HIDDEN_FIELDS) {
      delete result[field];
    }

    // Mask last name
    if (result.lastName) {
      result.lastName = result.lastName.charAt(0) + '.';
    }

    // Truncate profile summary
    if (result.profileSummary && result.profileSummary.length > 150) {
      result.profileSummary = result.profileSummary.substring(0, 150) + '...';
    }

    // Only show outward postcode
    if (result.location) {
      result.location = {
        outward: result.location.outward,
      };
    }
  }

  return result;
}

/**
 * View a single candidate profile
 */
export async function viewCandidate(clientId, candidateId, logger) {
  logger.info('Viewing candidate', { clientId, candidateId });

  // Check subscription
  const subscription = await getClientSubscription(clientId);

  if (!subscription) {
    logger.warn('Client has no subscription', { clientId });
    return {
      success: false,
      error: 'NO_SUBSCRIPTION',
      message: 'You need an active subscription to view candidates.',
      status: 403,
    };
  }

  if (subscription.status !== 'active' && subscription.status !== 'trialing') {
    logger.warn('Client subscription not active', { clientId, status: subscription.status });
    return {
      success: false,
      error: 'SUBSCRIPTION_INACTIVE',
      message: 'Your subscription is not active. Please update your payment method.',
      status: 403,
    };
  }

  // Get candidate profile
  const candidate = await getCandidateProfile(candidateId);

  if (!candidate) {
    logger.warn('Candidate not found', { candidateId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Candidate not found.',
      status: 404,
    };
  }

  // Only allow viewing active candidates
  if (candidate.status !== 'active') {
    logger.warn('Candidate not active', { candidateId, status: candidate.status });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Candidate not found.',
      status: 404,
    };
  }

  // Mask candidate based on tier
  const tier = subscription.tier;
  const maskedCandidate = maskCandidateForTier(candidate, tier);

  logger.info('Candidate viewed', { clientId, candidateId, tier });

  return {
    success: true,
    candidate: maskedCandidate,
    tier,
    status: 200,
  };
}

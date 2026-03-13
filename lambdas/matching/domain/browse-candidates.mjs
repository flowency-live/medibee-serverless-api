/**
 * Browse Candidates Domain Logic
 * Handles candidate search and filtering for clients
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { hasUnlimitedCredits, SubscriptionTiers } from '../../subscription/config.mjs';

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
 * Mask candidate data based on subscription tier
 */
function maskCandidateForTier(candidate, tier) {
  // Gold and Silver get full access
  if (tier === SubscriptionTiers.GOLD || tier === SubscriptionTiers.SILVER) {
    return {
      ...candidate,
      // Remove internal fields
      PK: undefined,
      SK: undefined,
      GSI1PK: undefined,
      GSI1SK: undefined,
      GSI2PK: undefined,
      GSI2SK: undefined,
      passwordHash: undefined,
    };
  }

  // Bronze gets masked data
  return {
    candidateId: candidate.candidateId,
    firstName: candidate.firstName,
    lastName: candidate.lastName ? candidate.lastName.charAt(0) + '.' : null,
    location: candidate.location?.outward || null, // Only outward code
    experienceLevel: candidate.experienceLevel,
    careSettings: candidate.careSettings,
    available: candidate.available,
    profileSummary: candidate.profileSummary
      ? candidate.profileSummary.substring(0, 150) + (candidate.profileSummary.length > 150 ? '...' : '')
      : null,
    updatedAt: candidate.updatedAt,
    // Hidden for bronze
    email: undefined,
    phone: undefined,
    cvKey: undefined,
  };
}

/**
 * Browse active candidates with filters
 */
export async function browseCandidates(clientId, filters, logger) {
  logger.info('Browsing candidates', { clientId, filters });

  // Check subscription
  const subscription = await getClientSubscription(clientId);

  if (!subscription) {
    logger.warn('Client has no subscription', { clientId });
    return {
      success: false,
      error: 'NO_SUBSCRIPTION',
      message: 'You need an active subscription to browse candidates.',
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

  const tier = subscription.tier;
  const { location, experienceLevel, settings, available, cursor, limit } = filters;

  // Build query for active candidates
  // Using GSI2 which has GSI2PK = STATUS#{status}
  const queryParams = {
    TableName: TABLE_NAME,
    IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2PK = :statusPk',
    ExpressionAttributeValues: {
      ':statusPk': 'STATUS#active',
    },
    Limit: limit || 20,
  };

  // Add cursor for pagination
  if (cursor) {
    try {
      queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
    } catch (error) {
      logger.warn('Invalid cursor', { cursor });
    }
  }

  // Add filter expressions
  const filterParts = [];
  const filterValues = {};

  // Filter by location (outward postcode)
  if (location) {
    filterParts.push('contains(#location.#outward, :location)');
    queryParams.ExpressionAttributeNames = queryParams.ExpressionAttributeNames || {};
    queryParams.ExpressionAttributeNames['#location'] = 'location';
    queryParams.ExpressionAttributeNames['#outward'] = 'outward';
    filterValues[':location'] = location.toUpperCase();
  }

  // Filter by experience level
  if (experienceLevel) {
    filterParts.push('experienceLevel = :experienceLevel');
    filterValues[':experienceLevel'] = experienceLevel;
  }

  // Filter by care settings (any match)
  if (settings && settings.length > 0) {
    const settingConditions = settings.map((setting, i) => {
      filterValues[`:setting${i}`] = setting;
      return `contains(careSettings, :setting${i})`;
    });
    filterParts.push(`(${settingConditions.join(' OR ')})`);
  }

  // Filter by availability
  if (available !== undefined) {
    filterParts.push('#available = :available');
    queryParams.ExpressionAttributeNames = queryParams.ExpressionAttributeNames || {};
    queryParams.ExpressionAttributeNames['#available'] = 'available';
    filterValues[':available'] = available;
  }

  // Only candidates (not clients)
  filterParts.push('begins_with(PK, :candidatePrefix)');
  filterValues[':candidatePrefix'] = 'CANDIDATE#';

  if (filterParts.length > 0) {
    queryParams.FilterExpression = filterParts.join(' AND ');
    queryParams.ExpressionAttributeValues = {
      ...queryParams.ExpressionAttributeValues,
      ...filterValues,
    };
  }

  const result = await docClient.send(new QueryCommand(queryParams));

  // Mask candidates based on tier
  const candidates = (result.Items || []).map((candidate) =>
    maskCandidateForTier(candidate, tier)
  );

  // Generate next cursor
  let nextCursor = null;
  if (result.LastEvaluatedKey) {
    nextCursor = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
  }

  logger.info('Candidates retrieved', {
    clientId,
    count: candidates.length,
    hasMore: !!nextCursor,
  });

  return {
    success: true,
    candidates,
    pagination: {
      cursor: nextCursor,
      hasMore: !!nextCursor,
      count: candidates.length,
    },
    tier,
    status: 200,
  };
}

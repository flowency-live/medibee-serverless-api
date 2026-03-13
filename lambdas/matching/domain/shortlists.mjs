/**
 * Shortlists Domain Logic
 * Handles shortlist CRUD operations
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { nanoid } from 'nanoid';
import { getShortlistLimits, hasUnlimitedShortlists } from '../../subscription/config.mjs';

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
 * List all shortlists for a client
 */
export async function listShortlists(clientId, logger) {
  logger.info('Listing shortlists', { clientId });

  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': `CLIENT#${clientId}`,
      ':skPrefix': 'SHORTLIST#',
    },
  }));

  const shortlists = (result.Items || []).map((item) => ({
    shortlistId: item.shortlistId,
    name: item.name,
    description: item.description,
    candidateCount: item.candidateCount || 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));

  logger.info('Shortlists retrieved', { clientId, count: shortlists.length });

  return {
    success: true,
    shortlists,
    status: 200,
  };
}

/**
 * Get a single shortlist with its candidates
 */
export async function getShortlist(clientId, shortlistId, logger) {
  logger.info('Getting shortlist', { clientId, shortlistId });

  // Get shortlist metadata
  const shortlistResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: `SHORTLIST#${shortlistId}`,
    },
  }));

  if (!shortlistResult.Item) {
    logger.warn('Shortlist not found', { clientId, shortlistId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Shortlist not found.',
      status: 404,
    };
  }

  // Get candidates in shortlist
  const candidatesResult = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': `SHORTLIST#${shortlistId}`,
      ':skPrefix': 'CANDIDATE#',
    },
  }));

  const shortlist = {
    shortlistId: shortlistResult.Item.shortlistId,
    name: shortlistResult.Item.name,
    description: shortlistResult.Item.description,
    candidateCount: shortlistResult.Item.candidateCount || 0,
    createdAt: shortlistResult.Item.createdAt,
    updatedAt: shortlistResult.Item.updatedAt,
  };

  const candidates = (candidatesResult.Items || []).map((item) => ({
    candidateId: item.candidateId,
    candidateName: item.candidateName,
    notes: item.notes,
    addedAt: item.addedAt,
  }));

  logger.info('Shortlist retrieved', { clientId, shortlistId, candidateCount: candidates.length });

  return {
    success: true,
    shortlist,
    candidates,
    status: 200,
  };
}

/**
 * Create a new shortlist
 */
export async function createShortlist(clientId, data, logger) {
  logger.info('Creating shortlist', { clientId, name: data.name });

  // Check subscription limits
  const subscription = await getClientSubscription(clientId);

  if (!subscription || subscription.status !== 'active') {
    logger.warn('No active subscription', { clientId });
    return {
      success: false,
      error: 'NO_SUBSCRIPTION',
      message: 'You need an active subscription to create shortlists.',
      status: 403,
    };
  }

  const limits = getShortlistLimits(subscription.tier);
  const unlimited = hasUnlimitedShortlists(subscription.tier);

  if (!unlimited) {
    // Count existing shortlists
    const existingResult = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `CLIENT#${clientId}`,
        ':skPrefix': 'SHORTLIST#',
      },
      Select: 'COUNT',
    }));

    const currentCount = existingResult.Count || 0;

    if (currentCount >= limits.maxShortlists) {
      logger.warn('Shortlist limit reached', { clientId, currentCount, limit: limits.maxShortlists });
      return {
        success: false,
        error: 'LIMIT_REACHED',
        message: `You have reached your shortlist limit (${limits.maxShortlists}). Upgrade your plan for more shortlists.`,
        status: 400,
      };
    }
  }

  const shortlistId = `SL-${nanoid(12)}`;
  const now = new Date().toISOString();

  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `CLIENT#${clientId}`,
      SK: `SHORTLIST#${shortlistId}`,
      shortlistId,
      clientId,
      name: data.name,
      description: data.description || null,
      candidateCount: 0,
      createdAt: now,
      updatedAt: now,
    },
  }));

  logger.info('Shortlist created', { clientId, shortlistId });

  return {
    success: true,
    shortlist: {
      shortlistId,
      name: data.name,
      description: data.description || null,
      candidateCount: 0,
      createdAt: now,
      updatedAt: now,
    },
    status: 201,
  };
}

/**
 * Delete a shortlist and all its candidates
 */
export async function deleteShortlist(clientId, shortlistId, logger) {
  logger.info('Deleting shortlist', { clientId, shortlistId });

  // Verify ownership
  const shortlistResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: `SHORTLIST#${shortlistId}`,
    },
  }));

  if (!shortlistResult.Item) {
    logger.warn('Shortlist not found', { clientId, shortlistId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Shortlist not found.',
      status: 404,
    };
  }

  // Get all candidates in shortlist
  const candidatesResult = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': `SHORTLIST#${shortlistId}`,
      ':skPrefix': 'CANDIDATE#',
    },
  }));

  // Collect all items to delete
  const deleteKeys = [
    { PK: `CLIENT#${clientId}`, SK: `SHORTLIST#${shortlistId}` },
    ...(candidatesResult.Items || []).map((item) => ({
      PK: item.PK,
      SK: item.SK,
    })),
  ];

  // Batch delete in groups of 25
  const batches = [];
  for (let i = 0; i < deleteKeys.length; i += 25) {
    batches.push(deleteKeys.slice(i, i + 25));
  }

  for (const batch of batches) {
    const deleteRequests = batch.map((key) => ({
      DeleteRequest: { Key: key },
    }));

    await docClient.send(new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: deleteRequests,
      },
    }));
  }

  logger.info('Shortlist deleted', { clientId, shortlistId, itemsDeleted: deleteKeys.length });

  return {
    success: true,
    message: 'Shortlist deleted successfully.',
    status: 200,
  };
}

/**
 * Add a candidate to a shortlist
 */
export async function addCandidateToShortlist(clientId, shortlistId, data, logger) {
  const { candidateId, notes } = data;
  logger.info('Adding candidate to shortlist', { clientId, shortlistId, candidateId });

  // Verify shortlist ownership
  const shortlistResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: `SHORTLIST#${shortlistId}`,
    },
  }));

  if (!shortlistResult.Item) {
    logger.warn('Shortlist not found', { clientId, shortlistId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Shortlist not found.',
      status: 404,
    };
  }

  // Check candidate limit
  const subscription = await getClientSubscription(clientId);
  const limits = getShortlistLimits(subscription?.tier);
  const currentCount = shortlistResult.Item.candidateCount || 0;

  if (limits.maxCandidatesPerShortlist > 0 && currentCount >= limits.maxCandidatesPerShortlist) {
    logger.warn('Candidate limit reached', { clientId, shortlistId, currentCount, limit: limits.maxCandidatesPerShortlist });
    return {
      success: false,
      error: 'LIMIT_REACHED',
      message: `This shortlist has reached its candidate limit (${limits.maxCandidatesPerShortlist}). Upgrade your plan for more candidates.`,
      status: 400,
    };
  }

  // Check if candidate exists and is active
  const candidateResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: 'PROFILE',
    },
  }));

  if (!candidateResult.Item || candidateResult.Item.status !== 'active') {
    logger.warn('Candidate not found or not active', { candidateId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Candidate not found.',
      status: 404,
    };
  }

  // Check if candidate already in shortlist
  const existingResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `SHORTLIST#${shortlistId}`,
      SK: `CANDIDATE#${candidateId}`,
    },
  }));

  if (existingResult.Item) {
    logger.warn('Candidate already in shortlist', { clientId, shortlistId, candidateId });
    return {
      success: false,
      error: 'ALREADY_EXISTS',
      message: 'This candidate is already in the shortlist.',
      status: 400,
    };
  }

  const now = new Date().toISOString();
  const candidateName = `${candidateResult.Item.firstName} ${candidateResult.Item.lastName?.charAt(0) || ''}.`;

  // Add candidate to shortlist
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `SHORTLIST#${shortlistId}`,
      SK: `CANDIDATE#${candidateId}`,
      shortlistId,
      candidateId,
      candidateName,
      notes: notes || null,
      addedAt: now,
    },
  }));

  // Update candidate count
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      ...shortlistResult.Item,
      candidateCount: currentCount + 1,
      updatedAt: now,
    },
  }));

  logger.info('Candidate added to shortlist', { clientId, shortlistId, candidateId });

  return {
    success: true,
    message: 'Candidate added to shortlist.',
    status: 201,
  };
}

/**
 * Remove a candidate from a shortlist
 */
export async function removeCandidateFromShortlist(clientId, shortlistId, candidateId, logger) {
  logger.info('Removing candidate from shortlist', { clientId, shortlistId, candidateId });

  // Verify shortlist ownership
  const shortlistResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: `SHORTLIST#${shortlistId}`,
    },
  }));

  if (!shortlistResult.Item) {
    logger.warn('Shortlist not found', { clientId, shortlistId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Shortlist not found.',
      status: 404,
    };
  }

  // Check if candidate is in shortlist
  const existingResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `SHORTLIST#${shortlistId}`,
      SK: `CANDIDATE#${candidateId}`,
    },
  }));

  if (!existingResult.Item) {
    logger.warn('Candidate not in shortlist', { clientId, shortlistId, candidateId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Candidate not found in this shortlist.',
      status: 404,
    };
  }

  const now = new Date().toISOString();
  const currentCount = shortlistResult.Item.candidateCount || 0;

  // Remove candidate from shortlist
  await docClient.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `SHORTLIST#${shortlistId}`,
      SK: `CANDIDATE#${candidateId}`,
    },
  }));

  // Update candidate count
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      ...shortlistResult.Item,
      candidateCount: Math.max(0, currentCount - 1),
      updatedAt: now,
    },
  }));

  logger.info('Candidate removed from shortlist', { clientId, shortlistId, candidateId });

  return {
    success: true,
    message: 'Candidate removed from shortlist.',
    status: 200,
  };
}

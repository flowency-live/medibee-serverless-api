/**
 * Profile Domain Logic
 * Handles candidate profile operations
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;

// Fields that should NEVER be returned to the client
const INTERNAL_FIELDS = ['PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', 'GSI3PK', 'GSI3SK'];

/**
 * Remove internal fields from profile before returning to client
 */
function sanitizeProfile(profile) {
  const sanitized = { ...profile };
  for (const field of INTERNAL_FIELDS) {
    delete sanitized[field];
  }
  return sanitized;
}

/**
 * Get candidate profile by ID
 */
export async function getProfile(candidateId, logger) {
  logger.info('Getting candidate profile', { candidateId });

  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: 'PROFILE',
    },
  }));

  if (!result.Item) {
    logger.warn('Candidate profile not found', { candidateId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Candidate profile not found',
      status: 404,
    };
  }

  logger.info('Profile retrieved', { candidateId });

  return {
    success: true,
    profile: sanitizeProfile(result.Item),
    status: 200,
  };
}

/**
 * Update candidate profile
 */
export async function updateProfile(candidateId, updates, logger) {
  logger.info('Updating candidate profile', { candidateId, fields: Object.keys(updates) });

  // First, verify the candidate exists
  const existingResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: 'PROFILE',
    },
  }));

  if (!existingResult.Item) {
    logger.warn('Candidate profile not found for update', { candidateId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Candidate profile not found',
      status: 404,
    };
  }

  const existing = existingResult.Item;
  const now = new Date().toISOString();

  // Build update expression
  const updateParts = [];
  const expressionNames = {};
  const expressionValues = { ':now': now };

  for (const [key, value] of Object.entries(updates)) {
    const safeName = `#${key}`;
    const safeValue = `:${key}`;
    updateParts.push(`${safeName} = ${safeValue}`);
    expressionNames[safeName] = key;
    expressionValues[safeValue] = value;
  }

  // Always update the timestamp
  updateParts.push('#updatedAt = :now');
  expressionNames['#updatedAt'] = 'updatedAt';

  // If postcode is being updated, update GSI3 for location search
  if (updates.postcode) {
    updateParts.push('GSI3PK = :gsi3pk');
    updateParts.push('GSI3SK = :gsi3sk');
    expressionValues[':gsi3pk'] = `LOCATION#${updates.postcode.outward}`;
    expressionValues[':gsi3sk'] = `CANDIDATE#${candidateId}`;
  }

  // Check if profile is now complete enough to move to pending_review
  const updatedProfile = { ...existing, ...updates };
  const isComplete = isProfileComplete(updatedProfile);

  if (isComplete && existing.status === 'pending_profile') {
    updateParts.push('#status = :status');
    updateParts.push('GSI2PK = :gsi2pk');
    expressionNames['#status'] = 'status';
    expressionValues[':status'] = 'pending_review';
    expressionValues[':gsi2pk'] = 'STATUS#pending_review';
    logger.info('Profile complete, moving to pending_review', { candidateId });
  }

  const updateExpression = `SET ${updateParts.join(', ')}`;

  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: 'PROFILE',
    },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionNames,
    ExpressionAttributeValues: expressionValues,
    ReturnValues: 'ALL_NEW',
  }));

  // Get the updated profile
  const updatedResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: 'PROFILE',
    },
  }));

  logger.info('Profile updated', { candidateId });

  return {
    success: true,
    profile: sanitizeProfile(updatedResult.Item),
    status: 200,
  };
}

/**
 * Update candidate availability
 */
export async function updateAvailability(candidateId, available, logger) {
  logger.info('Updating availability', { candidateId, available });

  // First, verify the candidate exists
  const existingResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: 'PROFILE',
    },
  }));

  if (!existingResult.Item) {
    logger.warn('Candidate profile not found for availability update', { candidateId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Candidate profile not found',
      status: 404,
    };
  }

  const existing = existingResult.Item;

  // Only active candidates can toggle availability
  if (existing.status !== 'active') {
    logger.warn('Cannot update availability for non-active candidate', { candidateId, status: existing.status });
    return {
      success: false,
      error: 'INVALID_STATUS',
      message: 'Only active candidates can update availability',
      status: 400,
    };
  }

  const now = new Date().toISOString();

  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: 'PROFILE',
    },
    UpdateExpression: 'SET available = :available, updatedAt = :now',
    ExpressionAttributeValues: {
      ':available': available,
      ':now': now,
    },
  }));

  logger.info('Availability updated', { candidateId, available });

  return {
    success: true,
    available,
    message: available ? 'You are now marked as available' : 'You are now marked as unavailable',
    status: 200,
  };
}

/**
 * Check if profile has all required fields for review
 */
function isProfileComplete(profile) {
  const requiredFields = [
    'firstName',
    'lastName',
    'phone',
    'city',
    'postcode',
    'experienceLevel',
    'preferredSettings',
    'professionalSummary',
    'rightToWork',
    'dbsStatus',
  ];

  for (const field of requiredFields) {
    if (!profile[field]) {
      return false;
    }
  }

  // Additional validations
  if (profile.preferredSettings.length === 0) {
    return false;
  }

  if (profile.professionalSummary.length < 10) {
    return false;
  }

  return true;
}

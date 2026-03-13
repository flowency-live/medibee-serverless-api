/**
 * Client Profile Domain Logic
 * Handles client profile CRUD operations
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Fields to exclude from profile response
 */
const SENSITIVE_FIELDS = ['passwordHash', 'PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK'];

/**
 * Strip sensitive fields from profile
 */
function sanitizeProfile(profile) {
  const sanitized = { ...profile };
  for (const field of SENSITIVE_FIELDS) {
    delete sanitized[field];
  }
  return sanitized;
}

/**
 * Get client profile
 */
export async function getProfile(clientId, logger) {
  logger.info('Getting client profile', { clientId });

  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: 'PROFILE',
    },
  }));

  if (!result.Item) {
    logger.warn('Client profile not found', { clientId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Profile not found',
      status: 404,
    };
  }

  logger.info('Client profile retrieved', { clientId });

  return {
    success: true,
    profile: sanitizeProfile(result.Item),
    status: 200,
  };
}

/**
 * Update client profile
 */
export async function updateProfile(clientId, updates, logger) {
  logger.info('Updating client profile', { clientId, fields: Object.keys(updates) });

  // Build update expression dynamically
  const updateParts = [];
  const expressionAttrNames = {};
  const expressionAttrValues = {};

  for (const [key, value] of Object.entries(updates)) {
    // Skip protected fields
    if (['clientId', 'contactEmail', 'status', 'emailVerified', 'createdAt'].includes(key)) {
      continue;
    }

    const attrName = `#${key}`;
    const attrValue = `:${key}`;

    updateParts.push(`${attrName} = ${attrValue}`);
    expressionAttrNames[attrName] = key;
    expressionAttrValues[attrValue] = value;
  }

  // Always update timestamp
  updateParts.push('#updatedAt = :updatedAt');
  expressionAttrNames['#updatedAt'] = 'updatedAt';
  expressionAttrValues[':updatedAt'] = new Date().toISOString();

  const updateExpression = `SET ${updateParts.join(', ')}`;

  try {
    const result = await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `CLIENT#${clientId}`,
        SK: 'PROFILE',
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttrNames,
      ExpressionAttributeValues: expressionAttrValues,
      ConditionExpression: 'attribute_exists(PK)',
      ReturnValues: 'ALL_NEW',
    }));

    logger.info('Client profile updated', { clientId });

    return {
      success: true,
      profile: sanitizeProfile(result.Attributes),
      status: 200,
    };
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      logger.warn('Client profile not found for update', { clientId });
      return {
        success: false,
        error: 'NOT_FOUND',
        message: 'Profile not found',
        status: 404,
      };
    }
    throw error;
  }
}

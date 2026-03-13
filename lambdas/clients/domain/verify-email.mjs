/**
 * Client Email Verification Domain Logic
 * Handles email verification for client accounts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Verify client email with token
 */
export async function verifyClientEmail(token, logger) {
  logger.info('Verifying client email', { tokenPrefix: token.substring(0, 8) });

  // Find verification token
  const tokenResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `VERIFY#${token}`,
      SK: 'VERIFY',
    },
  }));

  const tokenRecord = tokenResult.Item;

  if (!tokenRecord) {
    logger.warn('Verification token not found');
    return {
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Invalid or expired verification token',
      status: 400,
    };
  }

  // Check if token has clientId (client verification)
  if (!tokenRecord.clientId) {
    logger.warn('Token is not for client verification');
    return {
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Invalid verification token',
      status: 400,
    };
  }

  const { clientId, email } = tokenRecord;
  const now = new Date().toISOString();

  logger.info('Token valid, verifying client', { clientId });

  // Update client profile
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: 'PROFILE',
    },
    UpdateExpression: 'SET emailVerified = :verified, #status = :status, GSI2PK = :gsi2pk, updatedAt = :now',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':verified': true,
      ':status': 'active',
      ':gsi2pk': 'STATUS#active',
      ':now': now,
    },
  }));

  // Delete verification token (one-time use)
  await docClient.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `VERIFY#${token}`,
      SK: 'VERIFY',
    },
  }));

  logger.info('Client email verified', { clientId, email });

  return {
    success: true,
    message: 'Email verified successfully. You can now log in.',
    status: 200,
  };
}

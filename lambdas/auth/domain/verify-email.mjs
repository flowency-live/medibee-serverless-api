/**
 * Verify Email Domain Logic
 * Handles email verification tokens
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Verify email using token
 */
export async function verifyEmail(token, logger) {
  logger.info('Looking up verification token');

  // Get the verification token record
  const tokenResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `VERIFY#${token}`,
      SK: 'VERIFY',
    },
  }));

  if (!tokenResult.Item) {
    logger.warn('Verification token not found or expired', { token: token.substring(0, 8) + '...' });
    return {
      success: false,
      error: 'TOKEN_NOT_FOUND',
      message: 'Invalid or expired verification token',
      status: 404,
    };
  }

  const { candidateId, email } = tokenResult.Item;

  logger.info('Token found, checking candidate status', { candidateId });

  // Get the candidate profile
  const profileResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: 'PROFILE',
    },
  }));

  if (!profileResult.Item) {
    logger.error('Candidate profile not found for valid token', { candidateId });
    return {
      success: false,
      error: 'CANDIDATE_NOT_FOUND',
      message: 'Candidate profile not found',
      status: 404,
    };
  }

  if (profileResult.Item.emailVerified) {
    logger.warn('Email already verified', { candidateId });
    return {
      success: false,
      error: 'ALREADY_VERIFIED',
      message: 'Email has already been verified',
      status: 400,
    };
  }

  const now = new Date().toISOString();

  // Update candidate profile to verified
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: 'PROFILE',
    },
    UpdateExpression: 'SET emailVerified = :verified, #status = :status, GSI2PK = :gsi2pk, updatedAt = :now',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':verified': true,
      ':status': 'pending_profile',
      ':gsi2pk': 'STATUS#pending_profile',
      ':now': now,
    },
  }));

  logger.info('Candidate email verified', { candidateId });

  // Delete the verification token (it's been used)
  await docClient.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `VERIFY#${token}`,
      SK: 'VERIFY',
    },
  }));

  logger.info('Verification token deleted', { candidateId });

  return {
    success: true,
    message: 'Email verified successfully. You can now complete your profile.',
    status: 200,
  };
}

/**
 * Reset Password Domain Logic
 * Validates token and updates password
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import argon2 from 'argon2';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Reset password using token
 */
export async function resetPassword(token, newPassword, logger) {
  logger.info('Attempting password reset');

  // Get the reset token record
  const tokenResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `RESET#${token}`,
      SK: 'PASSWORD_RESET',
    },
  }));

  if (!tokenResult.Item) {
    logger.warn('Password reset token not found or expired', { token: token.substring(0, 8) + '...' });
    return {
      success: false,
      error: 'TOKEN_NOT_FOUND',
      message: 'Invalid or expired password reset link',
      status: 404,
    };
  }

  const { candidateId, email } = tokenResult.Item;

  logger.info('Token found, resetting password', { candidateId });

  // Hash the new password
  const passwordHash = await argon2.hash(newPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const now = new Date().toISOString();

  // Update the password in auth record
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: 'AUTH#CREDENTIALS',
    },
    UpdateExpression: 'SET passwordHash = :hash, updatedAt = :now',
    ExpressionAttributeValues: {
      ':hash': passwordHash,
      ':now': now,
    },
  }));

  logger.info('Password updated', { candidateId });

  // Delete the reset token (single use)
  await docClient.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `RESET#${token}`,
      SK: 'PASSWORD_RESET',
    },
  }));

  logger.info('Reset token deleted', { candidateId });

  return {
    success: true,
    message: 'Password reset successfully. You can now log in with your new password.',
    status: 200,
  };
}

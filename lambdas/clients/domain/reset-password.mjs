/**
 * Client Reset Password Domain Logic
 * Handles password reset for client accounts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { hashPassword } from '/opt/nodejs/lib/password.mjs';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Reset password using token
 */
export async function resetPassword(token, newPassword, userType, logger) {
  logger.info('Password reset attempt', { tokenPrefix: token.substring(0, 8), userType });

  // Find reset token
  const tokenResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `RESET#${token}`,
      SK: 'RESET',
    },
  }));

  const tokenRecord = tokenResult.Item;

  if (!tokenRecord) {
    logger.warn('Reset token not found or expired');
    return {
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Invalid or expired reset token',
      status: 400,
    };
  }

  // Verify token is for client
  if (tokenRecord.userType !== 'client' || !tokenRecord.clientId) {
    logger.warn('Token user type mismatch');
    return {
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Invalid reset token',
      status: 400,
    };
  }

  const { clientId, email } = tokenRecord;
  const now = new Date().toISOString();

  logger.info('Token valid, resetting password', { clientId });

  // Hash new password using OWASP-recommended Argon2id
  const passwordHash = await hashPassword(newPassword);

  // Update password
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: 'AUTH#CREDENTIALS',
    },
    UpdateExpression: 'SET passwordHash = :hash, updatedAt = :now',
    ExpressionAttributeValues: {
      ':hash': passwordHash,
      ':now': now,
    },
  }));

  // Delete reset token (one-time use)
  await docClient.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `RESET#${token}`,
      SK: 'RESET',
    },
  }));

  logger.info('Password reset successful', { clientId });

  return {
    success: true,
    message: 'Password reset successfully. You can now log in with your new password.',
    status: 200,
  };
}

/**
 * Client Logout Domain Logic
 * Handles client session invalidation
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Logout client by invalidating session
 */
export async function logoutClient(sessionId, clientId, logger) {
  logger.info('Logging out client', { clientId, sessionId: sessionId?.substring(0, 8) });

  if (sessionId) {
    try {
      await docClient.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `SESSION#${sessionId}`,
          SK: 'SESSION',
        },
      }));
      logger.info('Session deleted', { clientId });
    } catch (error) {
      // Log but don't fail - session may already be expired
      logger.warn('Failed to delete session', {
        clientId,
        error: error.message,
      });
    }
  }

  return {
    success: true,
    message: 'Logged out successfully',
    status: 200,
  };
}

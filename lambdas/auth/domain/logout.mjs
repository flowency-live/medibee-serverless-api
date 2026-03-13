/**
 * Logout Domain Logic
 * Invalidates candidate session
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Logout a candidate by deleting their session
 */
export async function logoutCandidate(sessionId, candidateId, logger) {
  logger.info('Logging out candidate', { candidateId, sessionId });

  if (!sessionId) {
    logger.warn('No session ID provided for logout', { candidateId });
    return {
      success: true,
      message: 'Logged out successfully',
      status: 200,
    };
  }

  // Delete the session record
  await docClient.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'SESSION',
    },
  }));

  logger.info('Session deleted', { candidateId, sessionId });

  return {
    success: true,
    message: 'Logged out successfully',
    status: 200,
  };
}

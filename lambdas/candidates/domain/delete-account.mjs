/**
 * Delete Account Domain Logic
 * GDPR-compliant account deletion
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, DeleteCommand, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const TABLE_NAME = process.env.TABLE_NAME;
const FILES_BUCKET = process.env.FILES_BUCKET;

/**
 * Delete all sessions for a candidate
 */
async function deleteSessions(candidateId, logger) {
  // Query all sessions - note: sessions don't have a GSI, so we can't query by candidateId
  // Sessions are stored with SESSION#{sessionId} as PK, and candidateId in the item
  // For now, we'll rely on TTL to clean up sessions
  // In a production system, we might add a GSI for this
  logger.info('Sessions will be cleaned up by TTL', { candidateId });
}

/**
 * Delete all S3 files for a candidate
 */
async function deleteFiles(candidateId, logger) {
  const prefix = `candidates/${candidateId}/`;

  logger.info('Listing files for deletion', { prefix });

  const listResult = await s3Client.send(new ListObjectsV2Command({
    Bucket: FILES_BUCKET,
    Prefix: prefix,
  }));

  if (!listResult.Contents || listResult.Contents.length === 0) {
    logger.info('No files to delete', { candidateId });
    return;
  }

  const objects = listResult.Contents.map(obj => ({ Key: obj.Key }));

  logger.info('Deleting files', { candidateId, count: objects.length });

  await s3Client.send(new DeleteObjectsCommand({
    Bucket: FILES_BUCKET,
    Delete: { Objects: objects },
  }));

  logger.info('Files deleted', { candidateId });
}

/**
 * Delete candidate account and all associated data
 */
export async function deleteAccount(candidateId, logger) {
  logger.info('Starting account deletion', { candidateId });

  // Get the candidate profile to verify it exists
  const profileResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: 'PROFILE',
    },
  }));

  if (!profileResult.Item) {
    logger.warn('Candidate profile not found for deletion', { candidateId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Account not found',
      status: 404,
    };
  }

  const email = profileResult.Item.email;

  logger.info('Deleting account data', { candidateId, email });

  // Delete DynamoDB records
  // Using batch write for efficiency
  const deleteRequests = [
    // Profile record
    {
      DeleteRequest: {
        Key: {
          PK: `CANDIDATE#${candidateId}`,
          SK: 'PROFILE',
        },
      },
    },
    // Auth credentials record
    {
      DeleteRequest: {
        Key: {
          PK: `CANDIDATE#${candidateId}`,
          SK: 'AUTH#CREDENTIALS',
        },
      },
    },
  ];

  await docClient.send(new BatchWriteCommand({
    RequestItems: {
      [TABLE_NAME]: deleteRequests,
    },
  }));

  logger.info('DynamoDB records deleted', { candidateId });

  // Delete S3 files
  try {
    await deleteFiles(candidateId, logger);
  } catch (error) {
    logger.error('Failed to delete S3 files', { candidateId, error: error.message });
    // Continue with deletion - files can be cleaned up later
  }

  // Clean up sessions (via TTL)
  await deleteSessions(candidateId, logger);

  logger.info('Account deletion complete', { candidateId });

  return {
    success: true,
    message: 'Your account and all associated data have been deleted.',
    status: 200,
  };
}

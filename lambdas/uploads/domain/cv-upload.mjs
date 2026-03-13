/**
 * CV Upload Domain Logic
 * Handles CV file uploads with presigned URLs
 */

import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { isAllowedContentType, getExtensionFromContentType, MAGIC_BYTES } from '../validation.mjs';

const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const BUCKET_NAME = process.env.FILES_BUCKET;
const TABLE_NAME = process.env.TABLE_NAME;
const PRESIGNED_URL_EXPIRY = 300; // 5 minutes

/**
 * Generate presigned URL for CV upload
 */
export async function generatePresignedUrl(candidateId, contentType, filename, logger) {
  logger.info('Generating presigned URL', { candidateId, contentType, filename });

  // Validate content type
  if (!isAllowedContentType(contentType)) {
    logger.warn('Invalid content type', { contentType });
    return {
      success: false,
      error: 'INVALID_CONTENT_TYPE',
      message: 'Only PDF, DOC, and DOCX files are allowed',
      status: 400,
    };
  }

  const extension = getExtensionFromContentType(contentType);
  const timestamp = Date.now();
  const key = `candidates/${candidateId}/cv-${timestamp}.${extension}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    // Metadata to track original filename
    Metadata: {
      'original-filename': encodeURIComponent(filename),
      'candidate-id': candidateId,
    },
  });

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: PRESIGNED_URL_EXPIRY,
  });

  logger.info('Presigned URL generated', { candidateId, key });

  return {
    success: true,
    uploadUrl,
    key,
    expiresIn: PRESIGNED_URL_EXPIRY,
    status: 200,
  };
}

/**
 * Confirm CV upload and validate file
 */
export async function confirmUpload(candidateId, key, logger) {
  logger.info('Confirming upload', { candidateId, key });

  // Security: Ensure the key belongs to this candidate
  const expectedPrefix = `candidates/${candidateId}/`;
  if (!key.startsWith(expectedPrefix)) {
    logger.warn('Attempt to confirm file belonging to another candidate', {
      candidateId,
      key,
    });
    return {
      success: false,
      error: 'FORBIDDEN',
      message: 'You can only confirm your own uploads',
      status: 403,
    };
  }

  // Check if file exists
  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }));
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      logger.warn('File not found', { candidateId, key });
      return {
        success: false,
        error: 'FILE_NOT_FOUND',
        message: 'File not found. Please upload the file first.',
        status: 404,
      };
    }
    throw error;
  }

  // Get file to validate magic bytes
  const getResponse = await s3Client.send(new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Range: 'bytes=0-7', // Only fetch first 8 bytes for magic byte check
  }));

  const chunks = [];
  for await (const chunk of getResponse.Body) {
    chunks.push(chunk);
  }
  const fileHeader = Buffer.concat(chunks);

  // Determine expected file type from key
  const extension = key.split('.').pop().toLowerCase();
  const expectedMagic = MAGIC_BYTES[extension];

  if (expectedMagic) {
    const actualMagic = fileHeader.subarray(0, expectedMagic.length);
    if (!actualMagic.equals(expectedMagic)) {
      logger.warn('Invalid file magic bytes', {
        candidateId,
        key,
        extension,
        expected: expectedMagic.toString('hex'),
        actual: actualMagic.toString('hex'),
      });
      return {
        success: false,
        error: 'INVALID_FILE_TYPE',
        message: 'File content does not match expected type. Please upload a valid PDF or Word document.',
        status: 400,
      };
    }
  }

  const now = new Date().toISOString();

  // Update candidate profile with CV key
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: 'PROFILE',
    },
    UpdateExpression: 'SET cvKey = :cvKey, cvUploadedAt = :now, updatedAt = :now',
    ExpressionAttributeValues: {
      ':cvKey': key,
      ':now': now,
    },
  }));

  logger.info('CV upload confirmed', { candidateId, key });

  return {
    success: true,
    message: 'CV upload confirmed successfully',
    key,
    status: 200,
  };
}

/**
 * Login Domain Logic
 * Handles candidate authentication
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { getJWTSecret } from '/opt/nodejs/lib/auth.mjs';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;
const JWT_EXPIRY = '7d';

/**
 * Find candidate by email using GSI1
 */
async function findCandidateByEmail(email) {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `EMAIL#${email}`,
    },
    Limit: 1,
  }));

  return result.Items?.[0] || null;
}

/**
 * Get candidate auth credentials
 */
async function getAuthCredentials(candidateId) {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: 'AUTH#CREDENTIALS',
    },
  }));

  return result.Item || null;
}

/**
 * Create session record
 */
async function createSession(candidateId, sessionId) {
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days

  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `SESSION#${sessionId}`,
      SK: 'SESSION',
      candidateId,
      createdAt: now,
      TTL: ttl,
    },
  }));
}

/**
 * Login a candidate
 */
export async function loginCandidate(email, password, logger) {
  logger.info('Attempting login', { email });

  // Find candidate by email
  const profile = await findCandidateByEmail(email);

  if (!profile) {
    logger.warn('Login failed - email not found', { email });
    return {
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
      status: 401,
    };
  }

  const { candidateId, emailVerified, status, firstName, lastName } = profile;

  // Get auth credentials
  const auth = await getAuthCredentials(candidateId);

  if (!auth) {
    logger.error('Auth credentials not found for candidate', { candidateId });
    return {
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
      status: 401,
    };
  }

  // Verify password
  const passwordValid = await argon2.verify(auth.passwordHash, password);

  if (!passwordValid) {
    logger.warn('Login failed - invalid password', { candidateId });
    return {
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
      status: 401,
    };
  }

  // Check email verification
  if (!emailVerified) {
    logger.warn('Login failed - email not verified', { candidateId });
    return {
      success: false,
      error: 'EMAIL_NOT_VERIFIED',
      message: 'Please verify your email before logging in',
      status: 403,
    };
  }

  // Check account status
  if (status === 'suspended' || status === 'rejected') {
    logger.warn('Login failed - account suspended/rejected', { candidateId, status });
    return {
      success: false,
      error: 'ACCOUNT_DISABLED',
      message: 'Your account has been disabled. Please contact support.',
      status: 403,
    };
  }

  // Generate session and JWT
  const sessionId = nanoid(32);
  const secret = await getJWTSecret();

  const token = jwt.sign(
    {
      candidateId,
      sessionId,
      email,
    },
    secret,
    {
      algorithm: 'HS256',
      expiresIn: JWT_EXPIRY,
    }
  );

  // Create session record
  await createSession(candidateId, sessionId);

  logger.info('Login successful', { candidateId });

  return {
    success: true,
    token,
    candidateId,
    profile: {
      firstName,
      lastName,
      email,
      status,
    },
    status: 200,
  };
}

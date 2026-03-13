/**
 * Client Login Domain Logic
 * Handles client/organisation authentication
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { verifyPassword } from '/opt/nodejs/lib/password.mjs';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { getJWTSecret } from '/opt/nodejs/lib/auth.mjs';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;
const JWT_EXPIRY = '7d';

/**
 * Find client by email using GSI1
 */
async function findClientByEmail(email) {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
    ExpressionAttributeValues: {
      ':pk': `EMAIL#${email}`,
      ':sk': 'CLIENT',
    },
    Limit: 1,
  }));

  return result.Items?.[0] || null;
}

/**
 * Get client auth credentials
 */
async function getAuthCredentials(clientId) {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: 'AUTH#CREDENTIALS',
    },
  }));

  return result.Item || null;
}

/**
 * Create session record
 */
async function createSession(clientId, sessionId) {
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days

  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `SESSION#${sessionId}`,
      SK: 'SESSION',
      clientId,
      userType: 'client',
      createdAt: now,
      TTL: ttl,
    },
  }));
}

/**
 * Login a client
 */
export async function loginClient(email, password, logger) {
  logger.info('Attempting client login', { email });

  // Find client by email
  const profile = await findClientByEmail(email);

  if (!profile) {
    logger.warn('Client login failed - email not found', { email });
    return {
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
      status: 401,
    };
  }

  const {
    clientId,
    emailVerified,
    status,
    organisationName,
    contactName,
    organisationType,
  } = profile;

  // Get auth credentials
  const auth = await getAuthCredentials(clientId);

  if (!auth) {
    logger.error('Auth credentials not found for client', { clientId });
    return {
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
      status: 401,
    };
  }

  // Verify password
  const passwordValid = await verifyPassword(auth.passwordHash, password);

  if (!passwordValid) {
    logger.warn('Client login failed - invalid password', { clientId });
    return {
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
      status: 401,
    };
  }

  // Check email verification
  if (!emailVerified) {
    logger.warn('Client login failed - email not verified', { clientId });
    return {
      success: false,
      error: 'EMAIL_NOT_VERIFIED',
      message: 'Please verify your email before logging in',
      status: 403,
    };
  }

  // Check account status
  if (status === 'suspended') {
    logger.warn('Client login failed - account suspended', { clientId, status });
    return {
      success: false,
      error: 'ACCOUNT_DISABLED',
      message: 'Your account has been suspended. Please contact support.',
      status: 403,
    };
  }

  // Generate session and JWT
  const sessionId = nanoid(32);
  const secret = await getJWTSecret();

  const token = jwt.sign(
    {
      clientId,
      sessionId,
      email,
      userType: 'client',
    },
    secret,
    {
      algorithm: 'HS256',
      expiresIn: JWT_EXPIRY,
    }
  );

  // Create session record
  await createSession(clientId, sessionId);

  logger.info('Client login successful', { clientId });

  return {
    success: true,
    token,
    clientId,
    profile: {
      organisationName,
      contactName,
      email,
      organisationType,
      status,
    },
    status: 200,
  };
}

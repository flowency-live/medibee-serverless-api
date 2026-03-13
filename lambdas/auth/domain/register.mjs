/**
 * Register Domain Logic
 * Handles candidate registration
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sesClient = new SESClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@medibee-recruitment.co.uk';
const SITE_URL = process.env.SITE_URL || 'https://medibee.opstack.uk';

/**
 * Check if email already exists
 */
async function emailExists(email) {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `EMAIL#${email}`,
    },
    Limit: 1,
  }));

  return result.Items && result.Items.length > 0;
}

/**
 * Generate a verification token
 */
function generateVerificationToken() {
  return nanoid(32);
}

/**
 * Calculate TTL for verification token (24 hours)
 */
function getTokenTTL() {
  return Math.floor(Date.now() / 1000) + (24 * 60 * 60);
}

/**
 * Send verification email
 */
async function sendVerificationEmail(email, firstName, token) {
  const verifyUrl = `${SITE_URL}/verify-email?token=${token}`;

  await sesClient.send(new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: {
      ToAddresses: [email],
    },
    Message: {
      Subject: {
        Data: 'Verify your Medibee account',
        Charset: 'UTF-8',
      },
      Body: {
        Html: {
          Data: `
            <h1>Welcome to Medibee, ${firstName}!</h1>
            <p>Thank you for registering. Please verify your email address by clicking the link below:</p>
            <p><a href="${verifyUrl}">Verify Email Address</a></p>
            <p>This link will expire in 24 hours.</p>
            <p>If you didn't create an account, please ignore this email.</p>
            <p>Best regards,<br>The Medibee Team</p>
          `,
          Charset: 'UTF-8',
        },
        Text: {
          Data: `
Welcome to Medibee, ${firstName}!

Thank you for registering. Please verify your email address by visiting this link:

${verifyUrl}

This link will expire in 24 hours.

If you didn't create an account, please ignore this email.

Best regards,
The Medibee Team
          `,
          Charset: 'UTF-8',
        },
      },
    },
  }));
}

/**
 * Register a new candidate
 */
export async function registerCandidate(data, logger) {
  const { email, password, firstName, lastName, phone } = data;

  logger.info('Checking if email exists', { email });

  // Check for duplicate email
  const exists = await emailExists(email);
  if (exists) {
    logger.warn('Email already exists', { email });
    return {
      success: false,
      error: 'EMAIL_EXISTS',
      message: 'An account with this email already exists',
      status: 409,
    };
  }

  // Generate IDs
  const candidateId = `CAND-${nanoid(12)}`;
  const verificationToken = generateVerificationToken();
  const now = new Date().toISOString();
  const tokenTTL = getTokenTTL();

  logger.info('Creating new candidate', { candidateId });

  // Hash password
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  // Create candidate profile record
  const profileItem = {
    PK: `CANDIDATE#${candidateId}`,
    SK: 'PROFILE',
    candidateId,
    email,
    firstName,
    lastName,
    phone,
    status: 'pending_verification',
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
    // GSI1: Email lookup
    GSI1PK: `EMAIL#${email}`,
    GSI1SK: 'CANDIDATE',
    // GSI2: Status filter
    GSI2PK: 'STATUS#pending_verification',
    GSI2SK: `CANDIDATE#${candidateId}`,
  };

  // Create auth record (stores password hash separately)
  const authItem = {
    PK: `CANDIDATE#${candidateId}`,
    SK: 'AUTH#CREDENTIALS',
    candidateId,
    passwordHash,
    createdAt: now,
    updatedAt: now,
  };

  // Create verification token record
  const verifyItem = {
    PK: `VERIFY#${verificationToken}`,
    SK: 'VERIFY',
    candidateId,
    email,
    createdAt: now,
    TTL: tokenTTL,
  };

  // Write all items (using individual puts for simplicity, could use TransactWrite)
  await Promise.all([
    docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: profileItem,
      ConditionExpression: 'attribute_not_exists(PK)',
    })),
    docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: authItem,
    })),
    docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: verifyItem,
    })),
  ]);

  logger.info('Candidate created, sending verification email', { candidateId });

  // Send verification email
  try {
    await sendVerificationEmail(email, firstName, verificationToken);
    logger.info('Verification email sent', { candidateId, email });
  } catch (error) {
    // Log but don't fail - candidate is created, they can request resend
    logger.error('Failed to send verification email', {
      candidateId,
      email,
      error: error.message,
    });
  }

  return {
    success: true,
    candidateId,
    message: 'Registration successful. Please check your email for verification link.',
    status: 201,
  };
}

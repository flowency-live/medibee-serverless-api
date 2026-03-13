/**
 * Client Register Domain Logic
 * Handles organisation/client registration
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
 * Check if email already exists (for clients or candidates)
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
 * Send verification email for client
 */
async function sendVerificationEmail(email, contactName, organisationName, token) {
  const verifyUrl = `${SITE_URL}/client/verify-email?token=${token}`;

  await sesClient.send(new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: {
      ToAddresses: [email],
    },
    Message: {
      Subject: {
        Data: 'Verify your Medibee organisation account',
        Charset: 'UTF-8',
      },
      Body: {
        Html: {
          Data: `
            <h1>Welcome to Medibee, ${contactName}!</h1>
            <p>Thank you for registering <strong>${organisationName}</strong> with Medibee.</p>
            <p>Please verify your email address by clicking the link below:</p>
            <p><a href="${verifyUrl}">Verify Email Address</a></p>
            <p>This link will expire in 24 hours.</p>
            <p>Once verified, you'll be able to browse our talent pool and find the perfect healthcare professionals for your organisation.</p>
            <p>If you didn't create this account, please ignore this email.</p>
            <p>Best regards,<br>The Medibee Team</p>
          `,
          Charset: 'UTF-8',
        },
        Text: {
          Data: `
Welcome to Medibee, ${contactName}!

Thank you for registering ${organisationName} with Medibee.

Please verify your email address by visiting this link:

${verifyUrl}

This link will expire in 24 hours.

Once verified, you'll be able to browse our talent pool and find the perfect healthcare professionals for your organisation.

If you didn't create this account, please ignore this email.

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
 * Register a new client organisation
 */
export async function registerClient(data, logger) {
  const {
    organisationName,
    organisationType,
    contactName,
    contactEmail,
    contactPhone,
    billingEmail,
    password,
    address,
    cqcNumber,
  } = data;

  logger.info('Checking if email exists', { contactEmail });

  // Check for duplicate email
  const exists = await emailExists(contactEmail);
  if (exists) {
    logger.warn('Email already exists', { contactEmail });
    return {
      success: false,
      error: 'EMAIL_EXISTS',
      message: 'An account with this email already exists',
      status: 409,
    };
  }

  // Generate IDs
  const clientId = `CLI-${nanoid(12)}`;
  const verificationToken = generateVerificationToken();
  const now = new Date().toISOString();
  const tokenTTL = getTokenTTL();

  logger.info('Creating new client', { clientId, organisationName });

  // Hash password
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  // Create client profile record
  const profileItem = {
    PK: `CLIENT#${clientId}`,
    SK: 'PROFILE',
    clientId,
    organisationName,
    organisationType,
    contactName,
    contactEmail,
    contactPhone,
    billingEmail,
    address: address || null,
    cqcNumber: cqcNumber || null,
    status: 'pending_verification',
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
    // GSI1: Email lookup
    GSI1PK: `EMAIL#${contactEmail}`,
    GSI1SK: 'CLIENT',
    // GSI2: Status filter
    GSI2PK: 'STATUS#pending_verification',
    GSI2SK: `CLIENT#${clientId}`,
  };

  // Create auth record (stores password hash separately)
  const authItem = {
    PK: `CLIENT#${clientId}`,
    SK: 'AUTH#CREDENTIALS',
    clientId,
    passwordHash,
    createdAt: now,
    updatedAt: now,
  };

  // Create verification token record
  const verifyItem = {
    PK: `VERIFY#${verificationToken}`,
    SK: 'VERIFY',
    clientId,
    email: contactEmail,
    userType: 'client',
    createdAt: now,
    TTL: tokenTTL,
  };

  // Write all items
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

  logger.info('Client created, sending verification email', { clientId });

  // Send verification email
  try {
    await sendVerificationEmail(contactEmail, contactName, organisationName, verificationToken);
    logger.info('Verification email sent', { clientId, contactEmail });
  } catch (error) {
    // Log but don't fail - client is created, they can request resend
    logger.error('Failed to send verification email', {
      clientId,
      contactEmail,
      error: error.message,
    });
  }

  return {
    success: true,
    clientId,
    message: 'Registration successful. Please check your email for verification link.',
    status: 201,
  };
}

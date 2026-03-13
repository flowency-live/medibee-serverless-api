/**
 * Client Forgot Password Domain Logic
 * Handles password reset requests for client accounts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { nanoid } from 'nanoid';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sesClient = new SESClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@medibee-recruitment.co.uk';
const SITE_URL = process.env.SITE_URL || 'https://medibee.opstack.uk';

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
 * Generate reset token (1 hour TTL)
 */
function generateResetToken() {
  return nanoid(32);
}

function getTokenTTL() {
  return Math.floor(Date.now() / 1000) + (60 * 60); // 1 hour
}

/**
 * Send password reset email
 */
async function sendResetEmail(email, contactName, token) {
  const resetUrl = `${SITE_URL}/client/reset-password?token=${token}`;

  await sesClient.send(new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: {
      ToAddresses: [email],
    },
    Message: {
      Subject: {
        Data: 'Reset your Medibee password',
        Charset: 'UTF-8',
      },
      Body: {
        Html: {
          Data: `
            <h1>Password Reset Request</h1>
            <p>Hi ${contactName},</p>
            <p>We received a request to reset your password. Click the link below to set a new password:</p>
            <p><a href="${resetUrl}">Reset Password</a></p>
            <p>This link will expire in 1 hour.</p>
            <p>If you didn't request this, please ignore this email. Your password will remain unchanged.</p>
            <p>Best regards,<br>The Medibee Team</p>
          `,
          Charset: 'UTF-8',
        },
        Text: {
          Data: `
Password Reset Request

Hi ${contactName},

We received a request to reset your password. Visit the link below to set a new password:

${resetUrl}

This link will expire in 1 hour.

If you didn't request this, please ignore this email. Your password will remain unchanged.

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
 * Request password reset for client
 */
export async function requestPasswordReset(email, userType, logger) {
  logger.info('Password reset requested', { email, userType });

  // Find client by email
  const client = await findClientByEmail(email);

  // SECURITY: Always return success to prevent email enumeration
  if (!client) {
    logger.info('Client not found for password reset', { email });
    return {
      success: true,
      message: 'If an account exists with this email, you will receive a password reset link.',
      status: 200,
    };
  }

  const { clientId, contactName, emailVerified } = client;

  // Don't send reset email if account not verified
  if (!emailVerified) {
    logger.info('Client email not verified', { clientId });
    return {
      success: true,
      message: 'If an account exists with this email, you will receive a password reset link.',
      status: 200,
    };
  }

  // Generate reset token
  const resetToken = generateResetToken();
  const now = new Date().toISOString();
  const tokenTTL = getTokenTTL();

  // Store reset token
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `RESET#${resetToken}`,
      SK: 'RESET',
      clientId,
      email,
      userType: 'client',
      createdAt: now,
      TTL: tokenTTL,
    },
  }));

  // Send reset email
  try {
    await sendResetEmail(email, contactName, resetToken);
    logger.info('Password reset email sent', { clientId, email });
  } catch (error) {
    logger.error('Failed to send password reset email', {
      clientId,
      email,
      error: error.message,
    });
    // Still return success to prevent enumeration
  }

  return {
    success: true,
    message: 'If an account exists with this email, you will receive a password reset link.',
    status: 200,
  };
}

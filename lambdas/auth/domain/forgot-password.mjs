/**
 * Forgot Password Domain Logic
 * Generates password reset token and sends email
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
 * Generate password reset token
 */
function generateResetToken() {
  return nanoid(32);
}

/**
 * Calculate TTL for reset token (1 hour)
 */
function getTokenTTL() {
  return Math.floor(Date.now() / 1000) + (60 * 60);
}

/**
 * Send password reset email
 */
async function sendResetEmail(email, firstName, token) {
  const resetUrl = `${SITE_URL}/reset-password?token=${token}`;

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
            <p>Hi ${firstName},</p>
            <p>We received a request to reset your Medibee account password. Click the link below to set a new password:</p>
            <p><a href="${resetUrl}">Reset Password</a></p>
            <p>This link will expire in 1 hour.</p>
            <p>If you didn't request this password reset, please ignore this email. Your password will remain unchanged.</p>
            <p>Best regards,<br>The Medibee Team</p>
          `,
          Charset: 'UTF-8',
        },
        Text: {
          Data: `
Password Reset Request

Hi ${firstName},

We received a request to reset your Medibee account password. Visit this link to set a new password:

${resetUrl}

This link will expire in 1 hour.

If you didn't request this password reset, please ignore this email. Your password will remain unchanged.

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
 * Request password reset
 * Note: Always returns success to prevent email enumeration
 */
export async function requestPasswordReset(email, logger) {
  logger.info('Password reset requested', { email });

  // Find candidate by email
  const candidate = await findCandidateByEmail(email);

  // Always return success to prevent email enumeration
  const successResponse = {
    success: true,
    message: 'If an account exists with this email, a password reset link has been sent.',
    status: 200,
  };

  if (!candidate) {
    logger.info('No account found for email (not revealing to user)', { email });
    return successResponse;
  }

  const { candidateId, firstName } = candidate;

  // Generate reset token
  const resetToken = generateResetToken();
  const now = new Date().toISOString();
  const tokenTTL = getTokenTTL();

  logger.info('Creating password reset token', { candidateId });

  // Create reset token record
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `RESET#${resetToken}`,
      SK: 'PASSWORD_RESET',
      candidateId,
      email,
      createdAt: now,
      TTL: tokenTTL,
    },
  }));

  // Send reset email
  try {
    await sendResetEmail(email, firstName, resetToken);
    logger.info('Password reset email sent', { candidateId, email });
  } catch (error) {
    logger.error('Failed to send password reset email', {
      candidateId,
      email,
      error: error.message,
    });
    // Still return success to prevent enumeration
  }

  return successResponse;
}

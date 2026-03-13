/**
 * Request Contact Domain Logic
 * Handles contact request creation with credit deduction
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { nanoid } from 'nanoid';
import { hasUnlimitedCredits } from '../../subscription/config.mjs';
import { ContactStatus } from '../validation.mjs';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sesClient = new SESClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@medibee-recruitment.co.uk';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@medibee-recruitment.co.uk';

/**
 * Get client profile and subscription
 */
async function getClientWithSubscription(clientId) {
  const [profileResult, subscriptionResult] = await Promise.all([
    docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CLIENT#${clientId}`, SK: 'PROFILE' },
    })),
    docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CLIENT#${clientId}`, SK: 'SUBSCRIPTION' },
    })),
  ]);

  return {
    profile: profileResult.Item,
    subscription: subscriptionResult.Item,
  };
}

/**
 * Get candidate profile
 */
async function getCandidateProfile(candidateId) {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: `CANDIDATE#${candidateId}`, SK: 'PROFILE' },
  }));

  return result.Item;
}

/**
 * Check for existing contact request
 */
async function hasExistingRequest(clientId, candidateId) {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    FilterExpression: 'candidateId = :candidateId AND #status IN (:pending, :contacted)',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':pk': `CLIENT#${clientId}`,
      ':skPrefix': 'CONTACT#',
      ':candidateId': candidateId,
      ':pending': ContactStatus.PENDING,
      ':contacted': ContactStatus.CONTACTED,
    },
    Limit: 1,
  }));

  return (result.Items || []).length > 0;
}

/**
 * Send notification emails
 */
async function sendNotificationEmails(contact, client, candidate, logger) {
  const candidateEmailBody = `
    <h1>You have a new contact request!</h1>
    <p>Hi ${candidate.firstName},</p>
    <p>Great news! <strong>${client.organisationName}</strong> is interested in connecting with you through Medibee.</p>
    <p><strong>Message from ${client.contactName}:</strong></p>
    <blockquote style="border-left: 4px solid #696F8B; padding-left: 16px; margin: 16px 0;">
      ${contact.message}
    </blockquote>
    <p>Please log in to your Medibee account to view this request and respond.</p>
    <p>Best regards,<br>The Medibee Team</p>
  `;

  const clientEmailBody = `
    <h1>Contact Request Sent</h1>
    <p>Hi ${client.contactName},</p>
    <p>Your contact request to <strong>${candidate.firstName}</strong> has been sent successfully.</p>
    <p>We've notified the candidate of your interest. You'll receive an email when they respond.</p>
    <p><strong>Your message:</strong></p>
    <blockquote style="border-left: 4px solid #696F8B; padding-left: 16px; margin: 16px 0;">
      ${contact.message}
    </blockquote>
    <p>Best regards,<br>The Medibee Team</p>
  `;

  const adminEmailBody = `
    <h1>New Contact Request</h1>
    <p>A new contact request has been submitted:</p>
    <ul>
      <li><strong>Client:</strong> ${client.organisationName} (${client.contactEmail})</li>
      <li><strong>Candidate:</strong> ${candidate.firstName} ${candidate.lastName} (${candidate.email})</li>
      <li><strong>Contact ID:</strong> ${contact.contactId}</li>
      <li><strong>Timestamp:</strong> ${contact.createdAt}</li>
    </ul>
    <p><strong>Message:</strong></p>
    <blockquote style="border-left: 4px solid #696F8B; padding-left: 16px; margin: 16px 0;">
      ${contact.message}
    </blockquote>
  `;

  try {
    await Promise.all([
      // Email to candidate
      sesClient.send(new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [candidate.email] },
        Message: {
          Subject: { Data: `New contact request from ${client.organisationName}`, Charset: 'UTF-8' },
          Body: { Html: { Data: candidateEmailBody, Charset: 'UTF-8' } },
        },
      })),
      // Email to client
      sesClient.send(new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [client.contactEmail] },
        Message: {
          Subject: { Data: 'Your contact request has been sent', Charset: 'UTF-8' },
          Body: { Html: { Data: clientEmailBody, Charset: 'UTF-8' } },
        },
      })),
      // Email to admin
      sesClient.send(new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [ADMIN_EMAIL] },
        Message: {
          Subject: { Data: `New contact request: ${client.organisationName} → ${candidate.firstName}`, Charset: 'UTF-8' },
          Body: { Html: { Data: adminEmailBody, Charset: 'UTF-8' } },
        },
      })),
    ]);

    logger.info('Notification emails sent', { contactId: contact.contactId });
  } catch (error) {
    logger.error('Failed to send notification emails', { error: error.message });
    // Don't fail the request if emails fail
  }
}

/**
 * Request contact with a candidate
 */
export async function requestContact(clientId, data, logger) {
  const { candidateId, message } = data;
  logger.info('Processing contact request', { clientId, candidateId });

  // Get client and subscription
  const { profile: client, subscription } = await getClientWithSubscription(clientId);

  if (!client) {
    logger.warn('Client not found', { clientId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Client not found.',
      status: 404,
    };
  }

  // Check subscription
  if (!subscription || subscription.status !== 'active') {
    logger.warn('No active subscription', { clientId });
    return {
      success: false,
      error: 'NO_SUBSCRIPTION',
      message: 'You need an active subscription to contact candidates.',
      status: 403,
    };
  }

  // Check for existing request
  const hasExisting = await hasExistingRequest(clientId, candidateId);
  if (hasExisting) {
    logger.warn('Duplicate contact request', { clientId, candidateId });
    return {
      success: false,
      error: 'DUPLICATE_REQUEST',
      message: 'You already have an active contact request for this candidate.',
      status: 400,
    };
  }

  // Get candidate
  const candidate = await getCandidateProfile(candidateId);

  if (!candidate || candidate.status !== 'active') {
    logger.warn('Candidate not found or not active', { candidateId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Candidate not found.',
      status: 404,
    };
  }

  // Check credits (unless unlimited)
  const unlimited = hasUnlimitedCredits(subscription.tier);
  if (!unlimited && subscription.creditsRemaining <= 0) {
    logger.warn('No credits remaining', { clientId });
    return {
      success: false,
      error: 'NO_CREDITS',
      message: 'You have no contact credits remaining this month. Upgrade your plan for more credits.',
      status: 400,
    };
  }

  // Create contact request and deduct credit atomically
  const contactId = `CON-${nanoid(12)}`;
  const now = new Date().toISOString();

  const transactItems = [
    // Create contact request (main record)
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: `CONTACT#${contactId}`,
          SK: 'META',
          contactId,
          clientId,
          candidateId,
          message,
          status: ContactStatus.PENDING,
          createdAt: now,
          updatedAt: now,
          // GSI2 for status filtering
          GSI2PK: `STATUS#${ContactStatus.PENDING}`,
          GSI2SK: `CONTACT#${contactId}`,
        },
      },
    },
    // Create client's contact reference
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: `CLIENT#${clientId}`,
          SK: `CONTACT#${contactId}`,
          contactId,
          candidateId,
          candidateName: `${candidate.firstName} ${candidate.lastName?.charAt(0) || ''}.`,
          status: ContactStatus.PENDING,
          createdAt: now,
        },
      },
    },
  ];

  // Deduct credit if not unlimited
  if (!unlimited) {
    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: `CLIENT#${clientId}`, SK: 'SUBSCRIPTION' },
        UpdateExpression: 'SET creditsRemaining = creditsRemaining - :one, updatedAt = :now',
        ConditionExpression: 'creditsRemaining > :zero',
        ExpressionAttributeValues: {
          ':one': 1,
          ':zero': 0,
          ':now': now,
        },
      },
    });
  }

  try {
    await docClient.send(new TransactWriteCommand({
      TransactItems: transactItems,
    }));
  } catch (error) {
    if (error.name === 'TransactionCanceledException') {
      logger.warn('Transaction failed - likely no credits', { clientId });
      return {
        success: false,
        error: 'NO_CREDITS',
        message: 'You have no contact credits remaining this month.',
        status: 400,
      };
    }
    throw error;
  }

  logger.info('Contact request created', { clientId, candidateId, contactId });

  // Send notification emails
  const contact = { contactId, message, createdAt: now };
  await sendNotificationEmails(contact, client, candidate, logger);

  const creditsRemaining = unlimited ? -1 : subscription.creditsRemaining - 1;

  return {
    success: true,
    contactId,
    message: 'Contact request sent successfully. The candidate has been notified.',
    creditsRemaining,
    status: 201,
  };
}

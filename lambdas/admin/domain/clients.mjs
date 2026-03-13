/**
 * Admin Client Management Domain Logic
 *
 * Handles listing, viewing, and managing client accounts.
 * All operations require admin authentication.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
  ClientStatus,
  isValidClientTransition,
} from '../validation.mjs';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sesClient = new SESClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@medibee-recruitment.co.uk';

/**
 * List all clients with optional filtering
 *
 * @param {Object} filters - { status, limit, cursor }
 * @param {Object} logger - Logger instance
 */
export async function listClients(filters, logger) {
  const { status, limit, cursor } = filters;

  logger.info('Listing clients', { status, limit });

  let queryParams;

  if (status) {
    // Query by status using GSI2
    queryParams = {
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      FilterExpression: 'begins_with(PK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `STATUS#${status}`,
        ':prefix': 'CLIENT#',
      },
      Limit: limit,
    };
  } else {
    // Query all clients
    // Note: In production, consider a dedicated index for listing all clients
    queryParams = {
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'begins_with(GSI2PK, :prefix)',
      FilterExpression: 'begins_with(PK, :clientPrefix)',
      ExpressionAttributeValues: {
        ':prefix': 'STATUS#',
        ':clientPrefix': 'CLIENT#',
      },
      Limit: limit,
    };
  }

  if (cursor) {
    try {
      queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    } catch {
      // Invalid cursor, ignore
    }
  }

  const result = await docClient.send(new QueryCommand(queryParams));

  // Build client list with subscription info
  const clients = [];
  const clientIds = new Set();

  for (const item of result.Items || []) {
    if (item.PK.startsWith('CLIENT#') && item.SK === 'PROFILE') {
      const clientId = item.clientId;
      if (!clientIds.has(clientId)) {
        clientIds.add(clientId);

        // Get subscription for this client
        const subscription = await getClientSubscription(clientId);

        clients.push({
          clientId: item.clientId,
          organisationName: item.organisationName,
          organisationType: item.organisationType,
          contactName: item.contactName,
          contactEmail: item.contactEmail,
          contactPhone: item.contactPhone,
          status: item.status,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          subscription: subscription ? {
            tier: subscription.tier,
            status: subscription.status,
            creditsRemaining: subscription.creditsRemaining,
            currentPeriodEnd: subscription.currentPeriodEnd,
          } : null,
        });
      }
    }
  }

  let nextCursor = null;
  if (result.LastEvaluatedKey) {
    nextCursor = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url');
  }

  logger.info('Clients retrieved', { count: clients.length });

  return {
    success: true,
    clients,
    cursor: nextCursor,
    status: 200,
  };
}

/**
 * Get client subscription record
 */
async function getClientSubscription(clientId) {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: 'SUBSCRIPTION',
    },
  }));

  return result.Item || null;
}

/**
 * Get single client with full details
 *
 * @param {string} clientId - Client ID
 * @param {Object} logger - Logger instance
 */
export async function getClient(clientId, logger) {
  logger.info('Getting client', { clientId });

  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: 'PROFILE',
    },
  }));

  if (!result.Item) {
    logger.warn('Client not found', { clientId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Client not found.',
      status: 404,
    };
  }

  const item = result.Item;
  const subscription = await getClientSubscription(clientId);

  // Admin gets full details
  const client = {
    clientId: item.clientId,
    organisationName: item.organisationName,
    organisationType: item.organisationType,
    contactName: item.contactName,
    contactEmail: item.contactEmail,
    contactPhone: item.contactPhone,
    billingEmail: item.billingEmail,
    address: item.address,
    cqcNumber: item.cqcNumber,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    suspensionReason: item.suspensionReason,
    subscription: subscription ? {
      tier: subscription.tier,
      status: subscription.status,
      stripeCustomerId: subscription.stripeCustomerId,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      creditsRemaining: subscription.creditsRemaining,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      createdAt: subscription.createdAt,
    } : null,
  };

  logger.info('Client retrieved', { clientId });

  return {
    success: true,
    client,
    status: 200,
  };
}

/**
 * Suspend a client account
 *
 * @param {string} clientId - Client ID
 * @param {string} reason - Suspension reason
 * @param {string} adminId - Admin performing the action
 * @param {Object} logger - Logger instance
 */
export async function suspendClient(clientId, reason, adminId, logger) {
  logger.info('Suspending client', { clientId, adminId });

  // Get current client status
  const current = await getClient(clientId, logger);
  if (!current.success) {
    return current;
  }

  const currentStatus = current.client.status;

  // Validate transition
  if (!isValidClientTransition(currentStatus, ClientStatus.SUSPENDED)) {
    logger.warn('Invalid status transition', {
      clientId,
      currentStatus,
      targetStatus: ClientStatus.SUSPENDED,
    });
    return {
      success: false,
      error: 'INVALID_STATUS_TRANSITION',
      message: `Cannot suspend client with status "${currentStatus}".`,
      status: 400,
    };
  }

  const now = new Date().toISOString();

  // Update status
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: 'PROFILE',
    },
    UpdateExpression: 'SET #status = :status, updatedAt = :now, suspendedBy = :admin, suspendedAt = :now, suspensionReason = :reason, GSI2PK = :gsi2pk',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': ClientStatus.SUSPENDED,
      ':now': now,
      ':admin': adminId,
      ':reason': reason,
      ':gsi2pk': `STATUS#${ClientStatus.SUSPENDED}`,
    },
  }));

  // Send notification email
  await sendClientStatusEmail(
    current.client.contactEmail,
    current.client.contactName,
    current.client.organisationName,
    'suspended',
    logger,
    reason
  );

  logger.info('Client suspended', { clientId, adminId });

  return {
    success: true,
    message: 'Client account has been suspended.',
    status: 200,
  };
}

/**
 * Reinstate a suspended client
 *
 * @param {string} clientId - Client ID
 * @param {string} adminId - Admin performing the action
 * @param {Object} logger - Logger instance
 */
export async function reinstateClient(clientId, adminId, logger) {
  logger.info('Reinstating client', { clientId, adminId });

  // Get current client status
  const current = await getClient(clientId, logger);
  if (!current.success) {
    return current;
  }

  const currentStatus = current.client.status;

  // Validate transition
  if (!isValidClientTransition(currentStatus, ClientStatus.ACTIVE)) {
    logger.warn('Invalid status transition', {
      clientId,
      currentStatus,
      targetStatus: ClientStatus.ACTIVE,
    });
    return {
      success: false,
      error: 'INVALID_STATUS_TRANSITION',
      message: `Cannot reinstate client with status "${currentStatus}".`,
      status: 400,
    };
  }

  const now = new Date().toISOString();

  // Update status
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: 'PROFILE',
    },
    UpdateExpression: 'SET #status = :status, updatedAt = :now, reinstatedBy = :admin, reinstatedAt = :now, GSI2PK = :gsi2pk REMOVE suspensionReason',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': ClientStatus.ACTIVE,
      ':now': now,
      ':admin': adminId,
      ':gsi2pk': `STATUS#${ClientStatus.ACTIVE}`,
    },
  }));

  // Send notification email
  await sendClientStatusEmail(
    current.client.contactEmail,
    current.client.contactName,
    current.client.organisationName,
    'reinstated',
    logger
  );

  logger.info('Client reinstated', { clientId, adminId });

  return {
    success: true,
    message: 'Client account has been reinstated.',
    status: 200,
  };
}

/**
 * Send status change notification email to client
 */
async function sendClientStatusEmail(email, contactName, orgName, action, logger, reason = null) {
  const subjects = {
    suspended: 'Your Medibee Account Has Been Suspended',
    reinstated: 'Your Medibee Account Has Been Reinstated',
  };

  const bodies = {
    suspended: `
      <h1>Account Suspended</h1>
      <p>Hi ${contactName},</p>
      <p>The Medibee account for <strong>${orgName}</strong> has been temporarily suspended.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
      <p>During this time, you will not be able to browse candidates or make contact requests. If you have questions about this decision, please contact our support team.</p>
      <p>Best regards,<br>The Medibee Team</p>
    `,
    reinstated: `
      <h1>Account Reinstated</h1>
      <p>Hi ${contactName},</p>
      <p>Good news! The Medibee account for <strong>${orgName}</strong> has been reinstated.</p>
      <p>You can now log in and continue using our platform to find healthcare professionals.</p>
      <p>Best regards,<br>The Medibee Team</p>
    `,
  };

  try {
    await sesClient.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: subjects[action], Charset: 'UTF-8' },
        Body: { Html: { Data: bodies[action], Charset: 'UTF-8' } },
      },
    }));

    logger.info('Client status notification email sent', { email, action });
  } catch (error) {
    logger.error('Failed to send client status notification email', { email, action, error: error.message });
    // Don't fail the operation if email fails
  }
}

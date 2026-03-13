/**
 * Admin Contact Management Domain Logic
 *
 * Handles listing and resolving contact requests.
 * All operations require admin authentication.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  UpdateCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { ContactStatus } from '../validation.mjs';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sesClient = new SESClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@medibee-recruitment.co.uk';

/**
 * List all contact requests with optional filtering
 *
 * @param {Object} filters - { status, limit, cursor }
 * @param {Object} logger - Logger instance
 */
export async function listContacts(filters, logger) {
  const { status, limit, cursor } = filters;

  logger.info('Listing contacts', { status, limit });

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
        ':prefix': 'CONTACT#',
      },
      Limit: limit,
    };
  } else {
    // Query all contacts by scanning the status index
    queryParams = {
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'begins_with(GSI2PK, :prefix)',
      FilterExpression: 'begins_with(PK, :contactPrefix)',
      ExpressionAttributeValues: {
        ':prefix': 'STATUS#',
        ':contactPrefix': 'CONTACT#',
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

  // Collect unique client and candidate IDs for batch lookup
  const clientIds = new Set();
  const candidateIds = new Set();
  const contactItems = [];

  for (const item of result.Items || []) {
    if (item.PK.startsWith('CONTACT#') && item.SK === 'META') {
      contactItems.push(item);
      if (item.clientId) clientIds.add(item.clientId);
      if (item.candidateId) candidateIds.add(item.candidateId);
    }
  }

  // Batch get client and candidate names
  const clientNames = await batchGetNames('CLIENT#', Array.from(clientIds), 'organisationName');
  const candidateNames = await batchGetCandidateNames(Array.from(candidateIds));

  // Build contact list with names
  const contacts = contactItems.map((item) => ({
    contactId: item.contactId,
    clientId: item.clientId,
    candidateId: item.candidateId,
    clientName: clientNames.get(item.clientId) || 'Unknown',
    candidateName: candidateNames.get(item.candidateId) || 'Unknown',
    message: item.message,
    status: item.status,
    notes: item.notes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));

  let nextCursor = null;
  if (result.LastEvaluatedKey) {
    nextCursor = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url');
  }

  logger.info('Contacts retrieved', { count: contacts.length });

  return {
    success: true,
    contacts,
    cursor: nextCursor,
    status: 200,
  };
}

/**
 * Batch get names for entities
 */
async function batchGetNames(pkPrefix, ids, nameField) {
  if (ids.length === 0) return new Map();

  const keys = ids.map((id) => ({
    PK: `${pkPrefix}${id}`,
    SK: 'PROFILE',
  }));

  // DynamoDB BatchGet has a limit of 100 items
  const names = new Map();
  const batchSize = 100;

  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);

    const result = await docClient.send(new BatchGetCommand({
      RequestItems: {
        [TABLE_NAME]: {
          Keys: batch,
        },
      },
    }));

    for (const item of result.Responses?.[TABLE_NAME] || []) {
      const id = item.clientId || item.candidateId;
      if (id && item[nameField]) {
        names.set(id, item[nameField]);
      }
    }
  }

  return names;
}

/**
 * Batch get candidate names (firstName + lastName initial)
 */
async function batchGetCandidateNames(candidateIds) {
  if (candidateIds.length === 0) return new Map();

  const keys = candidateIds.map((id) => ({
    PK: `CANDIDATE#${id}`,
    SK: 'PROFILE',
  }));

  const names = new Map();
  const batchSize = 100;

  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);

    const result = await docClient.send(new BatchGetCommand({
      RequestItems: {
        [TABLE_NAME]: {
          Keys: batch,
        },
      },
    }));

    for (const item of result.Responses?.[TABLE_NAME] || []) {
      if (item.candidateId && item.firstName) {
        const lastName = item.lastName || '';
        const name = `${item.firstName} ${lastName.charAt(0)}.`;
        names.set(item.candidateId, name);
      }
    }
  }

  return names;
}

/**
 * Get single contact with full details
 *
 * @param {string} contactId - Contact ID
 * @param {Object} logger - Logger instance
 */
export async function getContact(contactId, logger) {
  logger.info('Getting contact', { contactId });

  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CONTACT#${contactId}`,
      SK: 'META',
    },
  }));

  if (!result.Item) {
    logger.warn('Contact not found', { contactId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Contact request not found.',
      status: 404,
    };
  }

  const item = result.Item;

  // Get client and candidate details
  const [clientResult, candidateResult] = await Promise.all([
    docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CLIENT#${item.clientId}`, SK: 'PROFILE' },
    })),
    docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CANDIDATE#${item.candidateId}`, SK: 'PROFILE' },
    })),
  ]);

  const client = clientResult.Item;
  const candidate = candidateResult.Item;

  const contact = {
    contactId: item.contactId,
    clientId: item.clientId,
    candidateId: item.candidateId,
    message: item.message,
    status: item.status,
    notes: item.notes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    resolvedAt: item.resolvedAt,
    resolvedBy: item.resolvedBy,
    client: client ? {
      organisationName: client.organisationName,
      contactName: client.contactName,
      contactEmail: client.contactEmail,
      contactPhone: client.contactPhone,
    } : null,
    candidate: candidate ? {
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      email: candidate.email,
      phone: candidate.phone,
    } : null,
  };

  logger.info('Contact retrieved', { contactId });

  return {
    success: true,
    contact,
    status: 200,
  };
}

/**
 * Resolve a contact request (update status)
 *
 * @param {string} contactId - Contact ID
 * @param {string} newStatus - New status
 * @param {string} notes - Optional notes
 * @param {string} adminId - Admin performing the action
 * @param {Object} logger - Logger instance
 */
export async function resolveContact(contactId, newStatus, notes, adminId, logger) {
  logger.info('Resolving contact', { contactId, newStatus, adminId });

  // Get current contact
  const current = await getContact(contactId, logger);
  if (!current.success) {
    return current;
  }

  const contact = current.contact;

  // Don't allow changing from terminal states
  const terminalStates = [ContactStatus.HIRED, ContactStatus.DECLINED, ContactStatus.EXPIRED];
  if (terminalStates.includes(contact.status)) {
    return {
      success: false,
      error: 'INVALID_STATUS_TRANSITION',
      message: `Contact request is already in terminal status "${contact.status}".`,
      status: 400,
    };
  }

  const now = new Date().toISOString();

  const updateExpression = ['SET #status = :status', 'updatedAt = :now', 'resolvedBy = :admin', 'resolvedAt = :now', 'GSI2PK = :gsi2pk'];
  const expressionAttributeValues = {
    ':status': newStatus,
    ':now': now,
    ':admin': adminId,
    ':gsi2pk': `STATUS#${newStatus}`,
  };

  if (notes) {
    updateExpression.push('notes = :notes');
    expressionAttributeValues[':notes'] = notes;
  }

  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CONTACT#${contactId}`,
      SK: 'META',
    },
    UpdateExpression: updateExpression.join(', '),
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: expressionAttributeValues,
  }));

  // Also update the client's contact reference
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${contact.clientId}`,
      SK: `CONTACT#${contactId}`,
    },
    UpdateExpression: 'SET #status = :status',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': newStatus,
    },
  }));

  // Send notification emails
  if (contact.client && contact.candidate) {
    await sendResolutionEmails(contact, newStatus, logger);
  }

  logger.info('Contact resolved', { contactId, newStatus, adminId });

  return {
    success: true,
    message: `Contact request status updated to "${newStatus}".`,
    status: 200,
  };
}

/**
 * Send resolution notification emails
 */
async function sendResolutionEmails(contact, newStatus, logger) {
  const statusMessages = {
    [ContactStatus.CONTACTED]: 'The candidate has been contacted.',
    [ContactStatus.HIRED]: 'The candidate has been hired. Congratulations!',
    [ContactStatus.DECLINED]: 'The contact request was declined.',
    [ContactStatus.EXPIRED]: 'The contact request has expired.',
  };

  const clientSubject = `Contact Request Update: ${contact.candidate.firstName} ${contact.candidate.lastName?.charAt(0) || ''}.`;
  const clientBody = `
    <h1>Contact Request Update</h1>
    <p>Hi ${contact.client.contactName},</p>
    <p>Your contact request for <strong>${contact.candidate.firstName} ${contact.candidate.lastName?.charAt(0) || ''}.</strong> has been updated.</p>
    <p><strong>New Status:</strong> ${newStatus}</p>
    <p>${statusMessages[newStatus] || ''}</p>
    <p>Best regards,<br>The Medibee Team</p>
  `;

  try {
    await sesClient.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [contact.client.contactEmail] },
      Message: {
        Subject: { Data: clientSubject, Charset: 'UTF-8' },
        Body: { Html: { Data: clientBody, Charset: 'UTF-8' } },
      },
    }));

    logger.info('Resolution notification email sent', { contactId: contact.contactId, newStatus });
  } catch (error) {
    logger.error('Failed to send resolution notification email', { error: error.message });
  }
}

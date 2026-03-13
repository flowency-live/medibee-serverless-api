/**
 * List Contacts Domain Logic
 * Handles listing contact requests for clients
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;

/**
 * List all contact requests for a client
 */
export async function listContacts(clientId, logger) {
  logger.info('Listing contacts', { clientId });

  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': `CLIENT#${clientId}`,
      ':skPrefix': 'CONTACT#',
    },
    ScanIndexForward: false, // Most recent first
  }));

  const contacts = (result.Items || []).map((item) => ({
    contactId: item.contactId,
    candidateId: item.candidateId,
    candidateName: item.candidateName,
    status: item.status,
    createdAt: item.createdAt,
  }));

  logger.info('Contacts retrieved', { clientId, count: contacts.length });

  return {
    success: true,
    contacts,
    status: 200,
  };
}

/**
 * Get a single contact request with full details
 */
export async function getContact(clientId, contactId, logger) {
  logger.info('Getting contact', { clientId, contactId });

  // Get the client's contact reference to verify ownership
  const refResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CLIENT#${clientId}`,
      SK: `CONTACT#${contactId}`,
    },
  }));

  if (!refResult.Item) {
    logger.warn('Contact not found', { clientId, contactId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Contact request not found.',
      status: 404,
    };
  }

  // Get the full contact record
  const contactResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CONTACT#${contactId}`,
      SK: 'META',
    },
  }));

  if (!contactResult.Item) {
    logger.warn('Contact meta not found', { contactId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Contact request not found.',
      status: 404,
    };
  }

  const contact = contactResult.Item;

  // Get candidate profile for additional details
  const candidateResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${contact.candidateId}`,
      SK: 'PROFILE',
    },
  }));

  const candidate = candidateResult.Item;

  logger.info('Contact retrieved', { clientId, contactId });

  return {
    success: true,
    contact: {
      contactId: contact.contactId,
      candidateId: contact.candidateId,
      message: contact.message,
      status: contact.status,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
      candidate: candidate ? {
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        email: candidate.email,
        phone: candidate.phone,
        location: candidate.location,
        experienceLevel: candidate.experienceLevel,
        available: candidate.available,
      } : null,
    },
    status: 200,
  };
}

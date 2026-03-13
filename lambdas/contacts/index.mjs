/**
 * Contacts Lambda Handler
 * Endpoints: POST /contacts, GET /contacts, GET /contacts/{id}
 */

import { createLogger } from '/opt/nodejs/lib/logger.mjs';
import { handleOptions } from '/opt/nodejs/lib/cors.mjs';
import { successResponse, errorResponse, ERRORS } from '/opt/nodejs/lib/responses.mjs';
import { validateBody } from '/opt/nodejs/lib/validation.mjs';
import { extractClientId } from '/opt/nodejs/lib/auth.mjs';
import { RequestContactSchema } from './validation.mjs';
import { requestContact } from './domain/request-contact.mjs';
import { listContacts, getContact } from './domain/list-contacts.mjs';

export const handler = async (event, context) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return handleOptions(event);
  }

  const logger = createLogger(event, context);
  const origin = event.headers?.origin;
  const path = event.rawPath || event.path;
  const method = event.requestContext?.http?.method || event.httpMethod;

  logger.info('Contacts request received', { path, method });

  try {
    // Health check
    if (path === '/contacts/health' && method === 'GET') {
      return successResponse(200, {
        status: 'healthy',
        service: 'medibee-contacts',
        timestamp: new Date().toISOString(),
      }, origin);
    }

    // All routes require client authentication
    let clientId;
    try {
      clientId = extractClientId(event);
    } catch (error) {
      return ERRORS.UNAUTHORIZED('Invalid authorization', origin);
    }

    logger.info('Authenticated client', { clientId });

    // Parse path for route matching
    const pathParts = path.split('/').filter(Boolean);

    // POST /contacts - Request contact
    if (path === '/contacts' && method === 'POST') {
      return await handleRequestContact(event, clientId, logger, origin);
    }

    // GET /contacts - List contacts
    if (path === '/contacts' && method === 'GET') {
      return await handleListContacts(clientId, logger, origin);
    }

    // GET /contacts/{id} - Get contact
    if (pathParts[0] === 'contacts' && pathParts.length === 2 && method === 'GET') {
      const contactId = pathParts[1];
      return await handleGetContact(clientId, contactId, logger, origin);
    }

    // Route not found
    return ERRORS.NOT_FOUND('Route not found', origin);

  } catch (error) {
    logger.error('Request failed', { error: error.message, stack: error.stack });
    return ERRORS.INTERNAL_ERROR(origin);
  }
};

/**
 * Handle POST /contacts
 */
async function handleRequestContact(event, clientId, logger, origin) {
  const validation = validateBody(event.body, RequestContactSchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  const result = await requestContact(clientId, validation.data, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(201, {
    contactId: result.contactId,
    message: result.message,
    creditsRemaining: result.creditsRemaining,
  }, origin);
}

/**
 * Handle GET /contacts
 */
async function handleListContacts(clientId, logger, origin) {
  const result = await listContacts(clientId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    contacts: result.contacts,
  }, origin);
}

/**
 * Handle GET /contacts/{id}
 */
async function handleGetContact(clientId, contactId, logger, origin) {
  const result = await getContact(clientId, contactId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    contact: result.contact,
  }, origin);
}

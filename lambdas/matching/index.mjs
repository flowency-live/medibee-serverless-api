/**
 * Matching Lambda Handler
 * Endpoints: GET /candidates, GET /candidates/{id},
 *            GET /shortlists, POST /shortlists, GET /shortlists/{id},
 *            DELETE /shortlists/{id}, POST /shortlists/{id}/candidates,
 *            DELETE /shortlists/{id}/candidates/{candidateId}
 */

import { createLogger } from '/opt/nodejs/lib/logger.mjs';
import { handleOptions } from '/opt/nodejs/lib/cors.mjs';
import { successResponse, errorResponse, ERRORS } from '/opt/nodejs/lib/responses.mjs';
import { validateBody } from '/opt/nodejs/lib/validation.mjs';
import { extractClientId } from '/opt/nodejs/lib/auth.mjs';
import {
  BrowseCandidatesSchema,
  CreateShortlistSchema,
  UpdateShortlistSchema,
  AddCandidateToShortlistSchema,
} from './validation.mjs';
import { browseCandidates } from './domain/browse-candidates.mjs';
import { viewCandidate } from './domain/view-candidate.mjs';
import {
  listShortlists,
  getShortlist,
  createShortlist,
  deleteShortlist,
  addCandidateToShortlist,
  removeCandidateFromShortlist,
} from './domain/shortlists.mjs';

export const handler = async (event, context) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return handleOptions(event);
  }

  const logger = createLogger(event, context);
  const origin = event.headers?.origin;
  const path = event.rawPath || event.path;
  const method = event.requestContext?.http?.method || event.httpMethod;

  logger.info('Matching request received', { path, method });

  try {
    // Health check
    if (path === '/matching/health' && method === 'GET') {
      return successResponse(200, {
        status: 'healthy',
        service: 'medibee-matching',
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

    // GET /candidates - Browse candidates
    if (path === '/candidates' && method === 'GET') {
      return await handleBrowseCandidates(event, clientId, logger, origin);
    }

    // GET /candidates/{id} - View candidate
    if (pathParts[0] === 'candidates' && pathParts.length === 2 && method === 'GET') {
      const candidateId = pathParts[1];
      return await handleViewCandidate(candidateId, clientId, logger, origin);
    }

    // GET /shortlists - List shortlists
    if (path === '/shortlists' && method === 'GET') {
      return await handleListShortlists(clientId, logger, origin);
    }

    // POST /shortlists - Create shortlist
    if (path === '/shortlists' && method === 'POST') {
      return await handleCreateShortlist(event, clientId, logger, origin);
    }

    // GET /shortlists/{id} - Get shortlist
    if (pathParts[0] === 'shortlists' && pathParts.length === 2 && method === 'GET') {
      const shortlistId = pathParts[1];
      return await handleGetShortlist(shortlistId, clientId, logger, origin);
    }

    // DELETE /shortlists/{id} - Delete shortlist
    if (pathParts[0] === 'shortlists' && pathParts.length === 2 && method === 'DELETE') {
      const shortlistId = pathParts[1];
      return await handleDeleteShortlist(shortlistId, clientId, logger, origin);
    }

    // POST /shortlists/{id}/candidates - Add candidate to shortlist
    if (pathParts[0] === 'shortlists' && pathParts.length === 3 && pathParts[2] === 'candidates' && method === 'POST') {
      const shortlistId = pathParts[1];
      return await handleAddCandidate(event, shortlistId, clientId, logger, origin);
    }

    // DELETE /shortlists/{id}/candidates/{candidateId} - Remove candidate from shortlist
    if (pathParts[0] === 'shortlists' && pathParts.length === 4 && pathParts[2] === 'candidates' && method === 'DELETE') {
      const shortlistId = pathParts[1];
      const candidateId = pathParts[3];
      return await handleRemoveCandidate(shortlistId, candidateId, clientId, logger, origin);
    }

    // Route not found
    return ERRORS.NOT_FOUND('Route not found', origin);

  } catch (error) {
    logger.error('Request failed', { error: error.message, stack: error.stack });
    return ERRORS.INTERNAL_ERROR(origin);
  }
};

/**
 * Handle GET /candidates
 */
async function handleBrowseCandidates(event, clientId, logger, origin) {
  const queryParams = event.queryStringParameters || {};

  const validation = BrowseCandidatesSchema.safeParse(queryParams);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.error.issues });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid query parameters', origin, validation.error.issues);
  }

  const result = await browseCandidates(clientId, validation.data, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    candidates: result.candidates,
    pagination: result.pagination,
    tier: result.tier,
  }, origin);
}

/**
 * Handle GET /candidates/{id}
 */
async function handleViewCandidate(candidateId, clientId, logger, origin) {
  const result = await viewCandidate(clientId, candidateId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    candidate: result.candidate,
    tier: result.tier,
  }, origin);
}

/**
 * Handle GET /shortlists
 */
async function handleListShortlists(clientId, logger, origin) {
  const result = await listShortlists(clientId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    shortlists: result.shortlists,
  }, origin);
}

/**
 * Handle POST /shortlists
 */
async function handleCreateShortlist(event, clientId, logger, origin) {
  const validation = validateBody(event.body, CreateShortlistSchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  const result = await createShortlist(clientId, validation.data, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(201, {
    shortlist: result.shortlist,
  }, origin);
}

/**
 * Handle GET /shortlists/{id}
 */
async function handleGetShortlist(shortlistId, clientId, logger, origin) {
  const result = await getShortlist(clientId, shortlistId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    shortlist: result.shortlist,
    candidates: result.candidates,
  }, origin);
}

/**
 * Handle DELETE /shortlists/{id}
 */
async function handleDeleteShortlist(shortlistId, clientId, logger, origin) {
  const result = await deleteShortlist(clientId, shortlistId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    success: true,
    message: result.message,
  }, origin);
}

/**
 * Handle POST /shortlists/{id}/candidates
 */
async function handleAddCandidate(event, shortlistId, clientId, logger, origin) {
  const validation = validateBody(event.body, AddCandidateToShortlistSchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  const result = await addCandidateToShortlist(clientId, shortlistId, validation.data, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(201, {
    success: true,
    message: result.message,
  }, origin);
}

/**
 * Handle DELETE /shortlists/{id}/candidates/{candidateId}
 */
async function handleRemoveCandidate(shortlistId, candidateId, clientId, logger, origin) {
  const result = await removeCandidateFromShortlist(clientId, shortlistId, candidateId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    success: true,
    message: result.message,
  }, origin);
}

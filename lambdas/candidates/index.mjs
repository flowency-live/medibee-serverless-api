/**
 * Candidates Lambda Handler
 * Endpoints: GET /candidates/me, PATCH /candidates/me, DELETE /candidates/me,
 *            PATCH /candidates/me/availability
 */

import { createLogger } from '/opt/nodejs/lib/logger.mjs';
import { handleOptions } from '/opt/nodejs/lib/cors.mjs';
import { successResponse, errorResponse, ERRORS } from '/opt/nodejs/lib/responses.mjs';
import { validateBody } from '/opt/nodejs/lib/validation.mjs';
import { extractCandidateId } from '/opt/nodejs/lib/auth.mjs';
import { UpdateProfileSchema, UpdateAvailabilitySchema } from './validation.mjs';
import { getProfile, updateProfile, updateAvailability } from './domain/profile.mjs';
import { deleteAccount } from './domain/delete-account.mjs';

export const handler = async (event, context) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return handleOptions(event);
  }

  const logger = createLogger(event, context);
  const origin = event.headers?.origin;
  const path = event.rawPath || event.path;
  const method = event.requestContext?.http?.method || event.httpMethod;

  logger.info('Candidates request received', { path, method });

  try {
    // Extract candidateId from JWT (SECURITY: never from request body)
    const candidateId = extractCandidateId(event);
    logger.info('Authenticated candidate', { candidateId });

    // Route to appropriate handler
    switch (path) {
      case '/candidates/me':
        if (method === 'GET') {
          return await handleGetProfile(candidateId, logger, origin);
        }
        if (method === 'PATCH') {
          return await handleUpdateProfile(event, candidateId, logger, origin);
        }
        if (method === 'DELETE') {
          return await handleDeleteAccount(candidateId, logger, origin);
        }
        break;

      case '/candidates/me/availability':
        if (method === 'PATCH') {
          return await handleUpdateAvailability(event, candidateId, logger, origin);
        }
        break;
    }

    // Route not found
    return ERRORS.NOT_FOUND('Route not found', origin);

  } catch (error) {
    if (error.message === 'Missing candidate ID in authorization context') {
      return ERRORS.UNAUTHORIZED('Invalid authorization', origin);
    }

    logger.error('Request failed', { error: error.message, stack: error.stack });
    return ERRORS.INTERNAL_ERROR(origin);
  }
};

/**
 * Handle GET /candidates/me
 */
async function handleGetProfile(candidateId, logger, origin) {
  const result = await getProfile(candidateId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, result.profile, origin);
}

/**
 * Handle PATCH /candidates/me
 */
async function handleUpdateProfile(event, candidateId, logger, origin) {
  // Validate request body
  const validation = validateBody(event.body, UpdateProfileSchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  // Check if there are any fields to update
  if (Object.keys(validation.data).length === 0) {
    return errorResponse(400, 'VALIDATION_ERROR', 'No fields provided to update', origin);
  }

  const result = await updateProfile(candidateId, validation.data, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, result.profile, origin);
}

/**
 * Handle PATCH /candidates/me/availability
 */
async function handleUpdateAvailability(event, candidateId, logger, origin) {
  // Validate request body
  const validation = validateBody(event.body, UpdateAvailabilitySchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  const result = await updateAvailability(candidateId, validation.data.available, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    available: result.available,
    message: result.message,
  }, origin);
}

/**
 * Handle DELETE /candidates/me (GDPR account deletion)
 */
async function handleDeleteAccount(candidateId, logger, origin) {
  const result = await deleteAccount(candidateId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    success: true,
    message: result.message,
  }, origin);
}

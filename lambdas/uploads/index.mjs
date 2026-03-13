/**
 * Uploads Lambda Handler
 * Endpoints: POST /uploads/cv/presigned-url, POST /uploads/cv/confirm
 */

import { createLogger } from '/opt/nodejs/lib/logger.mjs';
import { handleOptions } from '/opt/nodejs/lib/cors.mjs';
import { successResponse, errorResponse, ERRORS } from '/opt/nodejs/lib/responses.mjs';
import { validateBody } from '/opt/nodejs/lib/validation.mjs';
import { extractCandidateId } from '/opt/nodejs/lib/auth.mjs';
import { PresignedUrlSchema, ConfirmUploadSchema } from './validation.mjs';
import { generatePresignedUrl, confirmUpload } from './domain/cv-upload.mjs';

export const handler = async (event, context) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return handleOptions(event);
  }

  const logger = createLogger(event, context);
  const origin = event.headers?.origin;
  const path = event.rawPath || event.path;
  const method = event.requestContext?.http?.method || event.httpMethod;

  logger.info('Uploads request received', { path, method });

  try {
    // Extract candidateId from JWT (SECURITY: never from request body)
    const candidateId = extractCandidateId(event);
    logger.info('Authenticated candidate', { candidateId });

    // Route to appropriate handler
    switch (path) {
      case '/uploads/cv/presigned-url':
        if (method === 'POST') {
          return await handlePresignedUrl(event, candidateId, logger, origin);
        }
        break;

      case '/uploads/cv/confirm':
        if (method === 'POST') {
          return await handleConfirmUpload(event, candidateId, logger, origin);
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
 * Handle POST /uploads/cv/presigned-url
 */
async function handlePresignedUrl(event, candidateId, logger, origin) {
  // Validate request body
  const validation = validateBody(event.body, PresignedUrlSchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  const { contentType, filename } = validation.data;

  const result = await generatePresignedUrl(candidateId, contentType, filename, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    uploadUrl: result.uploadUrl,
    key: result.key,
    expiresIn: result.expiresIn,
  }, origin);
}

/**
 * Handle POST /uploads/cv/confirm
 */
async function handleConfirmUpload(event, candidateId, logger, origin) {
  // Validate request body
  const validation = validateBody(event.body, ConfirmUploadSchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  const { key } = validation.data;

  const result = await confirmUpload(candidateId, key, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    message: result.message,
    key: result.key,
  }, origin);
}

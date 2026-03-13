/**
 * Standardized API response utilities for Medibee Lambdas
 */

import { getCorsHeaders } from './cors.mjs';

/**
 * Create a success response
 * @param {number} statusCode - HTTP status code (200, 201, etc.)
 * @param {object} data - Response body data
 * @param {string} origin - Request origin for CORS
 */
export function successResponse(statusCode, data, origin) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders(origin),
    },
    body: JSON.stringify({
      success: true,
      ...data,
    }),
  };
}

/**
 * Create an error response
 * @param {number} statusCode - HTTP status code (400, 401, 500, etc.)
 * @param {string} errorCode - Machine-readable error code (e.g., 'VALIDATION_ERROR')
 * @param {string} message - Human-readable error message
 * @param {string} origin - Request origin for CORS
 * @param {Array} details - Optional validation error details
 */
export function errorResponse(statusCode, errorCode, message, origin, details = null) {
  const body = {
    success: false,
    error: errorCode,
    message,
  };

  if (details) {
    body.details = details;
  }

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders(origin),
    },
    body: JSON.stringify(body),
  };
}

// Common error responses
export const ERRORS = {
  VALIDATION_ERROR: (details, origin) => errorResponse(400, 'VALIDATION_ERROR', details, origin),
  UNAUTHORIZED: (message, origin) => errorResponse(401, 'UNAUTHORIZED', message || 'Authentication required', origin),
  FORBIDDEN: (message, origin) => errorResponse(403, 'FORBIDDEN', message || 'Access denied', origin),
  NOT_FOUND: (message, origin) => errorResponse(404, 'NOT_FOUND', message || 'Resource not found', origin),
  CONFLICT: (message, origin) => errorResponse(409, 'CONFLICT', message, origin),
  INTERNAL_ERROR: (origin) => errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred', origin),
};

/**
 * Auth Lambda Handler
 * Endpoints: /auth/register, /auth/verify-email, /auth/login, /auth/logout,
 *            /auth/forgot-password, /auth/reset-password, /health
 */

import { createLogger } from '/opt/nodejs/lib/logger.mjs';
import { handleOptions } from '/opt/nodejs/lib/cors.mjs';
import { successResponse, errorResponse, ERRORS } from '/opt/nodejs/lib/responses.mjs';
import { validateBody } from '/opt/nodejs/lib/validation.mjs';
import { extractCandidateId } from '/opt/nodejs/lib/auth.mjs';
import {
  RegisterSchema,
  VerifyEmailSchema,
  LoginSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
} from './validation.mjs';
import { registerCandidate } from './domain/register.mjs';
import { verifyEmail } from './domain/verify-email.mjs';
import { loginCandidate } from './domain/login.mjs';
import { logoutCandidate } from './domain/logout.mjs';
import { requestPasswordReset } from './domain/forgot-password.mjs';
import { resetPassword } from './domain/reset-password.mjs';

export const handler = async (event, context) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return handleOptions(event);
  }

  const logger = createLogger(event, context);
  const origin = event.headers?.origin;
  const path = event.rawPath || event.path;
  const method = event.requestContext?.http?.method || event.httpMethod;

  logger.info('Auth request received', { path, method });

  try {
    // Health check
    if (path === '/health' && method === 'GET') {
      return successResponse(200, {
        status: 'healthy',
        service: 'medibee-auth',
        timestamp: new Date().toISOString(),
      }, origin);
    }

    // Route to appropriate handler
    switch (path) {
      case '/auth/register':
        if (method === 'POST') {
          return await handleRegister(event, logger, origin);
        }
        break;

      case '/auth/verify-email':
        if (method === 'POST') {
          return await handleVerifyEmail(event, logger, origin);
        }
        break;

      case '/auth/login':
        if (method === 'POST') {
          return await handleLogin(event, logger, origin);
        }
        break;

      case '/auth/logout':
        if (method === 'POST') {
          return await handleLogout(event, logger, origin);
        }
        break;

      case '/auth/forgot-password':
        if (method === 'POST') {
          return await handleForgotPassword(event, logger, origin);
        }
        break;

      case '/auth/reset-password':
        if (method === 'POST') {
          return await handleResetPassword(event, logger, origin);
        }
        break;
    }

    // Route not found
    return ERRORS.NOT_FOUND('Route not found', origin);

  } catch (error) {
    logger.error('Request failed', { error: error.message, stack: error.stack });
    return ERRORS.INTERNAL_ERROR(origin);
  }
};

/**
 * Handle POST /auth/register
 */
async function handleRegister(event, logger, origin) {
  // Validate request body
  const validation = validateBody(event.body, RegisterSchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  // Register the candidate
  const result = await registerCandidate(validation.data, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(201, {
    success: true,
    candidateId: result.candidateId,
    message: result.message,
  }, origin);
}

/**
 * Handle POST /auth/verify-email
 */
async function handleVerifyEmail(event, logger, origin) {
  // Validate request body
  const validation = validateBody(event.body, VerifyEmailSchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  // Verify the email
  const result = await verifyEmail(validation.data.token, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    success: true,
    message: result.message,
  }, origin);
}

/**
 * Handle POST /auth/login
 */
async function handleLogin(event, logger, origin) {
  // Validate request body
  const validation = validateBody(event.body, LoginSchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  // Login the candidate
  const result = await loginCandidate(validation.data.email, validation.data.password, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    success: true,
    token: result.token,
    candidateId: result.candidateId,
    profile: result.profile,
  }, origin);
}

/**
 * Handle POST /auth/logout
 */
async function handleLogout(event, logger, origin) {
  // Extract candidate info from JWT
  let candidateId;
  let sessionId;

  try {
    candidateId = extractCandidateId(event);
    // Session ID is in the JWT claims
    sessionId = event.requestContext?.authorizer?.lambda?.sessionId;
  } catch (error) {
    return ERRORS.UNAUTHORIZED('Invalid authorization', origin);
  }

  // Logout the candidate
  const result = await logoutCandidate(sessionId, candidateId, logger);

  return successResponse(200, {
    success: true,
    message: result.message,
  }, origin);
}

/**
 * Handle POST /auth/forgot-password
 */
async function handleForgotPassword(event, logger, origin) {
  // Validate request body
  const validation = validateBody(event.body, ForgotPasswordSchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  // Request password reset
  const result = await requestPasswordReset(validation.data.email, logger);

  return successResponse(200, {
    success: true,
    message: result.message,
  }, origin);
}

/**
 * Handle POST /auth/reset-password
 */
async function handleResetPassword(event, logger, origin) {
  // Validate request body
  const validation = validateBody(event.body, ResetPasswordSchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  // Reset the password
  const result = await resetPassword(validation.data.token, validation.data.password, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    success: true,
    message: result.message,
  }, origin);
}

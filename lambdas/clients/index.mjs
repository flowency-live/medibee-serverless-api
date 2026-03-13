/**
 * Clients Lambda Handler
 * Endpoints: POST /clients/register, POST /clients/verify-email, POST /clients/login,
 *            POST /clients/logout, GET /clients/me, PATCH /clients/me, DELETE /clients/me,
 *            POST /clients/forgot-password, POST /clients/reset-password
 */

import { createLogger } from '/opt/nodejs/lib/logger.mjs';
import { handleOptions } from '/opt/nodejs/lib/cors.mjs';
import { successResponse, errorResponse, ERRORS } from '/opt/nodejs/lib/responses.mjs';
import { validateBody } from '/opt/nodejs/lib/validation.mjs';
import { extractClientId } from '/opt/nodejs/lib/auth.mjs';
import {
  RegisterClientSchema,
  LoginClientSchema,
  VerifyEmailSchema,
  UpdateClientSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
} from './validation.mjs';
import { registerClient } from './domain/register.mjs';
import { loginClient } from './domain/login.mjs';
import { verifyClientEmail } from './domain/verify-email.mjs';
import { getProfile, updateProfile } from './domain/profile.mjs';
import { logoutClient } from './domain/logout.mjs';
import { deleteClientAccount } from './domain/delete-account.mjs';
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

  logger.info('Clients request received', { path, method });

  try {
    // Health check
    if (path === '/clients/health' && method === 'GET') {
      return successResponse(200, {
        status: 'healthy',
        service: 'medibee-clients',
        timestamp: new Date().toISOString(),
      }, origin);
    }

    // Public routes (no auth required)
    switch (path) {
      case '/clients/register':
        if (method === 'POST') {
          return await handleRegister(event, logger, origin);
        }
        break;

      case '/clients/verify-email':
        if (method === 'POST') {
          return await handleVerifyEmail(event, logger, origin);
        }
        break;

      case '/clients/login':
        if (method === 'POST') {
          return await handleLogin(event, logger, origin);
        }
        break;

      case '/clients/forgot-password':
        if (method === 'POST') {
          return await handleForgotPassword(event, logger, origin);
        }
        break;

      case '/clients/reset-password':
        if (method === 'POST') {
          return await handleResetPassword(event, logger, origin);
        }
        break;
    }

    // Protected routes (auth required)
    let clientId;
    try {
      clientId = extractClientId(event);
    } catch (error) {
      return ERRORS.UNAUTHORIZED('Invalid authorization', origin);
    }

    logger.info('Authenticated client', { clientId });

    switch (path) {
      case '/clients/logout':
        if (method === 'POST') {
          return await handleLogout(event, clientId, logger, origin);
        }
        break;

      case '/clients/me':
        if (method === 'GET') {
          return await handleGetProfile(clientId, logger, origin);
        }
        if (method === 'PATCH') {
          return await handleUpdateProfile(event, clientId, logger, origin);
        }
        if (method === 'DELETE') {
          return await handleDeleteAccount(clientId, logger, origin);
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
 * Handle POST /clients/register
 */
async function handleRegister(event, logger, origin) {
  const validation = validateBody(event.body, RegisterClientSchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  const result = await registerClient(validation.data, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(201, {
    success: true,
    clientId: result.clientId,
    message: result.message,
  }, origin);
}

/**
 * Handle POST /clients/verify-email
 */
async function handleVerifyEmail(event, logger, origin) {
  const validation = validateBody(event.body, VerifyEmailSchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  const result = await verifyClientEmail(validation.data.token, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    success: true,
    message: result.message,
  }, origin);
}

/**
 * Handle POST /clients/login
 */
async function handleLogin(event, logger, origin) {
  const validation = validateBody(event.body, LoginClientSchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  const result = await loginClient(validation.data.email, validation.data.password, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    success: true,
    token: result.token,
    clientId: result.clientId,
    profile: result.profile,
  }, origin);
}

/**
 * Handle POST /clients/logout
 */
async function handleLogout(event, clientId, logger, origin) {
  const sessionId = event.requestContext?.authorizer?.lambda?.sessionId;

  const result = await logoutClient(sessionId, clientId, logger);

  return successResponse(200, {
    success: true,
    message: result.message,
  }, origin);
}

/**
 * Handle GET /clients/me
 */
async function handleGetProfile(clientId, logger, origin) {
  const result = await getProfile(clientId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, result.profile, origin);
}

/**
 * Handle PATCH /clients/me
 */
async function handleUpdateProfile(event, clientId, logger, origin) {
  const validation = validateBody(event.body, UpdateClientSchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  const result = await updateProfile(clientId, validation.data, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, result.profile, origin);
}

/**
 * Handle DELETE /clients/me (GDPR account deletion)
 */
async function handleDeleteAccount(clientId, logger, origin) {
  const result = await deleteClientAccount(clientId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    success: true,
    message: result.message,
  }, origin);
}

/**
 * Handle POST /clients/forgot-password
 */
async function handleForgotPassword(event, logger, origin) {
  const validation = validateBody(event.body, ForgotPasswordSchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  const result = await requestPasswordReset(validation.data.email, 'client', logger);

  // Always return success to prevent email enumeration
  return successResponse(200, {
    success: true,
    message: result.message,
  }, origin);
}

/**
 * Handle POST /clients/reset-password
 */
async function handleResetPassword(event, logger, origin) {
  const validation = validateBody(event.body, ResetPasswordSchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  const result = await resetPassword(validation.data.token, validation.data.password, 'client', logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    success: true,
    message: result.message,
  }, origin);
}

/**
 * Auth Cognito Lambda
 *
 * Handles authentication via:
 * - Social OAuth (Google, Apple) via Cognito
 * - Phone OTP via SNS
 * - Email magic links via SES
 */

import { handleGoogleAuth, handleAppleAuth, handleOAuthCallback } from './handlers/oauth.mjs';
import { handlePhoneRequestOTP, handlePhoneVerifyOTP } from './handlers/phone.mjs';
import { handleEmailRequestMagic, handleEmailVerifyMagic } from './handlers/email.mjs';
import { handleGetSession, handleLogout } from './handlers/session.mjs';

export async function handler(event) {
  const { httpMethod, requestContext, path, queryStringParameters, body, headers } = event;

  // Extract method from HTTP API v2 format
  const method = httpMethod || requestContext?.http?.method;
  const routePath = path || requestContext?.http?.path;

  console.log(`[auth-cognito] ${method} ${routePath}`);

  try {
    // Route to appropriate handler
    switch (true) {
      // Social OAuth redirects
      case method === 'GET' && routePath === '/auth/google':
        return await handleGoogleAuth(event);

      case method === 'GET' && routePath === '/auth/apple':
        return await handleAppleAuth(event);

      // OAuth callback (from Cognito hosted UI)
      case method === 'GET' && routePath === '/auth/callback':
        return await handleOAuthCallback(event);

      // Phone OTP
      case method === 'POST' && routePath === '/auth/phone/request':
        return await handlePhoneRequestOTP(parseBody(body));

      case method === 'POST' && routePath === '/auth/phone/verify':
        return await handlePhoneVerifyOTP(parseBody(body));

      // Email magic link
      case method === 'POST' && routePath === '/auth/email/request':
        return await handleEmailRequestMagic(parseBody(body));

      case method === 'GET' && routePath === '/auth/email/verify':
        return await handleEmailVerifyMagic(queryStringParameters || {});

      // Session management
      case method === 'GET' && routePath === '/auth/session':
        return await handleGetSession(event);

      case method === 'POST' && routePath === '/auth/cognito/logout':
        return await handleLogout(event);

      default:
        return jsonResponse(404, { error: 'Not found' });
    }
  } catch (error) {
    console.error('[auth-cognito] Unhandled error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
}

function parseBody(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

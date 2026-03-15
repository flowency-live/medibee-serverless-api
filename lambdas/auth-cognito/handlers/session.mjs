/**
 * Session Handlers
 *
 * Handles session management (get current session, logout).
 */

import { config } from '../lib/config.mjs';
import {
  verifySessionToken,
  extractSessionFromCookies,
  buildLogoutCookie,
} from '../lib/session.mjs';

/**
 * Get current session from cookie
 */
export async function handleGetSession(event) {
  const cookieHeader = event.headers?.cookie || event.headers?.Cookie;
  const sessionToken = extractSessionFromCookies(cookieHeader);

  if (!sessionToken) {
    return jsonResponse(200, {
      authenticated: false,
    });
  }

  const result = await verifySessionToken(sessionToken);

  if (!result.valid) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': buildLogoutCookie(), // Clear invalid cookie
      },
      body: JSON.stringify({
        authenticated: false,
        error: result.error,
      }),
    };
  }

  return jsonResponse(200, {
    authenticated: true,
    user: {
      candidateId: result.payload.sub,
      email: result.payload.email,
      phone: result.payload.phone,
      type: result.payload.type,
      authMethod: result.payload.authMethod,
      status: result.payload.status,
    },
  });
}

/**
 * Handle logout - clear session cookie
 */
export async function handleLogout(event) {
  console.log('[session] Logout requested');

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': buildLogoutCookie(),
    },
    body: JSON.stringify({
      success: true,
      redirect: `${config.frontendUrl}/candidate/login`,
    }),
  };
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

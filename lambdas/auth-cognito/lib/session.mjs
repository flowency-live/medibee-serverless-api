/**
 * Session Management
 *
 * Creates and verifies session tokens stored in httpOnly cookies.
 */

import jwt from 'jsonwebtoken';
import { config, getJwtSecret, isProd } from './config.mjs';

const SESSION_EXPIRY_DAYS = 90;
const SESSION_EXPIRY_SECONDS = SESSION_EXPIRY_DAYS * 24 * 60 * 60;

/**
 * Create session token for authenticated candidate
 */
export async function createSessionToken(candidate) {
  const secret = await getJwtSecret();

  const payload = {
    sub: candidate.candidateId,
    email: candidate.email,
    phone: candidate.phone,
    type: 'candidate',
    authMethod: candidate.authMethod,
    status: candidate.status,
  };

  return jwt.sign(payload, secret, {
    expiresIn: `${SESSION_EXPIRY_DAYS}d`,
    issuer: 'medibee',
    audience: 'medibee-candidate',
  });
}

/**
 * Verify session token from cookie
 */
export async function verifySessionToken(token) {
  const secret = await getJwtSecret();

  try {
    const payload = jwt.verify(token, secret, {
      issuer: 'medibee',
      audience: 'medibee-candidate',
    });

    return { valid: true, payload };
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return { valid: false, error: 'expired' };
    }
    return { valid: false, error: 'invalid' };
  }
}

/**
 * Build session cookie string
 */
export function buildSessionCookie(sessionToken) {
  const secure = isProd() ? 'Secure; ' : '';
  const domain = config.cookieDomain ? `Domain=${config.cookieDomain}; ` : '';

  return `medibee_session=${sessionToken}; HttpOnly; ${secure}SameSite=Lax; Path=/; Max-Age=${SESSION_EXPIRY_SECONDS}; ${domain}`.trim();
}

/**
 * Build logout cookie (expires immediately)
 */
export function buildLogoutCookie() {
  const secure = isProd() ? 'Secure; ' : '';
  const domain = config.cookieDomain ? `Domain=${config.cookieDomain}; ` : '';

  return `medibee_session=; HttpOnly; ${secure}SameSite=Lax; Path=/; Max-Age=0; ${domain}`.trim();
}

/**
 * Extract session token from cookie header
 */
export function extractSessionFromCookies(cookieHeader) {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    if (key && value) {
      acc[key] = value;
    }
    return acc;
  }, {});

  return cookies.medibee_session || null;
}

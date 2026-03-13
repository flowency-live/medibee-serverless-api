/**
 * Authentication utilities for Medibee Lambdas
 *
 * SECURITY: JWT secret is cached in memory to reduce SSM calls.
 * Token validation uses HS256 with explicit algorithm whitelist.
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import jwt from 'jsonwebtoken';

const ssm = new SSMClient({ region: 'eu-west-2' });

// Cache JWT secret in memory (Lambda container reuse)
let cachedSecret = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get JWT secret from SSM Parameter Store (with caching)
 */
export async function getJWTSecret() {
  const now = Date.now();

  if (cachedSecret && now < cacheExpiry) {
    return cachedSecret;
  }

  const paramName = process.env.JWT_SECRET_PARAM || '/medibee/dev/auth/jwt-secret';

  const result = await ssm.send(new GetParameterCommand({
    Name: paramName,
    WithDecryption: true,
  }));

  if (!result.Parameter?.Value || result.Parameter.Value === 'PLACEHOLDER-SET-VIA-CONSOLE') {
    throw new Error('JWT secret not configured - update SSM parameter');
  }

  cachedSecret = result.Parameter.Value;
  cacheExpiry = now + CACHE_TTL_MS;

  return cachedSecret;
}

/**
 * Verify a JWT token
 * @param {string} token - JWT token to verify
 * @returns {object} Decoded token payload
 * @throws {Error} If token is invalid or expired
 */
export async function verifyToken(token) {
  const secret = await getJWTSecret();

  // SECURITY: Explicit algorithm whitelist to prevent algorithm confusion attacks
  return jwt.verify(token, secret, { algorithms: ['HS256'] });
}

/**
 * Create a new JWT token
 * @param {object} payload - Token payload (candidateId, email, etc.)
 * @param {string} expiresIn - Token expiry (default: 7 days)
 * @returns {string} Signed JWT token
 */
export async function createToken(payload, expiresIn = '7d') {
  const secret = await getJWTSecret();

  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn,
  });
}

/**
 * Extract candidate ID from API Gateway event
 * SECURITY: Only trust JWT claims, NEVER request body or URL params
 *
 * @param {object} event - API Gateway event
 * @returns {string} Candidate ID from JWT claims
 * @throws {Error} If no valid claims found
 */
export function extractCandidateId(event) {
  // For HTTP API with Lambda authorizer (simple response)
  const claims = event?.requestContext?.authorizer?.lambda;

  if (claims?.candidateId) {
    return claims.candidateId;
  }

  // Fallback: check JWT authorizer format
  const jwtClaims = event?.requestContext?.authorizer?.jwt?.claims;
  if (jwtClaims?.sub) {
    return jwtClaims.sub;
  }

  throw new Error('Missing candidate ID in authorization context');
}

/**
 * Extract client ID from API Gateway event
 * SECURITY: Only trust JWT claims, NEVER request body or URL params
 *
 * @param {object} event - API Gateway event
 * @returns {string} Client ID from JWT claims
 * @throws {Error} If no valid claims found
 */
export function extractClientId(event) {
  // For HTTP API with Lambda authorizer (simple response)
  const claims = event?.requestContext?.authorizer?.lambda;

  if (claims?.clientId) {
    return claims.clientId;
  }

  // Fallback: check JWT authorizer format
  const jwtClaims = event?.requestContext?.authorizer?.jwt?.claims;
  if (jwtClaims?.clientId) {
    return jwtClaims.clientId;
  }

  throw new Error('Missing client ID in authorization context');
}

/**
 * Extract admin ID from API Gateway event
 * SECURITY: Only trust JWT claims, NEVER request body or URL params
 *
 * @param {object} event - API Gateway event
 * @returns {string} Admin ID from JWT claims
 * @throws {Error} If no valid claims found
 */
export function extractAdminId(event) {
  // For HTTP API with Lambda authorizer (simple response)
  const claims = event?.requestContext?.authorizer?.lambda;

  if (claims?.adminId) {
    return claims.adminId;
  }

  throw new Error('Missing admin ID in authorization context');
}

/**
 * Extract user type from API Gateway event
 * Returns 'candidate', 'client', or 'admin'
 *
 * @param {object} event - API Gateway event
 * @returns {string} User type from JWT claims
 */
export function extractUserType(event) {
  const claims = event?.requestContext?.authorizer?.lambda;
  return claims?.userType || 'candidate';
}

/**
 * Extract Bearer token from Authorization header
 * @param {object} event - API Gateway event
 * @returns {string|null} Token or null if not present
 */
export function extractBearerToken(event) {
  const authHeader = event?.headers?.authorization || event?.headers?.Authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.substring(7);
}

/**
 * Lambda Authorizer for Medibee API
 *
 * SECURITY:
 * - Fails CLOSED (deny by default)
 * - Uses explicit HS256 algorithm whitelist
 * - Extracts candidateId from verified JWT only
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import jwt from 'jsonwebtoken';

const ssm = new SSMClient({ region: 'eu-west-2' });

// Cache JWT secret
let cachedSecret = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getJWTSecret() {
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
    throw new Error('JWT secret not configured');
  }

  cachedSecret = result.Parameter.Value;
  cacheExpiry = now + CACHE_TTL_MS;

  return cachedSecret;
}

export const handler = async (event) => {
  // SECURITY: Default to DENY
  const denyResponse = {
    isAuthorized: false,
  };

  try {
    // Extract Authorization header
    const authHeader = event.headers?.authorization || event.headers?.Authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('Missing or invalid Authorization header');
      return denyResponse;
    }

    const token = authHeader.substring(7);

    // Verify token
    const secret = await getJWTSecret();

    // SECURITY: Explicit algorithm whitelist
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });

    // Validate required claims
    if (!decoded.sub || !decoded.email) {
      console.log('Token missing required claims');
      return denyResponse;
    }

    // Check token expiry (jwt.verify handles this, but be explicit)
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      console.log('Token expired');
      return denyResponse;
    }

    // Return authorized response with context
    return {
      isAuthorized: true,
      context: {
        candidateId: decoded.sub,
        email: decoded.email,
        status: decoded.status || 'unknown',
      },
    };

  } catch (error) {
    // SECURITY: Log error but don't expose details
    console.error('Authorization failed:', error.name, error.message);
    return denyResponse;
  }
};

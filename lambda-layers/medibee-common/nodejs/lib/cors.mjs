/**
 * CORS utilities for Medibee Lambdas
 */

const stage = process.env.STAGE || 'dev';

const ALLOWED_ORIGINS = stage === 'prod'
  ? ['https://www.medibee-recruitment.co.uk', 'https://medibee-recruitment.co.uk']
  : ['https://medibee.opstack.uk', 'http://localhost:3000'];

export function getCorsHeaders(origin) {
  // Check if origin is allowed
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '3600',
  };
}

export function handleOptions(event) {
  const origin = event?.headers?.origin || event?.headers?.Origin || ALLOWED_ORIGINS[0];

  return {
    statusCode: 204,
    headers: getCorsHeaders(origin),
    body: '',
  };
}

// Default headers for responses
export const corsHeaders = getCorsHeaders(ALLOWED_ORIGINS[0]);

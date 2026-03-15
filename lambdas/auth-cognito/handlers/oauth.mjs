/**
 * OAuth Handlers
 *
 * Handles Google and Apple OAuth flows via Cognito.
 */

import crypto from 'crypto';
import { config, getCognitoClientSecret } from '../lib/config.mjs';
import { storeOAuthState, verifyAndDeleteOAuthState, createOrUpdateCandidate } from '../lib/dynamodb.mjs';
import { createSessionToken, buildSessionCookie } from '../lib/session.mjs';

/**
 * Handle Google OAuth redirect
 */
export async function handleGoogleAuth(event) {
  return handleSocialAuth('Google');
}

/**
 * Handle Apple OAuth redirect
 */
export async function handleAppleAuth(event) {
  return handleSocialAuth('SignInWithApple');
}

/**
 * Generic social auth redirect handler
 */
async function handleSocialAuth(provider) {
  // Generate CSRF state token
  const state = crypto.randomUUID();

  // Store state in DynamoDB with TTL
  await storeOAuthState(state);

  // Build Cognito authorize URL
  const params = new URLSearchParams({
    client_id: config.cognitoClientId,
    response_type: 'code',
    scope: 'email openid profile',
    redirect_uri: config.callbackUrl,
    identity_provider: provider,
    state: state,
  });

  const authorizeUrl = `${config.cognitoDomain}/oauth2/authorize?${params}`;

  return {
    statusCode: 302,
    headers: {
      Location: authorizeUrl,
      'Cache-Control': 'no-store',
    },
    body: '',
  };
}

/**
 * Handle OAuth callback from Cognito
 */
export async function handleOAuthCallback(event) {
  const { code, state, error, error_description } = event.queryStringParameters || {};

  // Handle user cancellation or error
  if (error) {
    console.error('[oauth] Cognito error:', error, error_description);
    return redirectWithError('Authentication cancelled or failed');
  }

  if (!code || !state) {
    return redirectWithError('Invalid callback parameters');
  }

  // Verify CSRF state token
  const stateValid = await verifyAndDeleteOAuthState(state);
  if (!stateValid) {
    return redirectWithError('Invalid or expired session. Please try again.');
  }

  try {
    // Exchange authorization code for tokens
    const tokens = await exchangeCodeForTokens(code);

    if (!tokens) {
      return redirectWithError('Failed to complete authentication');
    }

    // Decode ID token to get user info
    const userInfo = decodeIdToken(tokens.id_token);

    if (!userInfo) {
      return redirectWithError('Failed to get user information');
    }

    // Determine auth provider from identities claim
    const provider = userInfo.identities?.[0]?.providerName?.toLowerCase() || 'cognito';

    // Create or update candidate in DynamoDB
    const candidate = await createOrUpdateCandidate({
      cognitoSub: userInfo.sub,
      email: userInfo.email,
      firstName: userInfo.given_name,
      lastName: userInfo.family_name,
      profilePicture: userInfo.picture,
      authMethod: provider,
    });

    // Create session token
    const sessionToken = await createSessionToken(candidate);

    // Determine redirect path based on onboarding status
    const redirectPath = candidate.status === 'pending_onboarding'
      ? '/candidate/onboarding'
      : '/candidate/dashboard';

    return {
      statusCode: 302,
      headers: {
        Location: `${config.frontendUrl}${redirectPath}`,
        'Set-Cookie': buildSessionCookie(sessionToken),
        'Cache-Control': 'no-store',
      },
      body: '',
    };
  } catch (error) {
    console.error('[oauth] Callback error:', error);
    return redirectWithError('Authentication failed. Please try again.');
  }
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(code) {
  const clientSecret = await getCognitoClientSecret();

  const tokenUrl = `${config.cognitoDomain}/oauth2/token`;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.cognitoClientId,
    client_secret: clientSecret,
    code: code,
    redirect_uri: config.callbackUrl,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[oauth] Token exchange failed:', response.status, errorText);
    return null;
  }

  return response.json();
}

/**
 * Decode JWT ID token (without verification - verification done by Cognito)
 */
function decodeIdToken(idToken) {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    return payload;
  } catch (error) {
    console.error('[oauth] Failed to decode ID token:', error);
    return null;
  }
}

/**
 * Redirect to frontend with error message
 */
function redirectWithError(message) {
  const errorUrl = `${config.frontendUrl}/candidate/login?error=${encodeURIComponent(message)}`;

  return {
    statusCode: 302,
    headers: {
      Location: errorUrl,
      'Cache-Control': 'no-store',
    },
    body: '',
  };
}

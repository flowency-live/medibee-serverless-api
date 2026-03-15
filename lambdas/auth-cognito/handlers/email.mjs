/**
 * Email Magic Link Handlers
 *
 * Handles passwordless email authentication via magic links.
 */

import crypto from 'crypto';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { config } from '../lib/config.mjs';
import {
  storeMagicToken,
  getMagicToken,
  deleteMagicToken,
  checkRateLimit,
  createOrUpdateCandidate,
} from '../lib/dynamodb.mjs';
import { createSessionToken, buildSessionCookie } from '../lib/session.mjs';

const sesClient = new SESClient({});

// Email regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Handle magic link request
 */
export async function handleEmailRequestMagic(body) {
  const { email } = body;

  // Validate email
  if (!email || !EMAIL_REGEX.test(email)) {
    return jsonResponse(400, { error: 'Invalid email address' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Rate limit: max 3 magic links per email per hour
  const rateKey = `EMAIL#${normalizedEmail}`;
  const rateLimit = await checkRateLimit(rateKey, 3, 3600);

  if (!rateLimit.allowed) {
    return jsonResponse(429, {
      error: 'Too many requests. Please try again later.',
    });
  }

  // Generate secure token
  const token = crypto.randomBytes(32).toString('hex');

  // Store token in DynamoDB
  await storeMagicToken(token, normalizedEmail);

  // Build magic link URL
  const magicLink = `${config.apiBaseUrl}/auth/email/verify?token=${token}`;

  // Send email via SES
  try {
    await sesClient.send(
      new SendEmailCommand({
        Source: 'Medibee <noreply@medibee-recruitment.co.uk>',
        Destination: {
          ToAddresses: [normalizedEmail],
        },
        Message: {
          Subject: {
            Data: 'Sign in to Medibee',
            Charset: 'UTF-8',
          },
          Body: {
            Html: {
              Data: buildMagicLinkEmail(magicLink),
              Charset: 'UTF-8',
            },
            Text: {
              Data: buildMagicLinkEmailText(magicLink),
              Charset: 'UTF-8',
            },
          },
        },
      })
    );
  } catch (error) {
    console.error('[email] SES send failed:', error);
    // Delete the stored token since we couldn't send the email
    await deleteMagicToken(token);
    return jsonResponse(500, {
      error: 'Failed to send email. Please try again.',
    });
  }

  console.log(`[email] Magic link sent to ${normalizedEmail.slice(0, 3)}***`);

  return jsonResponse(200, {
    success: true,
    message: 'Magic link sent',
    expiresIn: 900, // 15 minutes
  });
}

/**
 * Handle magic link verification
 */
export async function handleEmailVerifyMagic(queryParams) {
  const { token } = queryParams;

  if (!token) {
    return redirectWithError('Invalid verification link');
  }

  // Get token record
  const tokenRecord = await getMagicToken(token);

  if (!tokenRecord) {
    return redirectWithError('This link has expired or is invalid. Please request a new one.');
  }

  // Check if expired
  const now = Math.floor(Date.now() / 1000);
  if (tokenRecord.ttl < now) {
    await deleteMagicToken(token);
    return redirectWithError('This link has expired. Please request a new one.');
  }

  const email = tokenRecord.email;

  // Delete token (single use)
  await deleteMagicToken(token);

  // Create synthetic Cognito sub for email users
  const cognitoSub = `email_${email}`;

  // Create or update candidate
  const candidate = await createOrUpdateCandidate({
    cognitoSub,
    email,
    authMethod: 'email',
  });

  // Create session token
  const sessionToken = await createSessionToken(candidate);

  // Determine redirect path
  const redirectPath = candidate.status === 'pending_onboarding'
    ? '/candidate/onboarding'
    : '/candidate/dashboard';

  console.log(`[email] Verified ${email.slice(0, 3)}***, candidate: ${candidate.candidateId}`);

  return {
    statusCode: 302,
    headers: {
      Location: `${config.frontendUrl}${redirectPath}`,
      'Set-Cookie': buildSessionCookie(sessionToken),
      'Cache-Control': 'no-store',
    },
    body: '',
  };
}

/**
 * Build magic link email HTML
 */
function buildMagicLinkEmail(magicLink) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in to Medibee</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #E6E3CF;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 4px; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background-color: #696F8B; padding: 30px 40px; text-align: center;">
              <h1 style="margin: 0; color: #E5D7A2; font-size: 28px; font-weight: 600;">Medibee</h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 20px; color: #09080A; font-size: 22px; font-weight: 600;">Sign in to your account</h2>
              <p style="margin: 0 0 30px; color: #696F8B; font-size: 16px; line-height: 1.5;">
                Click the button below to securely sign in to your Medibee account. This link will expire in 15 minutes.
              </p>
              <table role="presentation" style="margin: 0 auto;">
                <tr>
                  <td style="background-color: #D3B25B; border-radius: 4px;">
                    <a href="${magicLink}" style="display: inline-block; padding: 14px 30px; color: #09080A; text-decoration: none; font-size: 16px; font-weight: 600;">
                      Sign In
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 30px 0 0; color: #9A999B; font-size: 14px; line-height: 1.5;">
                If you didn't request this email, you can safely ignore it.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f5f5f5; padding: 20px 40px; text-align: center;">
              <p style="margin: 0; color: #9A999B; font-size: 12px;">
                Medibee Recruitment Ltd<br>
                <a href="${config.frontendUrl}" style="color: #696F8B; text-decoration: none;">medibee-recruitment.co.uk</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Build magic link email plain text
 */
function buildMagicLinkEmailText(magicLink) {
  return `
Sign in to Medibee

Click the link below to securely sign in to your Medibee account:

${magicLink}

This link will expire in 15 minutes.

If you didn't request this email, you can safely ignore it.

---
Medibee Recruitment Ltd
${config.frontendUrl}
  `.trim();
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

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

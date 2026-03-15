/**
 * Phone OTP Handlers
 *
 * Handles phone-based authentication via SMS OTP.
 */

import crypto from 'crypto';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { config } from '../lib/config.mjs';
import {
  storeOTP,
  getOTP,
  incrementOTPAttempts,
  deleteOTP,
  checkRateLimit,
  createOrUpdateCandidate,
  normalizePhoneNumber,
} from '../lib/dynamodb.mjs';
import { createSessionToken, buildSessionCookie } from '../lib/session.mjs';

const snsClient = new SNSClient({});

// UK phone regex
const UK_PHONE_REGEX = /^(?:0|\+44)[0-9\s]{9,13}$/;

/**
 * Handle OTP request (send SMS)
 */
export async function handlePhoneRequestOTP(body) {
  const { phone } = body;

  // Validate phone format
  if (!phone || !UK_PHONE_REGEX.test(phone.replace(/\s/g, ''))) {
    return jsonResponse(400, { error: 'Invalid UK phone number' });
  }

  const normalizedPhone = normalizePhoneNumber(phone);

  // Rate limit: max 3 OTPs per phone per hour
  const rateKey = `PHONE#${normalizedPhone}`;
  const rateLimit = await checkRateLimit(rateKey, 3, 3600);

  if (!rateLimit.allowed) {
    return jsonResponse(429, {
      error: 'Too many requests. Please try again later.',
    });
  }

  // Generate 6-digit OTP
  const otp = crypto.randomInt(100000, 999999).toString();

  // Hash OTP before storing (don't store plaintext)
  const otpHash = await hashOTP(otp);

  // Store OTP in DynamoDB
  await storeOTP(normalizedPhone, otpHash);

  // Send SMS via SNS
  try {
    await snsClient.send(
      new PublishCommand({
        PhoneNumber: normalizedPhone,
        Message: `Your Medibee verification code is: ${otp}. Valid for 5 minutes. Do not share this code.`,
        MessageAttributes: {
          'AWS.SNS.SMS.SenderID': {
            DataType: 'String',
            StringValue: 'Medibee',
          },
          'AWS.SNS.SMS.SMSType': {
            DataType: 'String',
            StringValue: 'Transactional',
          },
        },
      })
    );
  } catch (error) {
    console.error('[phone] SMS send failed:', error);
    // Delete the stored OTP since we couldn't send it
    await deleteOTP(normalizedPhone);
    return jsonResponse(500, {
      error: 'Failed to send verification code. Please try again.',
    });
  }

  console.log(`[phone] OTP sent to ${normalizedPhone.slice(0, 6)}***`);

  return jsonResponse(200, {
    success: true,
    message: 'Verification code sent',
    expiresIn: 300, // 5 minutes
  });
}

/**
 * Handle OTP verification
 */
export async function handlePhoneVerifyOTP(body) {
  const { phone, otp } = body;

  // Validate inputs
  if (!phone || !UK_PHONE_REGEX.test(phone.replace(/\s/g, ''))) {
    return jsonResponse(400, { error: 'Invalid phone number' });
  }

  if (!otp || !/^\d{6}$/.test(otp)) {
    return jsonResponse(400, { error: 'Invalid verification code' });
  }

  const normalizedPhone = normalizePhoneNumber(phone);

  // Get OTP record
  const otpRecord = await getOTP(normalizedPhone);

  if (!otpRecord) {
    return jsonResponse(400, {
      error: 'No verification code found. Please request a new code.',
    });
  }

  // Check if expired (TTL should handle this, but double-check)
  const now = Math.floor(Date.now() / 1000);
  if (otpRecord.ttl < now) {
    await deleteOTP(normalizedPhone);
    return jsonResponse(400, {
      error: 'Verification code expired. Please request a new code.',
    });
  }

  // Check attempts (max 3)
  if (otpRecord.attempts >= 3) {
    await deleteOTP(normalizedPhone);
    return jsonResponse(400, {
      error: 'Too many incorrect attempts. Please request a new code.',
    });
  }

  // Verify OTP
  const isValid = await verifyOTPHash(otp, otpRecord.otpHash);

  if (!isValid) {
    await incrementOTPAttempts(normalizedPhone);
    const remaining = 2 - otpRecord.attempts;
    return jsonResponse(400, {
      error: `Incorrect code. ${remaining > 0 ? `${remaining} attempts remaining.` : 'Please request a new code.'}`,
    });
  }

  // OTP verified - delete it (single use)
  await deleteOTP(normalizedPhone);

  // Create synthetic Cognito sub for phone users
  const cognitoSub = `phone_${normalizedPhone}`;

  // Create or update candidate
  const candidate = await createOrUpdateCandidate({
    cognitoSub,
    phone: normalizedPhone,
    authMethod: 'phone',
  });

  // Create session token
  const sessionToken = await createSessionToken(candidate);

  // Determine redirect path
  const redirectPath = candidate.status === 'pending_onboarding'
    ? '/candidate/onboarding'
    : '/candidate/dashboard';

  console.log(`[phone] Verified ${normalizedPhone.slice(0, 6)}***, candidate: ${candidate.candidateId}`);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': buildSessionCookie(sessionToken),
    },
    body: JSON.stringify({
      success: true,
      redirect: redirectPath,
    }),
  };
}

/**
 * Hash OTP using SHA-256
 */
async function hashOTP(otp) {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

/**
 * Verify OTP against stored hash
 */
async function verifyOTPHash(otp, storedHash) {
  const hash = await hashOTP(otp);
  return crypto.timingSafeEqual(
    Buffer.from(hash, 'hex'),
    Buffer.from(storedHash, 'hex')
  );
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

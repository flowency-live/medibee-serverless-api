/**
 * DynamoDB Operations for Auth Cognito
 *
 * Handles candidate creation/update and session tokens.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { config } from './config.mjs';
import { generateCandidateId, generateShortId } from '/opt/nodejs/lib/ids.mjs';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

/**
 * Find candidate by Cognito sub (user ID)
 */
export async function findCandidateByCognitoSub(cognitoSub) {
  const command = new QueryCommand({
    TableName: config.tableName,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `COGNITO#${cognitoSub}`,
    },
    Limit: 1,
  });

  const response = await docClient.send(command);
  return response.Items?.[0] || null;
}

/**
 * Find candidate by email
 */
export async function findCandidateByEmail(email) {
  const normalizedEmail = email.toLowerCase().trim();

  const command = new QueryCommand({
    TableName: config.tableName,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `EMAIL#${normalizedEmail}`,
    },
    Limit: 1,
  });

  const response = await docClient.send(command);
  return response.Items?.[0] || null;
}

/**
 * Find candidate by phone
 */
export async function findCandidateByPhone(phone) {
  const normalizedPhone = normalizePhoneNumber(phone);

  const command = new QueryCommand({
    TableName: config.tableName,
    IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `PHONE#${normalizedPhone}`,
    },
    Limit: 1,
  });

  const response = await docClient.send(command);
  return response.Items?.[0] || null;
}

/**
 * Create or update candidate from auth data
 */
export async function createOrUpdateCandidate({
  cognitoSub,
  email,
  phone,
  firstName,
  lastName,
  authMethod,
  profilePicture,
}) {
  // Check if candidate exists by cognitoSub
  let candidate = await findCandidateByCognitoSub(cognitoSub);

  if (candidate) {
    // Update existing candidate
    const updates = [];
    const values = {};

    if (firstName && !candidate.firstName) {
      updates.push('firstName = :firstName');
      values[':firstName'] = firstName;
    }
    if (lastName && !candidate.lastName) {
      updates.push('lastName = :lastName');
      values[':lastName'] = lastName;
    }
    if (profilePicture && !candidate.profilePicture) {
      updates.push('profilePicture = :profilePicture');
      values[':profilePicture'] = profilePicture;
    }
    updates.push('updatedAt = :updatedAt');
    values[':updatedAt'] = new Date().toISOString();

    if (updates.length > 1) {
      const command = new UpdateCommand({
        TableName: config.tableName,
        Key: {
          PK: candidate.PK,
          SK: candidate.SK,
        },
        UpdateExpression: `SET ${updates.join(', ')}`,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      });

      const response = await docClient.send(command);
      return response.Attributes;
    }

    return candidate;
  }

  // Check if candidate exists by email (for linking accounts)
  if (email) {
    candidate = await findCandidateByEmail(email);
    if (candidate) {
      // Link Cognito account to existing candidate
      const command = new UpdateCommand({
        TableName: config.tableName,
        Key: {
          PK: candidate.PK,
          SK: candidate.SK,
        },
        UpdateExpression: 'SET cognitoSub = :cognitoSub, authMethod = :authMethod, GSI1PK = :gsi1pk, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':cognitoSub': cognitoSub,
          ':authMethod': authMethod,
          ':gsi1pk': `COGNITO#${cognitoSub}`,
          ':updatedAt': new Date().toISOString(),
        },
        ReturnValues: 'ALL_NEW',
      });

      const response = await docClient.send(command);
      return response.Attributes;
    }
  }

  // Create new candidate
  const candidateId = generateCandidateId();
  const now = new Date().toISOString();
  const normalizedEmail = email ? email.toLowerCase().trim() : null;
  const normalizedPhone = phone ? normalizePhoneNumber(phone) : null;

  const newCandidate = {
    PK: `CANDIDATE#${candidateId}`,
    SK: 'PROFILE',
    candidateId,
    cognitoSub,
    email: normalizedEmail,
    phone: normalizedPhone,
    firstName: firstName || null,
    lastName: lastName || null,
    profilePicture: profilePicture || null,
    authMethod,
    status: 'pending_onboarding',
    createdAt: now,
    updatedAt: now,
    // GSI1: For lookup by cognitoSub
    GSI1PK: `COGNITO#${cognitoSub}`,
    GSI1SK: candidateId,
    // GSI2: For lookup by phone (if provided)
    ...(normalizedPhone && {
      GSI2PK: `PHONE#${normalizedPhone}`,
      GSI2SK: candidateId,
    }),
  };

  const command = new PutCommand({
    TableName: config.tableName,
    Item: newCandidate,
    ConditionExpression: 'attribute_not_exists(PK)',
  });

  await docClient.send(command);
  return newCandidate;
}

/**
 * Store OTP in DynamoDB with TTL
 */
export async function storeOTP(phone, otpHash) {
  const normalizedPhone = normalizePhoneNumber(phone);
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 300; // 5 minutes

  const command = new PutCommand({
    TableName: config.tableName,
    Item: {
      PK: `OTP#${normalizedPhone}`,
      SK: 'PHONE',
      otpHash,
      attempts: 0,
      createdAt: now,
      ttl,
    },
  });

  await docClient.send(command);
}

/**
 * Get OTP record
 */
export async function getOTP(phone) {
  const normalizedPhone = normalizePhoneNumber(phone);

  const command = new GetCommand({
    TableName: config.tableName,
    Key: {
      PK: `OTP#${normalizedPhone}`,
      SK: 'PHONE',
    },
  });

  const response = await docClient.send(command);
  return response.Item || null;
}

/**
 * Increment OTP attempts
 */
export async function incrementOTPAttempts(phone) {
  const normalizedPhone = normalizePhoneNumber(phone);

  const command = new UpdateCommand({
    TableName: config.tableName,
    Key: {
      PK: `OTP#${normalizedPhone}`,
      SK: 'PHONE',
    },
    UpdateExpression: 'SET attempts = attempts + :inc',
    ExpressionAttributeValues: {
      ':inc': 1,
    },
  });

  await docClient.send(command);
}

/**
 * Delete OTP record
 */
export async function deleteOTP(phone) {
  const normalizedPhone = normalizePhoneNumber(phone);

  const command = new DeleteCommand({
    TableName: config.tableName,
    Key: {
      PK: `OTP#${normalizedPhone}`,
      SK: 'PHONE',
    },
  });

  await docClient.send(command);
}

/**
 * Store magic link token
 */
export async function storeMagicToken(token, email) {
  const normalizedEmail = email.toLowerCase().trim();
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 900; // 15 minutes

  const command = new PutCommand({
    TableName: config.tableName,
    Item: {
      PK: `MAGIC#${token}`,
      SK: 'EMAIL',
      email: normalizedEmail,
      createdAt: now,
      ttl,
    },
  });

  await docClient.send(command);
}

/**
 * Get magic token record
 */
export async function getMagicToken(token) {
  const command = new GetCommand({
    TableName: config.tableName,
    Key: {
      PK: `MAGIC#${token}`,
      SK: 'EMAIL',
    },
  });

  const response = await docClient.send(command);
  return response.Item || null;
}

/**
 * Delete magic token
 */
export async function deleteMagicToken(token) {
  const command = new DeleteCommand({
    TableName: config.tableName,
    Key: {
      PK: `MAGIC#${token}`,
      SK: 'EMAIL',
    },
  });

  await docClient.send(command);
}

/**
 * Store OAuth state token (CSRF protection)
 */
export async function storeOAuthState(state) {
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 600; // 10 minutes

  const command = new PutCommand({
    TableName: config.tableName,
    Item: {
      PK: `STATE#${state}`,
      SK: 'AUTH',
      createdAt: now,
      ttl,
    },
  });

  await docClient.send(command);
}

/**
 * Verify and delete OAuth state
 */
export async function verifyAndDeleteOAuthState(state) {
  const command = new GetCommand({
    TableName: config.tableName,
    Key: {
      PK: `STATE#${state}`,
      SK: 'AUTH',
    },
  });

  const response = await docClient.send(command);

  if (!response.Item) {
    return false;
  }

  // Delete the state token (single use)
  await docClient.send(
    new DeleteCommand({
      TableName: config.tableName,
      Key: {
        PK: `STATE#${state}`,
        SK: 'AUTH',
      },
    })
  );

  return true;
}

/**
 * Check rate limit (returns { allowed: boolean, remaining: number })
 */
export async function checkRateLimit(key, maxRequests, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSeconds;

  const command = new GetCommand({
    TableName: config.tableName,
    Key: {
      PK: `RATE#${key}`,
      SK: 'LIMIT',
    },
  });

  const response = await docClient.send(command);
  const record = response.Item;

  if (!record || record.windowStart < windowStart) {
    // New window
    await docClient.send(
      new PutCommand({
        TableName: config.tableName,
        Item: {
          PK: `RATE#${key}`,
          SK: 'LIMIT',
          count: 1,
          windowStart: now,
          ttl: now + windowSeconds + 60, // TTL slightly longer than window
        },
      })
    );
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (record.count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  // Increment count
  await docClient.send(
    new UpdateCommand({
      TableName: config.tableName,
      Key: {
        PK: `RATE#${key}`,
        SK: 'LIMIT',
      },
      UpdateExpression: 'SET #count = #count + :inc',
      ExpressionAttributeNames: {
        '#count': 'count',
      },
      ExpressionAttributeValues: {
        ':inc': 1,
      },
    })
  );

  return { allowed: true, remaining: maxRequests - record.count - 1 };
}

/**
 * Normalize phone number to E.164 format
 */
export function normalizePhoneNumber(phone) {
  // Remove spaces and non-digit characters (except +)
  let normalized = phone.replace(/[^\d+]/g, '');

  // Convert UK format to E.164
  if (normalized.startsWith('0')) {
    normalized = '+44' + normalized.slice(1);
  } else if (!normalized.startsWith('+')) {
    normalized = '+44' + normalized;
  }

  return normalized;
}

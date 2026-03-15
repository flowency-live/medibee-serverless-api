/**
 * Admin Login Domain Logic
 *
 * Handles admin authentication with separate JWT issuer for admin tokens.
 * Admin records use: PK=ADMIN#{adminId}, SK=PROFILE
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { createHmac } from 'crypto';
import { verifyPassword } from '/opt/nodejs/lib/password.mjs';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const ssmClient = new SSMClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const JWT_SECRET_PARAM = process.env.JWT_SECRET_PARAM;

// Cache JWT secret to avoid repeated SSM calls
let cachedJwtSecret = null;

/**
 * Get JWT secret from SSM Parameter Store (cached)
 */
async function getJwtSecret() {
  if (cachedJwtSecret) {
    return cachedJwtSecret;
  }

  const command = new GetParameterCommand({
    Name: JWT_SECRET_PARAM,
    WithDecryption: true,
  });

  const response = await ssmClient.send(command);
  cachedJwtSecret = response.Parameter.Value;
  return cachedJwtSecret;
}

/**
 * Verify admin password using shared password module
 * Uses hash-wasm Argon2id (pure WebAssembly, cross-platform)
 */
async function verifyAdminPassword(password, storedHash) {
  return await verifyPassword(storedHash, password);
}

/**
 * Create JWT token for admin
 */
async function createAdminJwt(admin) {
  const secret = await getJwtSecret();

  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: admin.adminId,
    email: admin.email,
    type: 'admin',
    iss: 'medibee-admin', // Separate issuer for admin tokens
    iat: now,
    exp: now + (8 * 60 * 60), // 8 hours for admin sessions
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Find admin by email using GSI1 (EMAIL index)
 */
async function findAdminByEmail(email) {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `EMAIL#${email}`,
    },
    Limit: 1,
  }));

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  const item = result.Items[0];

  // Verify this is an admin record
  if (!item.PK.startsWith('ADMIN#')) {
    return null;
  }

  return item;
}

/**
 * Hardcoded dev admin credentials
 * TODO: Remove in production - use DynamoDB admin records only
 */
const DEV_ADMIN = {
  email: 'admin@medibee',
  password: 'Test1234!',
  adminId: 'ADMIN-DEV-001',
  name: 'Dev Admin',
  status: 'active',
};

/**
 * Admin login
 *
 * @param {Object} credentials - { email, password }
 * @param {Object} logger - Logger instance
 * @returns {Object} - { success, token, adminId, email } or error
 */
export async function adminLogin(credentials, logger) {
  const { email, password } = credentials;

  logger.info('Admin login attempt', { email });

  // Check hardcoded dev admin first (temporary for testing)
  if (email === DEV_ADMIN.email && password === DEV_ADMIN.password) {
    logger.info('Dev admin login successful');
    const token = await createAdminJwt(DEV_ADMIN);
    return {
      success: true,
      token,
      adminId: DEV_ADMIN.adminId,
      email: DEV_ADMIN.email,
      name: DEV_ADMIN.name,
      status: 200,
    };
  }

  // Find admin by email in DynamoDB
  const admin = await findAdminByEmail(email);

  if (!admin) {
    logger.warn('Admin not found', { email });
    return {
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password.',
      status: 401,
    };
  }

  // Verify password
  const passwordValid = await verifyAdminPassword(password, admin.passwordHash);

  if (!passwordValid) {
    logger.warn('Invalid password for admin', { email });
    return {
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password.',
      status: 401,
    };
  }

  // Check admin status
  if (admin.status !== 'active') {
    logger.warn('Admin account not active', { email, status: admin.status });
    return {
      success: false,
      error: 'ACCOUNT_INACTIVE',
      message: 'Your admin account is not active.',
      status: 403,
    };
  }

  // Create JWT
  const token = await createAdminJwt(admin);

  logger.info('Admin login successful', { adminId: admin.adminId });

  return {
    success: true,
    token,
    adminId: admin.adminId,
    email: admin.email,
    name: admin.name,
    status: 200,
  };
}

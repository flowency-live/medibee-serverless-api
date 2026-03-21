import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  InitiateAuthCommand,
  ConfirmSignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { z } from 'zod';

// ============================================
// Clients
// ============================================
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognitoClient = new CognitoIdentityProviderClient({});

const TABLE_NAME = process.env.TABLE_NAME!;
const USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID!;
const TENANT_ID = process.env.TENANT_ID || 'TENANT#MEDIBEE';

// ============================================
// Schemas
// ============================================
const RegisterCandidateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
});

const RegisterClientSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  organisationName: z.string().min(1),
  contactName: z.string().min(1),
  organisationType: z.enum(['nhs', 'private-hospital', 'care-home', 'supported-living', 'domiciliary', 'other']),
  phone: z.string().optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const VerifyEmailSchema = z.object({
  email: z.string().email(),
  code: z.string().min(6).max(6),
});

// ============================================
// Helpers
// ============================================
function response(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}${timestamp}${random}`.toUpperCase();
}

// ============================================
// Route Handlers
// ============================================
async function handleRegisterCandidate(body: unknown): Promise<APIGatewayProxyResultV2> {
  const parsed = RegisterCandidateSchema.safeParse(body);
  if (!parsed.success) {
    return response(400, { error: 'Invalid input', details: parsed.error.errors });
  }

  const { email, password, firstName, lastName, phone } = parsed.data;
  const candidateId = generateId('CAND-');

  try {
    // Create Cognito user
    await cognitoClient.send(new SignUpCommand({
      ClientId: USER_POOL_CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'given_name', Value: firstName },
        { Name: 'family_name', Value: lastName },
        { Name: 'custom:userType', Value: 'candidate' },
        { Name: 'custom:tenantId', Value: TENANT_ID },
        ...(phone ? [{ Name: 'phone_number', Value: phone }] : []),
      ],
    }));

    // Create DynamoDB record
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: TENANT_ID,
        SK: candidateId,
        GSI1PK: `${TENANT_ID}#CANDIDATES`,
        GSI1SK: candidateId,
        GSI2PK: `${TENANT_ID}#EMAIL`,
        GSI2SK: email.toLowerCase(),
        entityType: 'CANDIDATE',
        candidateId,
        email: email.toLowerCase(),
        firstName,
        lastName,
        phone: phone || null,
        status: 'pending_verification',
        profileCompletion: 10,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      ConditionExpression: 'attribute_not_exists(SK)',
    }));

    return response(201, {
      message: 'Registration successful. Please verify your email.',
      candidateId,
      email,
    });
  } catch (error: unknown) {
    const err = error as { name?: string; message?: string };
    if (err.name === 'UsernameExistsException') {
      return response(409, { error: 'Email already registered' });
    }
    console.error('Registration error:', error);
    return response(500, { error: 'Registration failed' });
  }
}

async function handleRegisterClient(body: unknown): Promise<APIGatewayProxyResultV2> {
  const parsed = RegisterClientSchema.safeParse(body);
  if (!parsed.success) {
    return response(400, { error: 'Invalid input', details: parsed.error.errors });
  }

  const { email, password, organisationName, contactName, organisationType, phone } = parsed.data;
  const clientId = generateId('CLIENT-');

  try {
    // Create Cognito user
    await cognitoClient.send(new SignUpCommand({
      ClientId: USER_POOL_CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'given_name', Value: contactName.split(' ')[0] },
        { Name: 'family_name', Value: contactName.split(' ').slice(1).join(' ') || contactName },
        { Name: 'custom:userType', Value: 'client' },
        { Name: 'custom:tenantId', Value: TENANT_ID },
        ...(phone ? [{ Name: 'phone_number', Value: phone }] : []),
      ],
    }));

    // Create DynamoDB record
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: TENANT_ID,
        SK: clientId,
        GSI1PK: `${TENANT_ID}#CLIENTS`,
        GSI1SK: clientId,
        GSI2PK: `${TENANT_ID}#EMAIL`,
        GSI2SK: email.toLowerCase(),
        entityType: 'CLIENT',
        clientId,
        email: email.toLowerCase(),
        organisationName,
        contactName,
        organisationType,
        phone: phone || null,
        status: 'pending_approval',
        subscriptionTier: 'explorer',
        introductionCredits: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      ConditionExpression: 'attribute_not_exists(SK)',
    }));

    return response(201, {
      message: 'Registration successful. Please verify your email and await approval.',
      clientId,
      email,
    });
  } catch (error: unknown) {
    const err = error as { name?: string; message?: string };
    if (err.name === 'UsernameExistsException') {
      return response(409, { error: 'Email already registered' });
    }
    console.error('Registration error:', error);
    return response(500, { error: 'Registration failed' });
  }
}

async function handleLogin(body: unknown, userType: 'candidate' | 'client'): Promise<APIGatewayProxyResultV2> {
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return response(400, { error: 'Invalid input', details: parsed.error.errors });
  }

  const { email, password } = parsed.data;

  try {
    const authResult = await cognitoClient.send(new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: USER_POOL_CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    }));

    if (!authResult.AuthenticationResult) {
      return response(401, { error: 'Authentication failed' });
    }

    // Get user from DynamoDB
    const userResult = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `${TENANT_ID}#EMAIL`,
        ':sk': email.toLowerCase(),
      },
    }));

    const user = userResult.Items?.[0];
    if (!user) {
      return response(404, { error: 'User not found' });
    }

    // Verify user type matches
    if (userType === 'candidate' && user.entityType !== 'CANDIDATE') {
      return response(403, { error: 'Invalid user type' });
    }
    if (userType === 'client' && user.entityType !== 'CLIENT') {
      return response(403, { error: 'Invalid user type' });
    }

    return response(200, {
      token: authResult.AuthenticationResult.AccessToken,
      idToken: authResult.AuthenticationResult.IdToken,
      refreshToken: authResult.AuthenticationResult.RefreshToken,
      expiresIn: authResult.AuthenticationResult.ExpiresIn,
      userType,
      userId: user.candidateId || user.clientId,
    });
  } catch (error: unknown) {
    const err = error as { name?: string; message?: string };
    if (err.name === 'NotAuthorizedException') {
      return response(401, { error: 'Invalid credentials' });
    }
    if (err.name === 'UserNotConfirmedException') {
      return response(403, { error: 'Email not verified' });
    }
    console.error('Login error:', error);
    return response(500, { error: 'Login failed' });
  }
}

async function handleVerifyEmail(body: unknown): Promise<APIGatewayProxyResultV2> {
  const parsed = VerifyEmailSchema.safeParse(body);
  if (!parsed.success) {
    return response(400, { error: 'Invalid input', details: parsed.error.errors });
  }

  const { email, code } = parsed.data;

  try {
    await cognitoClient.send(new ConfirmSignUpCommand({
      ClientId: USER_POOL_CLIENT_ID,
      Username: email,
      ConfirmationCode: code,
    }));

    return response(200, { message: 'Email verified successfully' });
  } catch (error: unknown) {
    const err = error as { name?: string; message?: string };
    if (err.name === 'CodeMismatchException') {
      return response(400, { error: 'Invalid verification code' });
    }
    if (err.name === 'ExpiredCodeException') {
      return response(400, { error: 'Verification code expired' });
    }
    console.error('Verification error:', error);
    return response(500, { error: 'Verification failed' });
  }
}

async function handleHealth(): Promise<APIGatewayProxyResultV2> {
  return response(200, {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'medibee-api',
  });
}

// ============================================
// Main Handler
// ============================================
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const path = event.rawPath;
  const method = event.requestContext.http.method;

  console.log(`${method} ${path}`);

  try {
    // Health check
    if (path === '/health' && method === 'GET') {
      return handleHealth();
    }

    // Parse body
    const body = event.body ? JSON.parse(event.body) : {};

    // Route handling
    if (path === '/auth/register/candidate' && method === 'POST') {
      return handleRegisterCandidate(body);
    }

    if (path === '/auth/register/client' && method === 'POST') {
      return handleRegisterClient(body);
    }

    if (path === '/auth/login/candidate' && method === 'POST') {
      return handleLogin(body, 'candidate');
    }

    if (path === '/auth/login/client' && method === 'POST') {
      return handleLogin(body, 'client');
    }

    if (path === '/auth/verify-email' && method === 'POST') {
      return handleVerifyEmail(body);
    }

    return response(404, { error: 'Not found' });
  } catch (error) {
    console.error('Handler error:', error);
    return response(500, { error: 'Internal server error' });
  }
}

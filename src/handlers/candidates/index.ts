import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';

// ============================================
// Clients
// ============================================
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const TABLE_NAME = process.env.TABLE_NAME!;
const CREDENTIALS_BUCKET = process.env.CREDENTIALS_BUCKET!;
const TENANT_ID = process.env.TENANT_ID || 'TENANT#MEDIBEE';

// ============================================
// Types
// ============================================
const CareSettingType = z.enum([
  'mental-health',
  'acute-care',
  'private-hospital',
  'care-home',
  'nursing-home',
  'supported-living',
  'domiciliary',
  'end-of-life',
  'learning-disabilities',
  'dementia-care',
  'paediatric',
  'community',
  'other',
]);

const ExperienceLevel = z.enum([
  'newly-qualified',
  '1-2-years',
  '3-5-years',
  '5-plus-years',
]);

const AvailabilityStatus = z.enum(['available', 'employed', 'passive']);

// ============================================
// Schemas
// ============================================
const UpdateProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional(),
  location: z.object({
    city: z.string(),
    region: z.string(),
    postcode: z.string().optional(),
  }).optional(),
  professionalSummary: z.string().max(500).optional(),
  careSettings: z.array(CareSettingType).optional(),
  experienceLevel: ExperienceLevel.optional(),
  availability: AvailabilityStatus.optional(),
});

const ExperienceEntrySchema = z.object({
  employer: z.string().min(1),
  role: z.string().min(1),
  careSetting: CareSettingType,
  startDate: z.string(),
  endDate: z.string().optional(),
  description: z.string().max(500).optional(),
});

const CredentialUploadSchema = z.object({
  type: z.enum(['dbs', 'rtw', 'training', 'immunisation']),
  fileName: z.string(),
  contentType: z.string(),
});

// ============================================
// Helpers
// ============================================
function response(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}${timestamp}${random}`.toUpperCase();
}

function extractCandidateId(path: string): string | null {
  const match = path.match(/\/candidates\/([^/]+)/);
  return match ? match[1] : null;
}

function calculateProfileCompletion(candidate: Record<string, unknown>): number {
  let score = 0;
  const weights: Record<string, number> = {
    firstName: 5,
    lastName: 5,
    email: 5,
    phone: 5,
    location: 10,
    professionalSummary: 15,
    careSettings: 15,
    experienceLevel: 10,
    experience: 15,
    photoUrl: 10,
    availability: 5,
  };

  for (const [field, weight] of Object.entries(weights)) {
    const value = candidate[field];
    if (value !== null && value !== undefined) {
      if (Array.isArray(value) && value.length > 0) {
        score += weight;
      } else if (typeof value === 'object' && Object.keys(value).length > 0) {
        score += weight;
      } else if (typeof value === 'string' && value.length > 0) {
        score += weight;
      }
    }
  }

  return Math.min(100, score);
}

// ============================================
// Route Handlers
// ============================================
async function handleGetProfile(candidateId: string): Promise<APIGatewayProxyResultV2> {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: TENANT_ID,
      SK: candidateId,
    },
  }));

  if (!result.Item) {
    return response(404, { error: 'Candidate not found' });
  }

  const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...profile } = result.Item;
  return response(200, profile);
}

async function handleUpdateProfile(candidateId: string, body: unknown): Promise<APIGatewayProxyResultV2> {
  const parsed = UpdateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return response(400, { error: 'Invalid input', details: parsed.error.errors });
  }

  const updates = parsed.data;
  const updateExpressions: string[] = [];
  const expressionNames: Record<string, string> = {};
  const expressionValues: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      updateExpressions.push(`#${key} = :${key}`);
      expressionNames[`#${key}`] = key;
      expressionValues[`:${key}`] = value;
    }
  }

  updateExpressions.push('#updatedAt = :updatedAt');
  expressionNames['#updatedAt'] = 'updatedAt';
  expressionValues[':updatedAt'] = new Date().toISOString();

  try {
    const result = await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: TENANT_ID,
        SK: candidateId,
      },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
      ReturnValues: 'ALL_NEW',
    }));

    // Recalculate profile completion
    if (result.Attributes) {
      const completion = calculateProfileCompletion(result.Attributes);
      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: TENANT_ID, SK: candidateId },
        UpdateExpression: 'SET profileCompletion = :completion',
        ExpressionAttributeValues: { ':completion': completion },
      }));
    }

    return response(200, { message: 'Profile updated', profile: result.Attributes });
  } catch (error) {
    console.error('Update error:', error);
    return response(500, { error: 'Update failed' });
  }
}

async function handleAddExperience(candidateId: string, body: unknown): Promise<APIGatewayProxyResultV2> {
  const parsed = ExperienceEntrySchema.safeParse(body);
  if (!parsed.success) {
    return response(400, { error: 'Invalid input', details: parsed.error.errors });
  }

  const experienceId = generateId('EXP-');
  const entry = { id: experienceId, ...parsed.data };

  try {
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: TENANT_ID, SK: candidateId },
      UpdateExpression: 'SET experience = list_append(if_not_exists(experience, :empty), :entry), updatedAt = :now',
      ExpressionAttributeValues: {
        ':entry': [entry],
        ':empty': [],
        ':now': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    }));

    return response(201, { message: 'Experience added', experienceId, experience: entry });
  } catch (error) {
    console.error('Add experience error:', error);
    return response(500, { error: 'Failed to add experience' });
  }
}

async function handleGetCredentialUploadUrl(candidateId: string, body: unknown): Promise<APIGatewayProxyResultV2> {
  const parsed = CredentialUploadSchema.safeParse(body);
  if (!parsed.success) {
    return response(400, { error: 'Invalid input', details: parsed.error.errors });
  }

  const { type, fileName, contentType } = parsed.data;
  const credentialId = generateId('CRED-');
  const key = `candidates/${candidateId}/${type}/${credentialId}-${fileName}`;

  try {
    const command = new PutObjectCommand({
      Bucket: CREDENTIALS_BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

    // Create credential record
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: TENANT_ID,
        SK: `${candidateId}#CRED#${credentialId}`,
        GSI1PK: `${TENANT_ID}#CREDENTIALS#PENDING`,
        GSI1SK: credentialId,
        entityType: 'CREDENTIAL',
        credentialId,
        candidateId,
        type,
        fileName,
        s3Key: key,
        status: 'uploaded',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }));

    return response(200, { uploadUrl, credentialId, expiresIn: 300 });
  } catch (error) {
    console.error('Upload URL error:', error);
    return response(500, { error: 'Failed to generate upload URL' });
  }
}

async function handleGetCredentials(candidateId: string): Promise<APIGatewayProxyResultV2> {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': TENANT_ID,
      ':sk': `${candidateId}#CRED#`,
    },
  }));

  const credentials = result.Items?.map(item => {
    const { PK, SK, GSI1PK, GSI1SK, ...credential } = item;
    return credential;
  }) || [];

  return response(200, { credentials });
}

async function handleListCandidates(queryParams: Record<string, string | undefined>): Promise<APIGatewayProxyResultV2> {
  const limit = parseInt(queryParams.limit || '20', 10);

  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `${TENANT_ID}#CANDIDATES`,
    },
    Limit: limit,
  }));

  const candidates = result.Items?.map(item => {
    const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...candidate } = item;
    return candidate;
  }) || [];

  return response(200, { candidates, count: candidates.length });
}

// ============================================
// Main Handler
// ============================================
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const path = event.rawPath;
  const method = event.requestContext.http.method;
  const candidateId = extractCandidateId(path);

  console.log(`${method} ${path}`);

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const queryParams = event.queryStringParameters || {};

    // List candidates
    if (path === '/candidates' && method === 'GET') {
      return handleListCandidates(queryParams);
    }

    // Candidate-specific routes
    if (candidateId) {
      // Get profile
      if (path === `/candidates/${candidateId}` && method === 'GET') {
        return handleGetProfile(candidateId);
      }

      // Update profile
      if (path === `/candidates/${candidateId}` && method === 'PUT') {
        return handleUpdateProfile(candidateId, body);
      }

      // Experience
      if (path === `/candidates/${candidateId}/experience` && method === 'POST') {
        return handleAddExperience(candidateId, body);
      }

      // Credentials
      if (path === `/candidates/${candidateId}/credentials` && method === 'GET') {
        return handleGetCredentials(candidateId);
      }

      if (path === `/candidates/${candidateId}/credentials/upload` && method === 'POST') {
        return handleGetCredentialUploadUrl(candidateId, body);
      }
    }

    return response(404, { error: 'Not found' });
  } catch (error) {
    console.error('Handler error:', error);
    return response(500, { error: 'Internal server error' });
  }
}

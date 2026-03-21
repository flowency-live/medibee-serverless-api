import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';

// ============================================
// Clients
// ============================================
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME!;
const TENANT_ID = process.env.TENANT_ID || 'TENANT#MEDIBEE';

// ============================================
// Schemas
// ============================================
const UpdateOrganisationSchema = z.object({
  organisationName: z.string().min(1).optional(),
  contactName: z.string().min(1).optional(),
  phone: z.string().optional(),
  description: z.string().max(1000).optional(),
  locations: z.array(z.string()).optional(),
  benefits: z.array(z.string()).optional(),
  logoUrl: z.string().url().optional(),
});

const CreateShortlistSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

const IntroductionRequestSchema = z.object({
  candidateId: z.string().min(1),
  roleType: z.string().min(1),
  careSetting: z.string().min(1),
  shiftPattern: z.string().min(1),
  message: z.string().max(1000).optional(),
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

function extractClientId(path: string): string | null {
  const match = path.match(/\/clients\/([^/]+)/);
  return match ? match[1] : null;
}

// ============================================
// Route Handlers
// ============================================
async function handleGetOrganisation(clientId: string): Promise<APIGatewayProxyResultV2> {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: TENANT_ID, SK: clientId },
  }));

  if (!result.Item) {
    return response(404, { error: 'Organisation not found' });
  }

  const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...organisation } = result.Item;
  return response(200, organisation);
}

async function handleUpdateOrganisation(clientId: string, body: unknown): Promise<APIGatewayProxyResultV2> {
  const parsed = UpdateOrganisationSchema.safeParse(body);
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
      Key: { PK: TENANT_ID, SK: clientId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
      ReturnValues: 'ALL_NEW',
    }));

    return response(200, { message: 'Organisation updated', organisation: result.Attributes });
  } catch (error) {
    console.error('Update error:', error);
    return response(500, { error: 'Update failed' });
  }
}

async function handleBrowseCandidates(queryParams: Record<string, string | undefined>): Promise<APIGatewayProxyResultV2> {
  const limit = parseInt(queryParams.limit || '20', 10);
  const careSetting = queryParams.careSetting;
  const availability = queryParams.availability || 'available';

  let filterExpression = 'availability = :availability AND #status = :status';
  const expressionValues: Record<string, unknown> = {
    ':pk': `${TENANT_ID}#CANDIDATES`,
    ':availability': availability,
    ':status': 'active',
  };
  const expressionNames: Record<string, string> = {
    '#status': 'status',
  };

  if (careSetting) {
    filterExpression += ' AND contains(careSettings, :careSetting)';
    expressionValues[':careSetting'] = careSetting;
  }

  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    FilterExpression: filterExpression,
    ExpressionAttributeNames: expressionNames,
    ExpressionAttributeValues: expressionValues,
    Limit: limit,
  }));

  const candidates = result.Items?.map(item => {
    const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...candidate } = item;
    return {
      candidateId: candidate.candidateId,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      location: candidate.location,
      careSettings: candidate.careSettings,
      experienceLevel: candidate.experienceLevel,
      availability: candidate.availability,
      profileCompletion: candidate.profileCompletion,
      photoUrl: candidate.photoUrl,
    };
  }) || [];

  return response(200, { candidates, count: candidates.length });
}

async function handleCreateShortlist(clientId: string, body: unknown): Promise<APIGatewayProxyResultV2> {
  const parsed = CreateShortlistSchema.safeParse(body);
  if (!parsed.success) {
    return response(400, { error: 'Invalid input', details: parsed.error.errors });
  }

  const shortlistId = generateId('SLIST-');
  const { name, description } = parsed.data;

  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: TENANT_ID,
      SK: `${clientId}#SHORTLIST#${shortlistId}`,
      GSI1PK: `${TENANT_ID}#SHORTLISTS#${clientId}`,
      GSI1SK: shortlistId,
      entityType: 'SHORTLIST',
      shortlistId,
      clientId,
      name,
      description: description || null,
      candidateIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  }));

  return response(201, { message: 'Shortlist created', shortlistId, name });
}

async function handleGetShortlists(clientId: string): Promise<APIGatewayProxyResultV2> {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `${TENANT_ID}#SHORTLISTS#${clientId}`,
    },
  }));

  const shortlists = result.Items?.map(item => ({
    shortlistId: item.shortlistId,
    name: item.name,
    description: item.description,
    candidateCount: item.candidateIds?.length || 0,
    createdAt: item.createdAt,
  })) || [];

  return response(200, { shortlists });
}

async function handleAddToShortlist(clientId: string, shortlistId: string, body: { candidateId: string }): Promise<APIGatewayProxyResultV2> {
  const { candidateId } = body;
  if (!candidateId) {
    return response(400, { error: 'candidateId required' });
  }

  try {
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: TENANT_ID, SK: `${clientId}#SHORTLIST#${shortlistId}` },
      UpdateExpression: 'SET candidateIds = list_append(if_not_exists(candidateIds, :empty), :candidate), updatedAt = :now',
      ExpressionAttributeValues: {
        ':candidate': [candidateId],
        ':empty': [],
        ':now': new Date().toISOString(),
      },
      ConditionExpression: 'attribute_exists(SK)',
    }));

    return response(200, { message: 'Candidate added to shortlist' });
  } catch (error) {
    console.error('Add to shortlist error:', error);
    return response(500, { error: 'Failed to add to shortlist' });
  }
}

async function handleRequestIntroduction(clientId: string, body: unknown): Promise<APIGatewayProxyResultV2> {
  const parsed = IntroductionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return response(400, { error: 'Invalid input', details: parsed.error.errors });
  }

  // Check credits
  const clientResult = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: TENANT_ID, SK: clientId },
  }));

  if (!clientResult.Item) {
    return response(404, { error: 'Client not found' });
  }

  const credits = clientResult.Item.introductionCredits || 0;
  if (credits <= 0 && clientResult.Item.subscriptionTier !== 'enterprise') {
    return response(403, { error: 'No introduction credits remaining' });
  }

  const introductionId = generateId('INTRO-');
  const { candidateId, roleType, careSetting, shiftPattern, message } = parsed.data;

  // Create introduction request
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: TENANT_ID,
      SK: `INTRO#${introductionId}`,
      GSI1PK: `${TENANT_ID}#INTRODUCTIONS#PENDING`,
      GSI1SK: introductionId,
      entityType: 'INTRODUCTION',
      introductionId,
      clientId,
      candidateId,
      roleType,
      careSetting,
      shiftPattern,
      message: message || null,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  }));

  // Deduct credit
  if (clientResult.Item.subscriptionTier !== 'enterprise') {
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: TENANT_ID, SK: clientId },
      UpdateExpression: 'SET introductionCredits = introductionCredits - :one',
      ExpressionAttributeValues: { ':one': 1 },
    }));
  }

  return response(201, { message: 'Introduction requested', introductionId });
}

async function handleGetIntroductions(clientId: string): Promise<APIGatewayProxyResultV2> {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `${TENANT_ID}#INTRODUCTIONS#${clientId}`,
    },
  }));

  const introductions = result.Items?.map(item => ({
    introductionId: item.introductionId,
    candidateId: item.candidateId,
    status: item.status,
    roleType: item.roleType,
    createdAt: item.createdAt,
  })) || [];

  return response(200, { introductions });
}

// ============================================
// Main Handler
// ============================================
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const path = event.rawPath;
  const method = event.requestContext.http.method;
  const clientId = extractClientId(path);

  console.log(`${method} ${path}`);

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const queryParams = event.queryStringParameters || {};

    // Browse candidates (for providers)
    if (path === '/clients/candidates' && method === 'GET') {
      return handleBrowseCandidates(queryParams);
    }

    // Client-specific routes
    if (clientId) {
      // Get organisation
      if (path === `/clients/${clientId}` && method === 'GET') {
        return handleGetOrganisation(clientId);
      }

      // Update organisation
      if (path === `/clients/${clientId}` && method === 'PUT') {
        return handleUpdateOrganisation(clientId, body);
      }

      // Shortlists
      if (path === `/clients/${clientId}/shortlists` && method === 'GET') {
        return handleGetShortlists(clientId);
      }

      if (path === `/clients/${clientId}/shortlists` && method === 'POST') {
        return handleCreateShortlist(clientId, body);
      }

      // Add to shortlist
      const shortlistMatch = path.match(/\/clients\/[^/]+\/shortlists\/([^/]+)\/candidates/);
      if (shortlistMatch && method === 'POST') {
        return handleAddToShortlist(clientId, shortlistMatch[1], body);
      }

      // Introductions
      if (path === `/clients/${clientId}/introductions` && method === 'GET') {
        return handleGetIntroductions(clientId);
      }

      if (path === `/clients/${clientId}/introductions` && method === 'POST') {
        return handleRequestIntroduction(clientId, body);
      }
    }

    return response(404, { error: 'Not found' });
  } catch (error) {
    console.error('Handler error:', error);
    return response(500, { error: 'Internal server error' });
  }
}

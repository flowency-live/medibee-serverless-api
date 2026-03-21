import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
// Helpers
// ============================================
function response(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ============================================
// Route Handlers
// ============================================
async function handleGetAnalytics(): Promise<APIGatewayProxyResultV2> {
  // Get candidate count
  const candidatesResult = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `${TENANT_ID}#CANDIDATES` },
    Select: 'COUNT',
  }));

  // Get client count
  const clientsResult = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `${TENANT_ID}#CLIENTS` },
    Select: 'COUNT',
  }));

  // Get pending introductions
  const introductionsResult = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `${TENANT_ID}#INTRODUCTIONS#PENDING` },
    Select: 'COUNT',
  }));

  // Get pending credentials
  const credentialsResult = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `${TENANT_ID}#CREDENTIALS#PENDING` },
    Select: 'COUNT',
  }));

  return response(200, {
    totalCandidates: candidatesResult.Count || 0,
    totalClients: clientsResult.Count || 0,
    pendingIntroductions: introductionsResult.Count || 0,
    pendingCredentials: credentialsResult.Count || 0,
    timestamp: new Date().toISOString(),
  });
}

async function handleGetPendingClients(): Promise<APIGatewayProxyResultV2> {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    FilterExpression: '#status = :status',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':pk': `${TENANT_ID}#CLIENTS`,
      ':status': 'pending_approval',
    },
  }));

  const clients = result.Items?.map(item => ({
    clientId: item.clientId,
    organisationName: item.organisationName,
    contactName: item.contactName,
    email: item.email,
    organisationType: item.organisationType,
    createdAt: item.createdAt,
  })) || [];

  return response(200, { clients, count: clients.length });
}

async function handleApproveClient(clientId: string): Promise<APIGatewayProxyResultV2> {
  try {
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: TENANT_ID, SK: clientId },
      UpdateExpression: 'SET #status = :status, approvedAt = :now, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'active',
        ':now': new Date().toISOString(),
      },
      ConditionExpression: 'attribute_exists(SK)',
    }));

    return response(200, { message: 'Client approved', clientId });
  } catch (error) {
    console.error('Approve client error:', error);
    return response(500, { error: 'Failed to approve client' });
  }
}

async function handleRejectClient(clientId: string, body: { reason?: string }): Promise<APIGatewayProxyResultV2> {
  try {
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: TENANT_ID, SK: clientId },
      UpdateExpression: 'SET #status = :status, rejectionReason = :reason, rejectedAt = :now, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'rejected',
        ':reason': body.reason || null,
        ':now': new Date().toISOString(),
      },
      ConditionExpression: 'attribute_exists(SK)',
    }));

    return response(200, { message: 'Client rejected', clientId });
  } catch (error) {
    console.error('Reject client error:', error);
    return response(500, { error: 'Failed to reject client' });
  }
}

async function handleGetPendingCredentials(): Promise<APIGatewayProxyResultV2> {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `${TENANT_ID}#CREDENTIALS#PENDING`,
    },
  }));

  const credentials = result.Items?.map(item => ({
    credentialId: item.credentialId,
    candidateId: item.candidateId,
    type: item.type,
    fileName: item.fileName,
    status: item.status,
    createdAt: item.createdAt,
  })) || [];

  return response(200, { credentials, count: credentials.length });
}

async function handleGetCredentialDocument(credentialId: string): Promise<APIGatewayProxyResultV2> {
  // Find the credential
  const result = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'credentialId = :credId',
    ExpressionAttributeValues: { ':credId': credentialId },
  }));

  const credential = result.Items?.[0];
  if (!credential) {
    return response(404, { error: 'Credential not found' });
  }

  // Generate signed URL for viewing
  const command = new GetObjectCommand({
    Bucket: CREDENTIALS_BUCKET,
    Key: credential.s3Key,
  });

  const viewUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

  return response(200, { viewUrl, credential });
}

async function handleVerifyCredential(credentialId: string, body: { status: string; notes?: string }): Promise<APIGatewayProxyResultV2> {
  const { status, notes } = body;
  if (!['verified', 'rejected'].includes(status)) {
    return response(400, { error: 'Status must be verified or rejected' });
  }

  // Find the credential
  const scanResult = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'credentialId = :credId',
    ExpressionAttributeValues: { ':credId': credentialId },
  }));

  const credential = scanResult.Items?.[0];
  if (!credential) {
    return response(404, { error: 'Credential not found' });
  }

  // Update credential status
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { PK: credential.PK, SK: credential.SK },
    UpdateExpression: 'SET #status = :status, verificationNotes = :notes, verifiedAt = :now, GSI1PK = :gsi1pk, updatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': status,
      ':notes': notes || null,
      ':now': new Date().toISOString(),
      ':gsi1pk': `${TENANT_ID}#CREDENTIALS#${status.toUpperCase()}`,
    },
  }));

  return response(200, { message: `Credential ${status}`, credentialId });
}

async function handleGetPendingIntroductions(): Promise<APIGatewayProxyResultV2> {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `${TENANT_ID}#INTRODUCTIONS#PENDING`,
    },
  }));

  // Enrich with candidate and client info
  const introductions = await Promise.all(result.Items?.map(async item => {
    const [candidateResult, clientResult] = await Promise.all([
      docClient.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: TENANT_ID, SK: item.candidateId },
      })),
      docClient.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: TENANT_ID, SK: item.clientId },
      })),
    ]);

    return {
      introductionId: item.introductionId,
      status: item.status,
      roleType: item.roleType,
      careSetting: item.careSetting,
      shiftPattern: item.shiftPattern,
      message: item.message,
      createdAt: item.createdAt,
      candidate: candidateResult.Item ? {
        candidateId: candidateResult.Item.candidateId,
        firstName: candidateResult.Item.firstName,
        lastName: candidateResult.Item.lastName,
        email: candidateResult.Item.email,
        phone: candidateResult.Item.phone,
      } : null,
      client: clientResult.Item ? {
        clientId: clientResult.Item.clientId,
        organisationName: clientResult.Item.organisationName,
        contactName: clientResult.Item.contactName,
        email: clientResult.Item.email,
        phone: clientResult.Item.phone,
      } : null,
    };
  }) || []);

  return response(200, { introductions, count: introductions.length });
}

async function handleUpdateIntroductionStatus(introductionId: string, body: { status: string; notes?: string }): Promise<APIGatewayProxyResultV2> {
  const { status, notes } = body;
  const validStatuses = ['pending', 'accepted', 'declined', 'facilitating', 'facilitated', 'completed'];

  if (!validStatuses.includes(status)) {
    return response(400, { error: `Status must be one of: ${validStatuses.join(', ')}` });
  }

  try {
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: TENANT_ID, SK: `INTRO#${introductionId}` },
      UpdateExpression: 'SET #status = :status, facilitationNotes = :notes, GSI1PK = :gsi1pk, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': status,
        ':notes': notes || null,
        ':gsi1pk': `${TENANT_ID}#INTRODUCTIONS#${status.toUpperCase()}`,
        ':now': new Date().toISOString(),
      },
      ConditionExpression: 'attribute_exists(SK)',
    }));

    return response(200, { message: `Introduction status updated to ${status}`, introductionId });
  } catch (error) {
    console.error('Update introduction error:', error);
    return response(500, { error: 'Failed to update introduction' });
  }
}

// ============================================
// Main Handler
// ============================================
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const path = event.rawPath;
  const method = event.requestContext.http.method;

  console.log(`${method} ${path}`);

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    // Analytics
    if (path === '/admin/analytics' && method === 'GET') {
      return handleGetAnalytics();
    }

    // Clients
    if (path === '/admin/clients/pending' && method === 'GET') {
      return handleGetPendingClients();
    }

    const clientApproveMatch = path.match(/\/admin\/clients\/([^/]+)\/approve/);
    if (clientApproveMatch && method === 'POST') {
      return handleApproveClient(clientApproveMatch[1]);
    }

    const clientRejectMatch = path.match(/\/admin\/clients\/([^/]+)\/reject/);
    if (clientRejectMatch && method === 'POST') {
      return handleRejectClient(clientRejectMatch[1], body);
    }

    // Credentials
    if (path === '/admin/credentials/pending' && method === 'GET') {
      return handleGetPendingCredentials();
    }

    const credentialViewMatch = path.match(/\/admin\/credentials\/([^/]+)\/document/);
    if (credentialViewMatch && method === 'GET') {
      return handleGetCredentialDocument(credentialViewMatch[1]);
    }

    const credentialVerifyMatch = path.match(/\/admin\/credentials\/([^/]+)\/verify/);
    if (credentialVerifyMatch && method === 'POST') {
      return handleVerifyCredential(credentialVerifyMatch[1], body);
    }

    // Introductions
    if (path === '/admin/introductions/pending' && method === 'GET') {
      return handleGetPendingIntroductions();
    }

    const introductionStatusMatch = path.match(/\/admin\/introductions\/([^/]+)\/status/);
    if (introductionStatusMatch && method === 'POST') {
      return handleUpdateIntroductionStatus(introductionStatusMatch[1], body);
    }

    return response(404, { error: 'Not found' });
  } catch (error) {
    console.error('Handler error:', error);
    return response(500, { error: 'Internal server error' });
  }
}

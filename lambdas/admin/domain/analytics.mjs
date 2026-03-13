/**
 * Admin Analytics Domain Logic
 *
 * Provides dashboard metrics and export functionality.
 * All operations require admin authentication.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { CandidateStatus, ClientStatus, ContactStatus } from '../validation.mjs';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;

// Subscription tier prices for MRR calculation
const TIER_PRICES = {
  bronze: 99,
  silver: 249,
  gold: 499,
};

/**
 * Get dashboard analytics metrics
 *
 * @param {Object} query - { startDate, endDate }
 * @param {Object} logger - Logger instance
 */
export async function getAnalytics(query, logger) {
  const { startDate, endDate } = query;

  logger.info('Getting analytics', { startDate, endDate });

  // Run all metric queries in parallel for performance
  const [
    candidateMetrics,
    clientMetrics,
    subscriptionMetrics,
    contactMetrics,
    recentMetrics,
  ] = await Promise.all([
    getCandidateMetrics(logger),
    getClientMetrics(logger),
    getSubscriptionMetrics(logger),
    getContactMetrics(logger),
    getRecentMetrics(logger),
  ]);

  const metrics = {
    candidates: candidateMetrics,
    clients: clientMetrics,
    subscriptions: subscriptionMetrics,
    contacts: contactMetrics,
    recent: recentMetrics,
  };

  logger.info('Analytics retrieved');

  return {
    success: true,
    metrics,
    dateRange: startDate && endDate ? { startDate, endDate } : null,
    generatedAt: new Date().toISOString(),
    status: 200,
  };
}

/**
 * Get candidate status metrics
 */
async function getCandidateMetrics(logger) {
  const statusCounts = {
    total: 0,
    active: 0,
    pendingReview: 0,
    pendingVerification: 0,
    suspended: 0,
    rejected: 0,
  };

  // Query each status using GSI2
  const statuses = [
    { key: CandidateStatus.ACTIVE, field: 'active' },
    { key: CandidateStatus.PENDING_REVIEW, field: 'pendingReview' },
    { key: CandidateStatus.PENDING_VERIFICATION, field: 'pendingVerification' },
    { key: CandidateStatus.SUSPENDED, field: 'suspended' },
    { key: CandidateStatus.REJECTED, field: 'rejected' },
  ];

  for (const { key, field } of statuses) {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      FilterExpression: 'begins_with(PK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `STATUS#${key}`,
        ':prefix': 'CANDIDATE#',
      },
      Select: 'COUNT',
    }));

    statusCounts[field] = result.Count || 0;
    statusCounts.total += result.Count || 0;
  }

  return statusCounts;
}

/**
 * Get client status metrics
 */
async function getClientMetrics(logger) {
  const statusCounts = {
    total: 0,
    active: 0,
    pendingVerification: 0,
    suspended: 0,
    withSubscription: 0,
  };

  // Query each status
  const statuses = [
    { key: ClientStatus.ACTIVE, field: 'active' },
    { key: ClientStatus.PENDING_VERIFICATION, field: 'pendingVerification' },
    { key: ClientStatus.SUSPENDED, field: 'suspended' },
  ];

  for (const { key, field } of statuses) {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      FilterExpression: 'begins_with(PK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `STATUS#${key}`,
        ':prefix': 'CLIENT#',
      },
      Select: 'COUNT',
    }));

    statusCounts[field] = result.Count || 0;
    statusCounts.total += result.Count || 0;
  }

  // Count clients with active subscriptions
  // This is a scan operation - consider caching in production
  const subscriptionResult = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'SK = :sk AND #status = :active',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':sk': 'SUBSCRIPTION',
      ':active': 'active',
    },
    Select: 'COUNT',
  }));

  statusCounts.withSubscription = subscriptionResult.Count || 0;

  return statusCounts;
}

/**
 * Get subscription tier metrics and MRR
 */
async function getSubscriptionMetrics(logger) {
  const metrics = {
    bronze: 0,
    silver: 0,
    gold: 0,
    mrr: 0,
    total: 0,
  };

  // Scan for active subscriptions
  const result = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'SK = :sk AND #status = :active',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':sk': 'SUBSCRIPTION',
      ':active': 'active',
    },
    ProjectionExpression: 'tier',
  }));

  for (const item of result.Items || []) {
    const tier = item.tier?.toLowerCase();
    if (tier && metrics.hasOwnProperty(tier)) {
      metrics[tier]++;
      metrics.mrr += TIER_PRICES[tier] || 0;
    }
    metrics.total++;
  }

  return metrics;
}

/**
 * Get contact request metrics
 */
async function getContactMetrics(logger) {
  const statusCounts = {
    total: 0,
    pending: 0,
    contacted: 0,
    hired: 0,
    declined: 0,
    expired: 0,
  };

  // Query each status
  const statuses = [
    { key: ContactStatus.PENDING, field: 'pending' },
    { key: ContactStatus.CONTACTED, field: 'contacted' },
    { key: ContactStatus.HIRED, field: 'hired' },
    { key: ContactStatus.DECLINED, field: 'declined' },
    { key: ContactStatus.EXPIRED, field: 'expired' },
  ];

  for (const { key, field } of statuses) {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      FilterExpression: 'begins_with(PK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `STATUS#${key}`,
        ':prefix': 'CONTACT#',
      },
      Select: 'COUNT',
    }));

    statusCounts[field] = result.Count || 0;
    statusCounts.total += result.Count || 0;
  }

  return statusCounts;
}

/**
 * Get recent activity metrics (last 7 and 30 days)
 */
async function getRecentMetrics(logger) {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Count recent candidate registrations (scan with date filter)
  const recentCandidates = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND createdAt >= :since',
    ExpressionAttributeValues: {
      ':prefix': 'CANDIDATE#',
      ':sk': 'PROFILE',
      ':since': sevenDaysAgo,
    },
    Select: 'COUNT',
  }));

  // Count recent contact requests
  const recentContacts = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND createdAt >= :since',
    ExpressionAttributeValues: {
      ':prefix': 'CONTACT#',
      ':sk': 'META',
      ':since': sevenDaysAgo,
    },
    Select: 'COUNT',
  }));

  // Count new clients in last 30 days
  const recentClients = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND createdAt >= :since',
    ExpressionAttributeValues: {
      ':prefix': 'CLIENT#',
      ':sk': 'PROFILE',
      ':since': thirtyDaysAgo,
    },
    Select: 'COUNT',
  }));

  return {
    registrationsLast7Days: recentCandidates.Count || 0,
    contactsLast7Days: recentContacts.Count || 0,
    newClientsLast30Days: recentClients.Count || 0,
  };
}

/**
 * Export analytics data
 *
 * @param {Object} query - { format, entity, startDate, endDate }
 * @param {Object} logger - Logger instance
 */
export async function exportAnalytics(query, logger) {
  const { format, entity, startDate, endDate } = query;

  logger.info('Exporting analytics', { format, entity });

  let data;

  switch (entity) {
    case 'candidates':
      data = await exportCandidates(startDate, endDate);
      break;
    case 'clients':
      data = await exportClients(startDate, endDate);
      break;
    case 'contacts':
      data = await exportContacts(startDate, endDate);
      break;
    case 'subscriptions':
      data = await exportSubscriptions();
      break;
    default:
      // Export all metrics summary
      data = await getAnalytics({}, logger);
      data = data.metrics;
      break;
  }

  if (format === 'csv') {
    const csvData = convertToCSV(data, entity);
    return {
      success: true,
      format: 'csv',
      contentType: 'text/csv',
      data: csvData,
      entity,
      status: 200,
    };
  }

  return {
    success: true,
    format: 'json',
    data,
    entity,
    status: 200,
  };
}

/**
 * Export candidate data
 */
async function exportCandidates(startDate, endDate) {
  let filterExpression = 'begins_with(PK, :prefix) AND SK = :sk';
  const expressionAttributeValues = {
    ':prefix': 'CANDIDATE#',
    ':sk': 'PROFILE',
  };

  if (startDate && endDate) {
    filterExpression += ' AND createdAt BETWEEN :start AND :end';
    expressionAttributeValues[':start'] = startDate;
    expressionAttributeValues[':end'] = endDate + 'T23:59:59.999Z';
  }

  const result = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: filterExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ProjectionExpression: 'candidateId, firstName, lastName, email, #status, experienceLevel, city, createdAt',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
  }));

  return result.Items || [];
}

/**
 * Export client data
 */
async function exportClients(startDate, endDate) {
  let filterExpression = 'begins_with(PK, :prefix) AND SK = :sk';
  const expressionAttributeValues = {
    ':prefix': 'CLIENT#',
    ':sk': 'PROFILE',
  };

  if (startDate && endDate) {
    filterExpression += ' AND createdAt BETWEEN :start AND :end';
    expressionAttributeValues[':start'] = startDate;
    expressionAttributeValues[':end'] = endDate + 'T23:59:59.999Z';
  }

  const result = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: filterExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ProjectionExpression: 'clientId, organisationName, organisationType, contactEmail, #status, createdAt',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
  }));

  return result.Items || [];
}

/**
 * Export contact request data
 */
async function exportContacts(startDate, endDate) {
  let filterExpression = 'begins_with(PK, :prefix) AND SK = :sk';
  const expressionAttributeValues = {
    ':prefix': 'CONTACT#',
    ':sk': 'META',
  };

  if (startDate && endDate) {
    filterExpression += ' AND createdAt BETWEEN :start AND :end';
    expressionAttributeValues[':start'] = startDate;
    expressionAttributeValues[':end'] = endDate + 'T23:59:59.999Z';
  }

  const result = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: filterExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ProjectionExpression: 'contactId, clientId, candidateId, #status, createdAt, updatedAt',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
  }));

  return result.Items || [];
}

/**
 * Export subscription data
 */
async function exportSubscriptions() {
  const result = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'SK = :sk',
    ExpressionAttributeValues: {
      ':sk': 'SUBSCRIPTION',
    },
    ProjectionExpression: 'PK, tier, #status, creditsRemaining, currentPeriodStart, currentPeriodEnd, createdAt',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
  }));

  // Add clientId from PK
  return (result.Items || []).map((item) => ({
    ...item,
    clientId: item.PK.replace('CLIENT#', ''),
  }));
}

/**
 * Convert data array to CSV string
 */
function convertToCSV(data, entity) {
  if (!Array.isArray(data) || data.length === 0) {
    return '';
  }

  // Get headers from first item
  const headers = Object.keys(data[0]);

  // Build CSV rows
  const rows = [headers.join(',')];

  for (const item of data) {
    const values = headers.map((header) => {
      const value = item[header];
      if (value === null || value === undefined) {
        return '';
      }
      // Escape quotes and wrap in quotes if contains comma
      const stringValue = String(value);
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    });
    rows.push(values.join(','));
  }

  return rows.join('\n');
}

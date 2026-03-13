/**
 * Admin Candidate Management Domain Logic
 *
 * Handles listing, viewing, and moderating candidates.
 * All operations require admin authentication.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
  CandidateStatus,
  isValidCandidateTransition,
} from '../validation.mjs';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sesClient = new SESClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@medibee-recruitment.co.uk';

/**
 * List all candidates with optional filtering
 *
 * @param {Object} filters - { status, limit, cursor }
 * @param {Object} logger - Logger instance
 */
export async function listCandidates(filters, logger) {
  const { status, limit, cursor } = filters;

  logger.info('Listing candidates', { status, limit });

  let queryParams;

  if (status) {
    // Query by status using GSI2
    queryParams = {
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `STATUS#${status}`,
      },
      Limit: limit,
    };
  } else {
    // Scan all candidates (expensive but necessary for no filter)
    // In production, consider a dedicated GSI for this
    queryParams = {
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'begins_with(GSI2PK, :prefix)',
      ExpressionAttributeValues: {
        ':prefix': 'STATUS#',
      },
      Limit: limit,
    };
  }

  if (cursor) {
    try {
      queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    } catch {
      // Invalid cursor, ignore
    }
  }

  const result = await docClient.send(new QueryCommand(queryParams));

  // Filter to only candidate records
  const candidates = (result.Items || [])
    .filter((item) => item.PK.startsWith('CANDIDATE#') && item.SK === 'PROFILE')
    .map((item) => ({
      candidateId: item.candidateId,
      firstName: item.firstName,
      lastName: item.lastName,
      email: item.email,
      phone: item.phone,
      status: item.status,
      experienceLevel: item.experienceLevel,
      location: item.city,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

  let nextCursor = null;
  if (result.LastEvaluatedKey) {
    nextCursor = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url');
  }

  logger.info('Candidates retrieved', { count: candidates.length });

  return {
    success: true,
    candidates,
    cursor: nextCursor,
    status: 200,
  };
}

/**
 * Get single candidate with full details
 *
 * @param {string} candidateId - Candidate ID
 * @param {Object} logger - Logger instance
 */
export async function getCandidate(candidateId, logger) {
  logger.info('Getting candidate', { candidateId });

  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: 'PROFILE',
    },
  }));

  if (!result.Item) {
    logger.warn('Candidate not found', { candidateId });
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Candidate not found.',
      status: 404,
    };
  }

  const item = result.Item;

  // Admin gets full details
  const candidate = {
    candidateId: item.candidateId,
    firstName: item.firstName,
    lastName: item.lastName,
    email: item.email,
    phone: item.phone,
    city: item.city,
    postcode: item.postcode,
    status: item.status,
    experienceLevel: item.experienceLevel,
    preferredSettings: item.preferredSettings,
    professionalSummary: item.professionalSummary,
    rightToWork: item.rightToWork,
    dbsStatus: item.dbsStatus,
    available: item.available,
    cvUploaded: item.cvUploaded,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    suspensionReason: item.suspensionReason,
    rejectionReason: item.rejectionReason,
  };

  logger.info('Candidate retrieved', { candidateId });

  return {
    success: true,
    candidate,
    status: 200,
  };
}

/**
 * Approve a candidate (transition to active)
 *
 * @param {string} candidateId - Candidate ID
 * @param {string} adminId - Admin performing the action
 * @param {Object} logger - Logger instance
 */
export async function approveCandidate(candidateId, adminId, logger) {
  logger.info('Approving candidate', { candidateId, adminId });

  // Get current candidate status
  const current = await getCandidate(candidateId, logger);
  if (!current.success) {
    return current;
  }

  const currentStatus = current.candidate.status;

  // Validate transition
  if (!isValidCandidateTransition(currentStatus, CandidateStatus.ACTIVE)) {
    logger.warn('Invalid status transition', {
      candidateId,
      currentStatus,
      targetStatus: CandidateStatus.ACTIVE,
    });
    return {
      success: false,
      error: 'INVALID_STATUS_TRANSITION',
      message: `Cannot approve candidate with status "${currentStatus}".`,
      status: 400,
    };
  }

  const now = new Date().toISOString();

  // Update status
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: 'PROFILE',
    },
    UpdateExpression: 'SET #status = :status, updatedAt = :now, approvedBy = :admin, approvedAt = :now, GSI2PK = :gsi2pk REMOVE rejectionReason, suspensionReason',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': CandidateStatus.ACTIVE,
      ':now': now,
      ':admin': adminId,
      ':gsi2pk': `STATUS#${CandidateStatus.ACTIVE}`,
    },
  }));

  // Send notification email to candidate
  await sendCandidateStatusEmail(
    current.candidate.email,
    current.candidate.firstName,
    'approved',
    logger
  );

  logger.info('Candidate approved', { candidateId, adminId });

  return {
    success: true,
    message: 'Candidate has been approved and is now active.',
    status: 200,
  };
}

/**
 * Reject a candidate
 *
 * @param {string} candidateId - Candidate ID
 * @param {string} reason - Rejection reason
 * @param {string} adminId - Admin performing the action
 * @param {Object} logger - Logger instance
 */
export async function rejectCandidate(candidateId, reason, adminId, logger) {
  logger.info('Rejecting candidate', { candidateId, adminId });

  // Get current candidate status
  const current = await getCandidate(candidateId, logger);
  if (!current.success) {
    return current;
  }

  const currentStatus = current.candidate.status;

  // Validate transition
  if (!isValidCandidateTransition(currentStatus, CandidateStatus.REJECTED)) {
    logger.warn('Invalid status transition', {
      candidateId,
      currentStatus,
      targetStatus: CandidateStatus.REJECTED,
    });
    return {
      success: false,
      error: 'INVALID_STATUS_TRANSITION',
      message: `Cannot reject candidate with status "${currentStatus}".`,
      status: 400,
    };
  }

  const now = new Date().toISOString();

  // Update status
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: 'PROFILE',
    },
    UpdateExpression: 'SET #status = :status, updatedAt = :now, rejectedBy = :admin, rejectedAt = :now, rejectionReason = :reason, GSI2PK = :gsi2pk',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': CandidateStatus.REJECTED,
      ':now': now,
      ':admin': adminId,
      ':reason': reason,
      ':gsi2pk': `STATUS#${CandidateStatus.REJECTED}`,
    },
  }));

  // Send notification email to candidate
  await sendCandidateStatusEmail(
    current.candidate.email,
    current.candidate.firstName,
    'rejected',
    logger,
    reason
  );

  logger.info('Candidate rejected', { candidateId, adminId });

  return {
    success: true,
    message: 'Candidate has been rejected.',
    status: 200,
  };
}

/**
 * Suspend an active candidate
 *
 * @param {string} candidateId - Candidate ID
 * @param {string} reason - Suspension reason
 * @param {string} adminId - Admin performing the action
 * @param {Object} logger - Logger instance
 */
export async function suspendCandidate(candidateId, reason, adminId, logger) {
  logger.info('Suspending candidate', { candidateId, adminId });

  // Get current candidate status
  const current = await getCandidate(candidateId, logger);
  if (!current.success) {
    return current;
  }

  const currentStatus = current.candidate.status;

  // Validate transition
  if (!isValidCandidateTransition(currentStatus, CandidateStatus.SUSPENDED)) {
    logger.warn('Invalid status transition', {
      candidateId,
      currentStatus,
      targetStatus: CandidateStatus.SUSPENDED,
    });
    return {
      success: false,
      error: 'INVALID_STATUS_TRANSITION',
      message: `Cannot suspend candidate with status "${currentStatus}".`,
      status: 400,
    };
  }

  const now = new Date().toISOString();

  // Update status
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: 'PROFILE',
    },
    UpdateExpression: 'SET #status = :status, updatedAt = :now, suspendedBy = :admin, suspendedAt = :now, suspensionReason = :reason, GSI2PK = :gsi2pk',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': CandidateStatus.SUSPENDED,
      ':now': now,
      ':admin': adminId,
      ':reason': reason,
      ':gsi2pk': `STATUS#${CandidateStatus.SUSPENDED}`,
    },
  }));

  // Send notification email to candidate
  await sendCandidateStatusEmail(
    current.candidate.email,
    current.candidate.firstName,
    'suspended',
    logger,
    reason
  );

  logger.info('Candidate suspended', { candidateId, adminId });

  return {
    success: true,
    message: 'Candidate has been suspended.',
    status: 200,
  };
}

/**
 * Reinstate a suspended candidate
 *
 * @param {string} candidateId - Candidate ID
 * @param {string} adminId - Admin performing the action
 * @param {Object} logger - Logger instance
 */
export async function reinstateCandidate(candidateId, adminId, logger) {
  logger.info('Reinstating candidate', { candidateId, adminId });

  // Get current candidate status
  const current = await getCandidate(candidateId, logger);
  if (!current.success) {
    return current;
  }

  const currentStatus = current.candidate.status;

  // Validate transition (suspended -> active)
  if (!isValidCandidateTransition(currentStatus, CandidateStatus.ACTIVE)) {
    logger.warn('Invalid status transition', {
      candidateId,
      currentStatus,
      targetStatus: CandidateStatus.ACTIVE,
    });
    return {
      success: false,
      error: 'INVALID_STATUS_TRANSITION',
      message: `Cannot reinstate candidate with status "${currentStatus}".`,
      status: 400,
    };
  }

  const now = new Date().toISOString();

  // Update status
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: 'PROFILE',
    },
    UpdateExpression: 'SET #status = :status, updatedAt = :now, reinstatedBy = :admin, reinstatedAt = :now, GSI2PK = :gsi2pk REMOVE suspensionReason',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': CandidateStatus.ACTIVE,
      ':now': now,
      ':admin': adminId,
      ':gsi2pk': `STATUS#${CandidateStatus.ACTIVE}`,
    },
  }));

  // Send notification email to candidate
  await sendCandidateStatusEmail(
    current.candidate.email,
    current.candidate.firstName,
    'reinstated',
    logger
  );

  logger.info('Candidate reinstated', { candidateId, adminId });

  return {
    success: true,
    message: 'Candidate has been reinstated and is now active.',
    status: 200,
  };
}

/**
 * Send status change notification email to candidate
 */
async function sendCandidateStatusEmail(email, firstName, action, logger, reason = null) {
  const subjects = {
    approved: 'Your Medibee Profile Has Been Approved',
    rejected: 'Update on Your Medibee Application',
    suspended: 'Your Medibee Account Has Been Suspended',
    reinstated: 'Your Medibee Account Has Been Reinstated',
  };

  const bodies = {
    approved: `
      <h1>Welcome to Medibee!</h1>
      <p>Hi ${firstName},</p>
      <p>Great news! Your profile has been approved and is now visible to healthcare providers on our platform.</p>
      <p>You can log in to your account to:</p>
      <ul>
        <li>Update your profile and availability</li>
        <li>Manage your CV</li>
        <li>Respond to contact requests from employers</li>
      </ul>
      <p>Best regards,<br>The Medibee Team</p>
    `,
    rejected: `
      <h1>Application Update</h1>
      <p>Hi ${firstName},</p>
      <p>Thank you for your interest in joining Medibee. After reviewing your application, we are unable to approve your profile at this time.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
      <p>If you believe this decision was made in error, or if you have additional information to share, please contact our support team.</p>
      <p>Best regards,<br>The Medibee Team</p>
    `,
    suspended: `
      <h1>Account Suspended</h1>
      <p>Hi ${firstName},</p>
      <p>Your Medibee account has been temporarily suspended.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
      <p>During this time, your profile will not be visible to employers. If you have questions about this decision, please contact our support team.</p>
      <p>Best regards,<br>The Medibee Team</p>
    `,
    reinstated: `
      <h1>Account Reinstated</h1>
      <p>Hi ${firstName},</p>
      <p>Good news! Your Medibee account has been reinstated and your profile is now active again.</p>
      <p>You can log in to your account to manage your profile and respond to new opportunities.</p>
      <p>Best regards,<br>The Medibee Team</p>
    `,
  };

  try {
    await sesClient.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: subjects[action], Charset: 'UTF-8' },
        Body: { Html: { Data: bodies[action], Charset: 'UTF-8' } },
      },
    }));

    logger.info('Status notification email sent', { email, action });
  } catch (error) {
    logger.error('Failed to send status notification email', { email, action, error: error.message });
    // Don't fail the operation if email fails
  }
}

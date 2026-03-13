/**
 * Admin Lambda Handler
 *
 * Endpoints:
 * - POST /admin/login
 * - GET /admin/candidates
 * - GET /admin/candidates/{id}
 * - POST /admin/candidates/{id}/approve
 * - POST /admin/candidates/{id}/reject
 * - POST /admin/candidates/{id}/suspend
 * - POST /admin/candidates/{id}/reinstate
 * - GET /admin/clients
 * - GET /admin/clients/{id}
 * - POST /admin/clients/{id}/suspend
 * - POST /admin/clients/{id}/reinstate
 * - GET /admin/contacts
 * - GET /admin/contacts/{id}
 * - POST /admin/contacts/{id}/resolve
 * - GET /admin/analytics
 * - GET /admin/analytics/export
 */

import { createLogger } from '/opt/nodejs/lib/logger.mjs';
import { handleOptions } from '/opt/nodejs/lib/cors.mjs';
import { successResponse, errorResponse, ERRORS } from '/opt/nodejs/lib/responses.mjs';
import { validateBody, validateQuery } from '/opt/nodejs/lib/validation.mjs';
import { extractAdminId } from '/opt/nodejs/lib/auth.mjs';
import {
  AdminLoginSchema,
  CandidateFilterSchema,
  ClientFilterSchema,
  ContactFilterSchema,
  SuspendCandidateSchema,
  RejectCandidateSchema,
  SuspendClientSchema,
  ResolveContactSchema,
  AnalyticsQuerySchema,
  AnalyticsExportSchema,
} from './validation.mjs';
import { adminLogin } from './domain/login.mjs';
import {
  listCandidates,
  getCandidate,
  approveCandidate,
  rejectCandidate,
  suspendCandidate,
  reinstateCandidate,
} from './domain/candidates.mjs';
import {
  listClients,
  getClient,
  suspendClient,
  reinstateClient,
} from './domain/clients.mjs';
import {
  listContacts,
  getContact,
  resolveContact,
} from './domain/contacts.mjs';
import {
  getAnalytics,
  exportAnalytics,
} from './domain/analytics.mjs';

export const handler = async (event, context) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return handleOptions(event);
  }

  const logger = createLogger(event, context);
  const origin = event.headers?.origin;
  const path = event.rawPath || event.path;
  const method = event.requestContext?.http?.method || event.httpMethod;

  logger.info('Admin request received', { path, method });

  try {
    // Health check
    if (path === '/admin/health' && method === 'GET') {
      return successResponse(200, {
        status: 'healthy',
        service: 'medibee-admin',
        timestamp: new Date().toISOString(),
      }, origin);
    }

    // Parse path for route matching
    const pathParts = path.split('/').filter(Boolean);

    // ==========================================
    // Public routes (no auth required)
    // ==========================================

    // POST /admin/login
    if (path === '/admin/login' && method === 'POST') {
      return await handleAdminLogin(event, logger, origin);
    }

    // ==========================================
    // Protected routes (admin auth required)
    // ==========================================

    // Extract admin ID from JWT
    let adminId;
    try {
      adminId = extractAdminId(event);
    } catch (error) {
      logger.warn('Admin auth failed', { error: error.message });
      return ERRORS.UNAUTHORIZED('Invalid admin authorization', origin);
    }

    logger.info('Authenticated admin', { adminId });

    // ==========================================
    // Candidate routes
    // ==========================================

    // GET /admin/candidates
    if (path === '/admin/candidates' && method === 'GET') {
      return await handleListCandidates(event, logger, origin);
    }

    // GET /admin/candidates/{id}
    if (pathParts[0] === 'admin' && pathParts[1] === 'candidates' && pathParts.length === 3 && method === 'GET') {
      const candidateId = pathParts[2];
      return await handleGetCandidate(candidateId, logger, origin);
    }

    // POST /admin/candidates/{id}/approve
    if (pathParts[0] === 'admin' && pathParts[1] === 'candidates' && pathParts.length === 4 && pathParts[3] === 'approve' && method === 'POST') {
      const candidateId = pathParts[2];
      return await handleApproveCandidate(candidateId, adminId, logger, origin);
    }

    // POST /admin/candidates/{id}/reject
    if (pathParts[0] === 'admin' && pathParts[1] === 'candidates' && pathParts.length === 4 && pathParts[3] === 'reject' && method === 'POST') {
      const candidateId = pathParts[2];
      return await handleRejectCandidate(event, candidateId, adminId, logger, origin);
    }

    // POST /admin/candidates/{id}/suspend
    if (pathParts[0] === 'admin' && pathParts[1] === 'candidates' && pathParts.length === 4 && pathParts[3] === 'suspend' && method === 'POST') {
      const candidateId = pathParts[2];
      return await handleSuspendCandidate(event, candidateId, adminId, logger, origin);
    }

    // POST /admin/candidates/{id}/reinstate
    if (pathParts[0] === 'admin' && pathParts[1] === 'candidates' && pathParts.length === 4 && pathParts[3] === 'reinstate' && method === 'POST') {
      const candidateId = pathParts[2];
      return await handleReinstateCandidate(candidateId, adminId, logger, origin);
    }

    // ==========================================
    // Client routes
    // ==========================================

    // GET /admin/clients
    if (path === '/admin/clients' && method === 'GET') {
      return await handleListClients(event, logger, origin);
    }

    // GET /admin/clients/{id}
    if (pathParts[0] === 'admin' && pathParts[1] === 'clients' && pathParts.length === 3 && method === 'GET') {
      const clientId = pathParts[2];
      return await handleGetClient(clientId, logger, origin);
    }

    // POST /admin/clients/{id}/suspend
    if (pathParts[0] === 'admin' && pathParts[1] === 'clients' && pathParts.length === 4 && pathParts[3] === 'suspend' && method === 'POST') {
      const clientId = pathParts[2];
      return await handleSuspendClient(event, clientId, adminId, logger, origin);
    }

    // POST /admin/clients/{id}/reinstate
    if (pathParts[0] === 'admin' && pathParts[1] === 'clients' && pathParts.length === 4 && pathParts[3] === 'reinstate' && method === 'POST') {
      const clientId = pathParts[2];
      return await handleReinstateClient(clientId, adminId, logger, origin);
    }

    // ==========================================
    // Contact routes
    // ==========================================

    // GET /admin/contacts
    if (path === '/admin/contacts' && method === 'GET') {
      return await handleListContacts(event, logger, origin);
    }

    // GET /admin/contacts/{id}
    if (pathParts[0] === 'admin' && pathParts[1] === 'contacts' && pathParts.length === 3 && method === 'GET') {
      const contactId = pathParts[2];
      return await handleGetContact(contactId, logger, origin);
    }

    // POST /admin/contacts/{id}/resolve
    if (pathParts[0] === 'admin' && pathParts[1] === 'contacts' && pathParts.length === 4 && pathParts[3] === 'resolve' && method === 'POST') {
      const contactId = pathParts[2];
      return await handleResolveContact(event, contactId, adminId, logger, origin);
    }

    // ==========================================
    // Analytics routes
    // ==========================================

    // GET /admin/analytics
    if (path === '/admin/analytics' && method === 'GET') {
      return await handleGetAnalytics(event, logger, origin);
    }

    // GET /admin/analytics/export
    if (path === '/admin/analytics/export' && method === 'GET') {
      return await handleExportAnalytics(event, logger, origin);
    }

    // Route not found
    return ERRORS.NOT_FOUND('Route not found', origin);

  } catch (error) {
    logger.error('Request failed', { error: error.message, stack: error.stack });
    return ERRORS.INTERNAL_ERROR(origin);
  }
};

// ==========================================
// Handler functions
// ==========================================

async function handleAdminLogin(event, logger, origin) {
  const validation = validateBody(event.body, AdminLoginSchema);

  if (!validation.success) {
    logger.warn('Validation failed', { errors: validation.errors });
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid login data', origin, validation.errors);
  }

  const result = await adminLogin(validation.data, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    token: result.token,
    adminId: result.adminId,
    email: result.email,
    name: result.name,
  }, origin);
}

async function handleListCandidates(event, logger, origin) {
  const validation = validateQuery(event.queryStringParameters || {}, CandidateFilterSchema);

  if (!validation.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid query parameters', origin, validation.errors);
  }

  const result = await listCandidates(validation.data, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    candidates: result.candidates,
    cursor: result.cursor,
  }, origin);
}

async function handleGetCandidate(candidateId, logger, origin) {
  const result = await getCandidate(candidateId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    candidate: result.candidate,
  }, origin);
}

async function handleApproveCandidate(candidateId, adminId, logger, origin) {
  const result = await approveCandidate(candidateId, adminId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    message: result.message,
  }, origin);
}

async function handleRejectCandidate(event, candidateId, adminId, logger, origin) {
  const validation = validateBody(event.body, RejectCandidateSchema);

  if (!validation.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  const result = await rejectCandidate(candidateId, validation.data.reason, adminId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    message: result.message,
  }, origin);
}

async function handleSuspendCandidate(event, candidateId, adminId, logger, origin) {
  const validation = validateBody(event.body, SuspendCandidateSchema);

  if (!validation.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  const result = await suspendCandidate(candidateId, validation.data.reason, adminId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    message: result.message,
  }, origin);
}

async function handleReinstateCandidate(candidateId, adminId, logger, origin) {
  const result = await reinstateCandidate(candidateId, adminId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    message: result.message,
  }, origin);
}

async function handleListClients(event, logger, origin) {
  const validation = validateQuery(event.queryStringParameters || {}, ClientFilterSchema);

  if (!validation.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid query parameters', origin, validation.errors);
  }

  const result = await listClients(validation.data, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    clients: result.clients,
    cursor: result.cursor,
  }, origin);
}

async function handleGetClient(clientId, logger, origin) {
  const result = await getClient(clientId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    client: result.client,
  }, origin);
}

async function handleSuspendClient(event, clientId, adminId, logger, origin) {
  const validation = validateBody(event.body, SuspendClientSchema);

  if (!validation.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  const result = await suspendClient(clientId, validation.data.reason, adminId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    message: result.message,
  }, origin);
}

async function handleReinstateClient(clientId, adminId, logger, origin) {
  const result = await reinstateClient(clientId, adminId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    message: result.message,
  }, origin);
}

async function handleListContacts(event, logger, origin) {
  const validation = validateQuery(event.queryStringParameters || {}, ContactFilterSchema);

  if (!validation.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid query parameters', origin, validation.errors);
  }

  const result = await listContacts(validation.data, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    contacts: result.contacts,
    cursor: result.cursor,
  }, origin);
}

async function handleGetContact(contactId, logger, origin) {
  const result = await getContact(contactId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    contact: result.contact,
  }, origin);
}

async function handleResolveContact(event, contactId, adminId, logger, origin) {
  const validation = validateBody(event.body, ResolveContactSchema);

  if (!validation.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', origin, validation.errors);
  }

  const result = await resolveContact(contactId, validation.data.status, validation.data.notes, adminId, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    message: result.message,
  }, origin);
}

async function handleGetAnalytics(event, logger, origin) {
  const validation = validateQuery(event.queryStringParameters || {}, AnalyticsQuerySchema);

  if (!validation.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid query parameters', origin, validation.errors);
  }

  const result = await getAnalytics(validation.data, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  return successResponse(200, {
    metrics: result.metrics,
    dateRange: result.dateRange,
    generatedAt: result.generatedAt,
  }, origin);
}

async function handleExportAnalytics(event, logger, origin) {
  const validation = validateQuery(event.queryStringParameters || {}, AnalyticsExportSchema);

  if (!validation.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid query parameters', origin, validation.errors);
  }

  const result = await exportAnalytics(validation.data, logger);

  if (!result.success) {
    return errorResponse(result.status, result.error, result.message, origin);
  }

  // For CSV, return with appropriate headers
  if (result.format === 'csv') {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="medibee-export-${result.entity || 'all'}-${new Date().toISOString().split('T')[0]}.csv"`,
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: result.data,
    };
  }

  return successResponse(200, {
    data: result.data,
    entity: result.entity,
  }, origin);
}

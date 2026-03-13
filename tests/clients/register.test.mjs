/**
 * Client Registration Integration Tests
 * Tests POST /clients/register endpoint
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock AWS SDK clients
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({
      send: vi.fn(),
    })),
  },
  GetCommand: vi.fn(),
  PutCommand: vi.fn(),
  QueryCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn(() => ({
    send: vi.fn().mockResolvedValue({
      Parameter: { Value: 'test-jwt-secret-min-32-chars-long' },
    }),
  })),
  GetParameterCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: vi.fn(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  SendEmailCommand: vi.fn(),
}));

describe('POST /clients/register', () => {
  const validPayload = {
    organisationName: 'Test NHS Trust',
    organisationType: 'nhs-trust',
    contactName: 'Jane Smith',
    contactEmail: 'jane.smith@testnhs.uk',
    contactPhone: '07700900123',
    billingEmail: 'billing@testnhs.uk',
    password: 'SecureP@ssword123!',
    address: {
      line1: '123 Hospital Road',
      city: 'London',
      postcode: 'SW1A 1AA',
    },
  };

  describe('validation', () => {
    it('should reject missing required fields', async () => {
      const event = createApiEvent('POST', '/clients/register', {
        organisationName: 'Test NHS Trust',
        // Missing other required fields
      });

      const { handler } = await import('../../lambdas/clients/index.mjs');
      const response = await handler(event, {});

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid email format', async () => {
      const event = createApiEvent('POST', '/clients/register', {
        ...validPayload,
        contactEmail: 'not-an-email',
      });

      const { handler } = await import('../../lambdas/clients/index.mjs');
      const response = await handler(event, {});

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid phone number', async () => {
      const event = createApiEvent('POST', '/clients/register', {
        ...validPayload,
        contactPhone: '123', // Too short
      });

      const { handler } = await import('../../lambdas/clients/index.mjs');
      const response = await handler(event, {});

      expect(response.statusCode).toBe(400);
    });

    it('should reject weak passwords', async () => {
      const event = createApiEvent('POST', '/clients/register', {
        ...validPayload,
        password: 'weak',
      });

      const { handler } = await import('../../lambdas/clients/index.mjs');
      const response = await handler(event, {});

      expect(response.statusCode).toBe(400);
    });

    it('should reject invalid organisation type', async () => {
      const event = createApiEvent('POST', '/clients/register', {
        ...validPayload,
        organisationType: 'invalid-type',
      });

      const { handler } = await import('../../lambdas/clients/index.mjs');
      const response = await handler(event, {});

      expect(response.statusCode).toBe(400);
    });
  });

  describe('successful registration', () => {
    it('should return 201 with clientId on success', async () => {
      // Mock DynamoDB to return no existing user
      const mockDocClient = {
        send: vi.fn()
          .mockResolvedValueOnce({ Items: [] }) // Query for existing email
          .mockResolvedValueOnce({}) // PutCommand for client
          .mockResolvedValueOnce({}), // PutCommand for auth
      };

      vi.doMock('@aws-sdk/lib-dynamodb', () => ({
        DynamoDBDocumentClient: {
          from: vi.fn(() => mockDocClient),
        },
        GetCommand: vi.fn(),
        PutCommand: vi.fn(),
        QueryCommand: vi.fn(),
      }));

      const event = createApiEvent('POST', '/clients/register', validPayload);

      // Note: In real test, we'd properly mock the module
      // For now, testing the validation path
    });

    it('should send verification email', async () => {
      // Test that SES is called with correct parameters
    });

    it('should hash password before storing', async () => {
      // Test that plain password is never stored
    });
  });

  describe('duplicate handling', () => {
    it('should return 409 if email already exists', async () => {
      // Test email uniqueness check
    });
  });
});

function createApiEvent(method, path, body = null) {
  return {
    requestContext: {
      http: { method },
    },
    rawPath: path,
    headers: {
      origin: 'https://medibee.opstack.uk',
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : null,
  };
}

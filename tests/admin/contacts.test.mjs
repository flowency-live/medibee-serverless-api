/**
 * Admin Contacts Management Integration Tests
 *
 * TDD RED PHASE: Write failing tests first
 * These tests define the expected behavior of admin contact management endpoints
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiClient } from '../utils/api-client.mjs';

describe('Admin Contacts Management', () => {
  let adminToken = null;

  beforeAll(async () => {
    // Login as admin
    const adminLogin = await apiClient.post('/admin/login', {
      email: 'admin@medibee-recruitment.co.uk',
      password: 'AdminSecure123!',
    });

    if (adminLogin.status === 200) {
      adminToken = adminLogin.data.token;
    }
  });

  afterAll(async () => {
    apiClient.clearToken();
  });

  describe('GET /admin/contacts', () => {
    it('should return 401 without authorization header', async () => {
      // Arrange
      apiClient.clearToken();

      // Act
      const response = await apiClient.get('/admin/contacts');

      // Assert
      expect(response.status).toBe(401);
      expect(response.data.success).toBe(false);
    });

    it('should return 200 with list of contacts for admin', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/contacts');

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(Array.isArray(response.data.contacts)).toBe(true);
    });

    it('should support status filter parameter', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/contacts?status=pending');

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      // All returned contacts should have pending status
      for (const contact of response.data.contacts) {
        expect(contact.status).toBe('pending');
      }
    });

    it('should support pagination with cursor', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/contacts?limit=10');

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(Array.isArray(response.data.contacts)).toBe(true);
      expect(response.data.contacts.length).toBeLessThanOrEqual(10);
    });

    it('should include required fields for each contact', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/contacts');

      // Assert
      expect(response.status).toBe(200);
      if (response.data.contacts.length > 0) {
        const contact = response.data.contacts[0];
        expect(contact.contactId).toBeDefined();
        expect(contact.clientId).toBeDefined();
        expect(contact.candidateId).toBeDefined();
        expect(contact.status).toBeDefined();
        expect(contact.createdAt).toBeDefined();
      }
    });

    it('should include client and candidate names for context', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/contacts');

      // Assert
      expect(response.status).toBe(200);
      if (response.data.contacts.length > 0) {
        const contact = response.data.contacts[0];
        expect(contact.clientName).toBeDefined();
        expect(contact.candidateName).toBeDefined();
      }
    });
  });

  describe('GET /admin/contacts/{id}', () => {
    it('should return 401 without authorization', async () => {
      // Arrange
      apiClient.clearToken();

      // Act
      const response = await apiClient.get('/admin/contacts/CON-test123');

      // Assert
      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent contact', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/contacts/CON-nonexistent123');

      // Assert
      expect(response.status).toBe(404);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('NOT_FOUND');
    });
  });

  describe('POST /admin/contacts/{id}/resolve', () => {
    it('should return 401 without authorization', async () => {
      // Arrange
      apiClient.clearToken();

      // Act
      const response = await apiClient.post('/admin/contacts/CON-test123/resolve', {
        status: 'contacted',
      });

      // Assert
      expect(response.status).toBe(401);
    });

    it('should return 400 for missing status', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.post('/admin/contacts/CON-test123/resolve', {});

      // Assert
      expect(response.status).toBe(400);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid status value', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.post('/admin/contacts/CON-test123/resolve', {
        status: 'invalid-status',
      });

      // Assert
      expect(response.status).toBe(400);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('VALIDATION_ERROR');
    });

    it('should return 404 for non-existent contact', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.post('/admin/contacts/CON-nonexistent123/resolve', {
        status: 'contacted',
      });

      // Assert
      expect(response.status).toBe(404);
      expect(response.data.success).toBe(false);
    });

    it('should accept valid status transitions', async () => {
      // Arrange
      apiClient.setToken(adminToken);
      const validStatuses = ['contacted', 'hired', 'declined', 'expired'];

      // This test validates the schema accepts valid status values
      // Actual status update tests would require test data setup
      for (const status of validStatuses) {
        const response = await apiClient.post('/admin/contacts/CON-nonexistent123/resolve', {
          status,
        });

        // Should fail with 404 (not found), not 400 (validation)
        expect(response.status).toBe(404);
      }
    });

    it('should support optional notes field', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.post('/admin/contacts/CON-nonexistent123/resolve', {
        status: 'contacted',
        notes: 'Called candidate on 2024-01-15. Interested in role.',
      });

      // Assert - should fail with 404 not validation error
      expect(response.status).toBe(404);
    });
  });
});

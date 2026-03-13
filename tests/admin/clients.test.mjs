/**
 * Admin Clients Management Integration Tests
 *
 * TDD RED PHASE: Write failing tests first
 * These tests define the expected behavior of admin client management endpoints
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiClient } from '../utils/api-client.mjs';

describe('Admin Clients Management', () => {
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

  describe('GET /admin/clients', () => {
    it('should return 401 without authorization header', async () => {
      // Arrange
      apiClient.clearToken();

      // Act
      const response = await apiClient.get('/admin/clients');

      // Assert
      expect(response.status).toBe(401);
      expect(response.data.success).toBe(false);
    });

    it('should return 200 with list of clients for admin', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/clients');

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(Array.isArray(response.data.clients)).toBe(true);
    });

    it('should support status filter parameter', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/clients?status=active');

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      // All returned clients should have active status
      for (const client of response.data.clients) {
        expect(client.status).toBe('active');
      }
    });

    it('should support pagination with cursor', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/clients?limit=10');

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(Array.isArray(response.data.clients)).toBe(true);
      expect(response.data.clients.length).toBeLessThanOrEqual(10);
    });

    it('should include required fields for each client', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/clients');

      // Assert
      expect(response.status).toBe(200);
      if (response.data.clients.length > 0) {
        const client = response.data.clients[0];
        expect(client.clientId).toBeDefined();
        expect(client.organisationName).toBeDefined();
        expect(client.contactEmail).toBeDefined();
        expect(client.status).toBeDefined();
        expect(client.createdAt).toBeDefined();
      }
    });

    it('should include subscription information for each client', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/clients');

      // Assert
      expect(response.status).toBe(200);
      if (response.data.clients.length > 0) {
        const client = response.data.clients[0];
        // Client may or may not have subscription
        if (client.subscription) {
          expect(client.subscription.tier).toBeDefined();
          expect(client.subscription.status).toBeDefined();
        }
      }
    });
  });

  describe('GET /admin/clients/{id}', () => {
    it('should return 401 without authorization', async () => {
      // Arrange
      apiClient.clearToken();

      // Act
      const response = await apiClient.get('/admin/clients/CLI-test123');

      // Assert
      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent client', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/clients/CLI-nonexistent123');

      // Assert
      expect(response.status).toBe(404);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('NOT_FOUND');
    });
  });

  describe('POST /admin/clients/{id}/suspend', () => {
    it('should return 401 without authorization', async () => {
      // Arrange
      apiClient.clearToken();

      // Act
      const response = await apiClient.post('/admin/clients/CLI-test123/suspend', {
        reason: 'Test suspension',
      });

      // Assert
      expect(response.status).toBe(401);
    });

    it('should return 400 for missing reason', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.post('/admin/clients/CLI-test123/suspend', {});

      // Assert
      expect(response.status).toBe(400);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /admin/clients/{id}/reinstate', () => {
    it('should return 401 without authorization', async () => {
      // Arrange
      apiClient.clearToken();

      // Act
      const response = await apiClient.post('/admin/clients/CLI-test123/reinstate', {});

      // Assert
      expect(response.status).toBe(401);
    });
  });
});

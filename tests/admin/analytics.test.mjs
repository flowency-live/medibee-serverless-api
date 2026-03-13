/**
 * Admin Analytics Integration Tests
 *
 * TDD RED PHASE: Write failing tests first
 * These tests define the expected behavior of admin analytics endpoints
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiClient } from '../utils/api-client.mjs';

describe('Admin Analytics', () => {
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

  describe('GET /admin/analytics', () => {
    it('should return 401 without authorization header', async () => {
      // Arrange
      apiClient.clearToken();

      // Act
      const response = await apiClient.get('/admin/analytics');

      // Assert
      expect(response.status).toBe(401);
      expect(response.data.success).toBe(false);
    });

    it('should return 200 with dashboard metrics for admin', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/analytics');

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.metrics).toBeDefined();
    });

    it('should include candidate metrics', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/analytics');

      // Assert
      expect(response.status).toBe(200);
      const metrics = response.data.metrics;
      expect(metrics.candidates).toBeDefined();
      expect(typeof metrics.candidates.total).toBe('number');
      expect(typeof metrics.candidates.active).toBe('number');
      expect(typeof metrics.candidates.pendingReview).toBe('number');
      expect(typeof metrics.candidates.suspended).toBe('number');
    });

    it('should include client metrics', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/analytics');

      // Assert
      expect(response.status).toBe(200);
      const metrics = response.data.metrics;
      expect(metrics.clients).toBeDefined();
      expect(typeof metrics.clients.total).toBe('number');
      expect(typeof metrics.clients.active).toBe('number');
      expect(typeof metrics.clients.withSubscription).toBe('number');
    });

    it('should include subscription metrics', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/analytics');

      // Assert
      expect(response.status).toBe(200);
      const metrics = response.data.metrics;
      expect(metrics.subscriptions).toBeDefined();
      expect(typeof metrics.subscriptions.bronze).toBe('number');
      expect(typeof metrics.subscriptions.silver).toBe('number');
      expect(typeof metrics.subscriptions.gold).toBe('number');
      expect(typeof metrics.subscriptions.mrr).toBe('number'); // Monthly recurring revenue
    });

    it('should include contact request metrics', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/analytics');

      // Assert
      expect(response.status).toBe(200);
      const metrics = response.data.metrics;
      expect(metrics.contacts).toBeDefined();
      expect(typeof metrics.contacts.total).toBe('number');
      expect(typeof metrics.contacts.pending).toBe('number');
      expect(typeof metrics.contacts.contacted).toBe('number');
      expect(typeof metrics.contacts.hired).toBe('number');
    });

    it('should include time-based metrics', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/analytics');

      // Assert
      expect(response.status).toBe(200);
      const metrics = response.data.metrics;
      expect(metrics.recent).toBeDefined();
      expect(typeof metrics.recent.registrationsLast7Days).toBe('number');
      expect(typeof metrics.recent.contactsLast7Days).toBe('number');
      expect(typeof metrics.recent.newClientsLast30Days).toBe('number');
    });

    it('should support date range filter', async () => {
      // Arrange
      apiClient.setToken(adminToken);
      const startDate = '2024-01-01';
      const endDate = '2024-01-31';

      // Act
      const response = await apiClient.get(`/admin/analytics?startDate=${startDate}&endDate=${endDate}`);

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.dateRange).toEqual({
        startDate,
        endDate,
      });
    });

    it('should return 400 for invalid date format', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/analytics?startDate=invalid-date');

      // Assert
      expect(response.status).toBe(400);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /admin/analytics/export', () => {
    it('should return 401 without authorization', async () => {
      // Arrange
      apiClient.clearToken();

      // Act
      const response = await apiClient.get('/admin/analytics/export');

      // Assert
      expect(response.status).toBe(401);
    });

    it('should return 200 with CSV export data', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/analytics/export?format=csv');

      // Assert
      expect(response.status).toBe(200);
      // CSV format should have appropriate content type
      expect(response.headers['content-type']).toContain('text/csv');
    });

    it('should support JSON export format', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/analytics/export?format=json');

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.data).toBeDefined();
    });

    it('should support filtering by entity type', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/analytics/export?format=json&entity=candidates');

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.entity).toBe('candidates');
    });
  });
});

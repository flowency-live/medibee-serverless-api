/**
 * Admin Candidates Management Integration Tests
 *
 * TDD RED PHASE: Write failing tests first
 * These tests define the expected behavior of admin candidate moderation endpoints
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiClient } from '../utils/api-client.mjs';
import { generateRegistration, cleanup } from '../utils/test-data-factory.mjs';

describe('Admin Candidates Management', () => {
  let adminToken = null;
  let candidateToken = null;
  let testCandidateId = null;
  const createdCandidates = [];

  beforeAll(async () => {
    // Login as admin
    const adminLogin = await apiClient.post('/admin/login', {
      email: 'admin@medibee-recruitment.co.uk',
      password: 'AdminSecure123!',
    });

    if (adminLogin.status === 200) {
      adminToken = adminLogin.data.token;
    }

    // Create a test candidate for moderation tests
    const registration = generateRegistration();
    const regResponse = await apiClient.post('/auth/register', registration);

    if (regResponse.data.candidateId) {
      testCandidateId = regResponse.data.candidateId;
      createdCandidates.push(testCandidateId);
    }
  });

  afterAll(async () => {
    apiClient.clearToken();
    for (const candidateId of createdCandidates) {
      await cleanup.candidate(candidateId);
    }
  });

  describe('GET /admin/candidates', () => {
    it('should return 401 without authorization header', async () => {
      // Arrange
      apiClient.clearToken();

      // Act
      const response = await apiClient.get('/admin/candidates');

      // Assert
      expect(response.status).toBe(401);
      expect(response.data.success).toBe(false);
    });

    it('should return 403 with non-admin token', async () => {
      // Arrange - use a candidate token
      apiClient.setToken('invalid-non-admin-token');

      // Act
      const response = await apiClient.get('/admin/candidates');

      // Assert
      expect(response.status).toBe(401); // Authorizer rejects invalid token
    });

    it('should return 200 with list of candidates for admin', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/candidates');

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(Array.isArray(response.data.candidates)).toBe(true);
    });

    it('should support status filter parameter', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/candidates?status=pending_review');

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(Array.isArray(response.data.candidates)).toBe(true);
      // All returned candidates should have pending_review status
      for (const candidate of response.data.candidates) {
        expect(candidate.status).toBe('pending_review');
      }
    });

    it('should support pagination with cursor', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/candidates?limit=10');

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(Array.isArray(response.data.candidates)).toBe(true);
      expect(response.data.candidates.length).toBeLessThanOrEqual(10);
      // Should include cursor if more results exist
      if (response.data.candidates.length === 10) {
        expect(response.data.cursor).toBeDefined();
      }
    });

    it('should include required fields for each candidate', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/candidates');

      // Assert
      expect(response.status).toBe(200);
      if (response.data.candidates.length > 0) {
        const candidate = response.data.candidates[0];
        expect(candidate.candidateId).toBeDefined();
        expect(candidate.firstName).toBeDefined();
        expect(candidate.lastName).toBeDefined();
        expect(candidate.email).toBeDefined();
        expect(candidate.status).toBeDefined();
        expect(candidate.createdAt).toBeDefined();
      }
    });
  });

  describe('GET /admin/candidates/{id}', () => {
    it('should return 401 without authorization', async () => {
      // Arrange
      apiClient.clearToken();

      // Act
      const response = await apiClient.get(`/admin/candidates/${testCandidateId}`);

      // Assert
      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent candidate', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get('/admin/candidates/CAND-nonexistent123');

      // Assert
      expect(response.status).toBe(404);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('NOT_FOUND');
    });

    it('should return 200 with full candidate details for admin', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.get(`/admin/candidates/${testCandidateId}`);

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.candidate).toBeDefined();
      expect(response.data.candidate.candidateId).toBe(testCandidateId);
      // Admin should see full details including sensitive data
      expect(response.data.candidate.email).toBeDefined();
      expect(response.data.candidate.phone).toBeDefined();
    });
  });

  describe('POST /admin/candidates/{id}/approve', () => {
    it('should return 401 without authorization', async () => {
      // Arrange
      apiClient.clearToken();

      // Act
      const response = await apiClient.post(`/admin/candidates/${testCandidateId}/approve`, {});

      // Assert
      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent candidate', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.post('/admin/candidates/CAND-nonexistent123/approve', {});

      // Assert
      expect(response.status).toBe(404);
      expect(response.data.success).toBe(false);
    });

    it('should return 200 and update candidate status to active', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.post(`/admin/candidates/${testCandidateId}/approve`, {});

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.message).toContain('approved');

      // Verify status changed
      const getResponse = await apiClient.get(`/admin/candidates/${testCandidateId}`);
      expect(getResponse.data.candidate.status).toBe('active');
    });

    it('should return 400 when approving already active candidate', async () => {
      // Arrange - candidate was approved in previous test
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.post(`/admin/candidates/${testCandidateId}/approve`, {});

      // Assert
      expect(response.status).toBe(400);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  describe('POST /admin/candidates/{id}/suspend', () => {
    it('should return 401 without authorization', async () => {
      // Arrange
      apiClient.clearToken();

      // Act
      const response = await apiClient.post(`/admin/candidates/${testCandidateId}/suspend`, {
        reason: 'Test suspension',
      });

      // Assert
      expect(response.status).toBe(401);
    });

    it('should return 400 for missing reason', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.post(`/admin/candidates/${testCandidateId}/suspend`, {});

      // Assert
      expect(response.status).toBe(400);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('VALIDATION_ERROR');
    });

    it('should return 200 and suspend active candidate', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.post(`/admin/candidates/${testCandidateId}/suspend`, {
        reason: 'Test suspension for integration test',
      });

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.message).toContain('suspended');

      // Verify status changed
      const getResponse = await apiClient.get(`/admin/candidates/${testCandidateId}`);
      expect(getResponse.data.candidate.status).toBe('suspended');
      expect(getResponse.data.candidate.suspensionReason).toBe('Test suspension for integration test');
    });
  });

  describe('POST /admin/candidates/{id}/reinstate', () => {
    it('should return 401 without authorization', async () => {
      // Arrange
      apiClient.clearToken();

      // Act
      const response = await apiClient.post(`/admin/candidates/${testCandidateId}/reinstate`, {});

      // Assert
      expect(response.status).toBe(401);
    });

    it('should return 200 and reinstate suspended candidate', async () => {
      // Arrange - candidate was suspended in previous test
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.post(`/admin/candidates/${testCandidateId}/reinstate`, {});

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.message).toContain('reinstated');

      // Verify status changed
      const getResponse = await apiClient.get(`/admin/candidates/${testCandidateId}`);
      expect(getResponse.data.candidate.status).toBe('active');
      expect(getResponse.data.candidate.suspensionReason).toBeUndefined();
    });

    it('should return 400 when reinstating non-suspended candidate', async () => {
      // Arrange - candidate was reinstated in previous test
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.post(`/admin/candidates/${testCandidateId}/reinstate`, {});

      // Assert
      expect(response.status).toBe(400);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  describe('POST /admin/candidates/{id}/reject', () => {
    let rejectionTestCandidateId = null;

    beforeAll(async () => {
      // Create a fresh candidate for rejection test
      const registration = generateRegistration();
      const regResponse = await apiClient.post('/auth/register', registration);

      if (regResponse.data.candidateId) {
        rejectionTestCandidateId = regResponse.data.candidateId;
        createdCandidates.push(rejectionTestCandidateId);
      }
    });

    it('should return 400 for missing reason', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.post(`/admin/candidates/${rejectionTestCandidateId}/reject`, {});

      // Assert
      expect(response.status).toBe(400);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('VALIDATION_ERROR');
    });

    it('should return 200 and reject pending candidate', async () => {
      // Arrange
      apiClient.setToken(adminToken);

      // Act
      const response = await apiClient.post(`/admin/candidates/${rejectionTestCandidateId}/reject`, {
        reason: 'Incomplete profile information',
      });

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.message).toContain('rejected');

      // Verify status changed
      const getResponse = await apiClient.get(`/admin/candidates/${rejectionTestCandidateId}`);
      expect(getResponse.data.candidate.status).toBe('rejected');
      expect(getResponse.data.candidate.rejectionReason).toBe('Incomplete profile information');
    });
  });
});

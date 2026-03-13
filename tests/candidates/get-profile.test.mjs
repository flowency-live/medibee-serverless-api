/**
 * Candidates Get Profile Integration Tests
 *
 * TDD: Write these tests FIRST, then implement the endpoint
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiClient } from '../utils/api-client.mjs';
import { generateRegistration, cleanup } from '../utils/test-data-factory.mjs';

describe('GET /candidates/me', () => {
  const createdCandidates = [];
  let authToken = null;
  let testCandidateId = null;
  let testEmail = null;

  beforeAll(async () => {
    // Create and verify a candidate for profile tests
    const payload = generateRegistration();
    testEmail = payload.email;

    const registerResponse = await apiClient.post('/auth/register', payload);

    if (registerResponse.data.candidateId) {
      createdCandidates.push(registerResponse.data.candidateId);
      testCandidateId = registerResponse.data.candidateId;
    }

    // Note: In real tests we'd need to verify email and login to get token
    // For now, tests will use unauthenticated requests
  });

  afterAll(async () => {
    apiClient.clearToken();
    for (const candidateId of createdCandidates) {
      await cleanup.candidate(candidateId);
    }
  });

  it('should return 401 without authentication', async () => {
    // Arrange - no token set

    // Act
    const response = await apiClient.get('/candidates/me');

    // Assert
    expect(response.status).toBe(401);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('UNAUTHORIZED');
  });

  it('should return 401 with invalid token', async () => {
    // Arrange
    apiClient.setToken('invalid-token');

    // Act
    const response = await apiClient.get('/candidates/me');

    // Assert
    expect(response.status).toBe(401);
    expect(response.data.success).toBe(false);

    // Cleanup
    apiClient.clearToken();
  });

  // This test requires a valid auth flow to work
  it.skip('should return 200 with authenticated candidate profile', async () => {
    // Arrange - would need to verify email and login first
    apiClient.setToken(authToken);

    // Act
    const response = await apiClient.get('/candidates/me');

    // Assert
    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.candidateId).toBe(testCandidateId);
    expect(response.data.email).toBe(testEmail);
    expect(response.data.firstName).toBeDefined();
    expect(response.data.lastName).toBeDefined();
    expect(response.data.status).toBeDefined();

    // Should NOT include sensitive data
    expect(response.data.passwordHash).toBeUndefined();
    expect(response.data.PK).toBeUndefined();
    expect(response.data.SK).toBeUndefined();

    // Cleanup
    apiClient.clearToken();
  });
});

/**
 * Auth Logout Integration Tests
 *
 * TDD: Write these tests FIRST, then implement the endpoint
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiClient } from '../utils/api-client.mjs';
import { generateRegistration, cleanup } from '../utils/test-data-factory.mjs';

describe('POST /auth/logout', () => {
  const createdCandidates = [];

  afterAll(async () => {
    apiClient.clearToken();
    for (const candidateId of createdCandidates) {
      await cleanup.candidate(candidateId);
    }
  });

  it('should return 401 without authentication', async () => {
    // Act
    const response = await apiClient.post('/auth/logout');

    // Assert
    expect(response.status).toBe(401);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('UNAUTHORIZED');
  });

  it('should return 401 with invalid token', async () => {
    // Arrange
    apiClient.setToken('invalid-token');

    // Act
    const response = await apiClient.post('/auth/logout');

    // Assert
    expect(response.status).toBe(401);
    expect(response.data.success).toBe(false);

    // Cleanup
    apiClient.clearToken();
  });

  // This test requires a valid auth flow
  it.skip('should return 200 for authenticated user', async () => {
    // Arrange - would need to register, verify, and login first
    // apiClient.setToken(validToken);

    // Act
    const response = await apiClient.post('/auth/logout');

    // Assert
    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.message).toContain('logged out');

    // Cleanup
    apiClient.clearToken();
  });

  it.skip('should invalidate session after logout', async () => {
    // Arrange - login first
    // apiClient.setToken(validToken);

    // Act - logout
    await apiClient.post('/auth/logout');

    // Assert - token should no longer work
    const response = await apiClient.get('/candidates/me');
    expect(response.status).toBe(401);

    // Cleanup
    apiClient.clearToken();
  });
});

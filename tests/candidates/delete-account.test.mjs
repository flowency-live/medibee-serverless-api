/**
 * Candidate Delete Account (GDPR) Integration Tests
 *
 * TDD: Write these tests FIRST, then implement the endpoint
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiClient } from '../utils/api-client.mjs';
import { generateRegistration } from '../utils/test-data-factory.mjs';

describe('DELETE /candidates/me', () => {
  it('should return 401 without authentication', async () => {
    // Act
    const response = await apiClient.delete('/candidates/me');

    // Assert
    expect(response.status).toBe(401);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('UNAUTHORIZED');
  });

  it('should return 401 with invalid token', async () => {
    // Arrange
    apiClient.setToken('invalid-token');

    // Act
    const response = await apiClient.delete('/candidates/me');

    // Assert
    expect(response.status).toBe(401);
    expect(response.data.success).toBe(false);

    // Cleanup
    apiClient.clearToken();
  });

  // This test requires a valid auth flow
  it.skip('should return 200 and delete all candidate data', async () => {
    // Arrange - would need to register, verify, and login first
    // apiClient.setToken(validToken);

    // Act
    const response = await apiClient.delete('/candidates/me');

    // Assert
    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.message).toContain('deleted');

    // Cleanup
    apiClient.clearToken();
  });

  it.skip('should invalidate token after account deletion', async () => {
    // Arrange - login first
    // apiClient.setToken(validToken);

    // Act - delete account
    await apiClient.delete('/candidates/me');

    // Assert - token should no longer work
    const response = await apiClient.get('/candidates/me');
    expect(response.status).toBe(401);

    // Cleanup
    apiClient.clearToken();
  });

  it.skip('should delete profile, auth records, sessions, and files', async () => {
    // This test would verify that all related data is deleted:
    // - CANDIDATE#{id}/PROFILE
    // - CANDIDATE#{id}/AUTH#CREDENTIALS
    // - SESSION#{sessionId}/SESSION
    // - S3 files (CV, photo)
  });
});

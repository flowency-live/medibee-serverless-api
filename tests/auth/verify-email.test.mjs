/**
 * Auth Verify Email Integration Tests
 *
 * TDD: Write these tests FIRST, then implement the endpoint
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiClient } from '../utils/api-client.mjs';
import { generateRegistration, cleanup } from '../utils/test-data-factory.mjs';

describe('POST /auth/verify-email', () => {
  const createdCandidates = [];
  let validToken = null;
  let registeredEmail = null;

  beforeAll(async () => {
    // Create a candidate to verify
    const payload = generateRegistration();
    registeredEmail = payload.email;
    const response = await apiClient.post('/auth/register', payload);

    if (response.data.candidateId) {
      createdCandidates.push(response.data.candidateId);
    }

    // Note: In real tests we'd need to get the token from the database or mock SES
    // For now, we'll test the error cases
  });

  afterAll(async () => {
    for (const candidateId of createdCandidates) {
      await cleanup.candidate(candidateId);
    }
  });

  it('should return 400 for missing token', async () => {
    // Arrange
    const payload = {};

    // Act
    const response = await apiClient.post('/auth/verify-email', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for empty token', async () => {
    // Arrange
    const payload = { token: '' };

    // Act
    const response = await apiClient.post('/auth/verify-email', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');
  });

  it('should return 404 for invalid/expired token', async () => {
    // Arrange
    const payload = { token: 'invalid-token-that-does-not-exist' };

    // Act
    const response = await apiClient.post('/auth/verify-email', payload);

    // Assert
    expect(response.status).toBe(404);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('TOKEN_NOT_FOUND');
  });

  // This test would require database access to get the actual token
  it.skip('should return 200 for valid token', async () => {
    // Arrange
    // const token = await getTokenFromDatabase(registeredEmail);
    const payload = { token: validToken };

    // Act
    const response = await apiClient.post('/auth/verify-email', payload);

    // Assert
    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.message).toContain('verified');
  });

  it.skip('should return 400 for already verified email', async () => {
    // Arrange - verify first
    // const token = await getTokenFromDatabase(registeredEmail);
    // await apiClient.post('/auth/verify-email', { token });

    // Act - try to verify again
    const response = await apiClient.post('/auth/verify-email', { token: validToken });

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('ALREADY_VERIFIED');
  });
});

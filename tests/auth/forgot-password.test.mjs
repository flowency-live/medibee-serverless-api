/**
 * Auth Forgot Password Integration Tests
 *
 * TDD: Write these tests FIRST, then implement the endpoint
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiClient } from '../utils/api-client.mjs';
import { generateRegistration, cleanup } from '../utils/test-data-factory.mjs';

describe('POST /auth/forgot-password', () => {
  const createdCandidates = [];
  let registeredEmail = null;

  beforeAll(async () => {
    // Create a candidate for testing
    const payload = generateRegistration();
    registeredEmail = payload.email;

    const response = await apiClient.post('/auth/register', payload);

    if (response.data.candidateId) {
      createdCandidates.push(response.data.candidateId);
    }
  });

  afterAll(async () => {
    for (const candidateId of createdCandidates) {
      await cleanup.candidate(candidateId);
    }
  });

  it('should return 400 for missing email', async () => {
    // Arrange
    const payload = {};

    // Act
    const response = await apiClient.post('/auth/forgot-password', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for invalid email format', async () => {
    // Arrange
    const payload = { email: 'not-an-email' };

    // Act
    const response = await apiClient.post('/auth/forgot-password', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');
  });

  it('should return 200 for registered email (sends reset link)', async () => {
    // Arrange
    const payload = { email: registeredEmail };

    // Act
    const response = await apiClient.post('/auth/forgot-password', payload);

    // Assert
    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.message).toContain('reset');
  });

  it('should return 200 for non-existent email (security - no enumeration)', async () => {
    // Arrange - use email that doesn't exist
    const payload = { email: 'nonexistent@medibee-test.com' };

    // Act
    const response = await apiClient.post('/auth/forgot-password', payload);

    // Assert - should still return 200 to prevent email enumeration
    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.message).toContain('reset');
  });
});

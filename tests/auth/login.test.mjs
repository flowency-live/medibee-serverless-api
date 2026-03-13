/**
 * Auth Login Integration Tests
 *
 * TDD: Write these tests FIRST, then implement the endpoint
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiClient } from '../utils/api-client.mjs';
import { generateRegistration, cleanup } from '../utils/test-data-factory.mjs';

describe('POST /auth/login', () => {
  const createdCandidates = [];
  let registeredEmail = null;
  let registeredPassword = null;

  beforeAll(async () => {
    // Create and verify a candidate for login tests
    const payload = generateRegistration();
    registeredEmail = payload.email;
    registeredPassword = payload.password;

    const response = await apiClient.post('/auth/register', payload);

    if (response.data.candidateId) {
      createdCandidates.push(response.data.candidateId);
    }

    // Note: In real tests we'd verify the email first
    // For now, we'll test with unverified account
  });

  afterAll(async () => {
    for (const candidateId of createdCandidates) {
      await cleanup.candidate(candidateId);
    }
  });

  it('should return 400 for missing email', async () => {
    // Arrange
    const payload = { password: 'SomePassword123!' };

    // Act
    const response = await apiClient.post('/auth/login', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for missing password', async () => {
    // Arrange
    const payload = { email: 'test@example.com' };

    // Act
    const response = await apiClient.post('/auth/login', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for invalid email format', async () => {
    // Arrange
    const payload = { email: 'not-an-email', password: 'SomePassword123!' };

    // Act
    const response = await apiClient.post('/auth/login', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');
  });

  it('should return 401 for non-existent email', async () => {
    // Arrange
    const payload = {
      email: 'nonexistent@medibee-test.com',
      password: 'SomePassword123!',
    };

    // Act
    const response = await apiClient.post('/auth/login', payload);

    // Assert
    expect(response.status).toBe(401);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('INVALID_CREDENTIALS');
  });

  it('should return 401 for wrong password', async () => {
    // Arrange
    const payload = {
      email: registeredEmail,
      password: 'WrongPassword123!',
    };

    // Act
    const response = await apiClient.post('/auth/login', payload);

    // Assert
    expect(response.status).toBe(401);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('INVALID_CREDENTIALS');
  });

  it('should return 403 for unverified email', async () => {
    // Arrange
    const payload = {
      email: registeredEmail,
      password: registeredPassword,
    };

    // Act
    const response = await apiClient.post('/auth/login', payload);

    // Assert
    expect(response.status).toBe(403);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('EMAIL_NOT_VERIFIED');
  });

  // This test requires email verification to work first
  it.skip('should return 200 with JWT for valid credentials', async () => {
    // Arrange - would need to verify email first
    const payload = {
      email: registeredEmail,
      password: registeredPassword,
    };

    // Act
    const response = await apiClient.post('/auth/login', payload);

    // Assert
    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.token).toBeDefined();
    expect(response.data.candidateId).toMatch(/^CAND-[a-zA-Z0-9]+$/);
  });
});

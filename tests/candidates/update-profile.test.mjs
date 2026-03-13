/**
 * Candidates Update Profile Integration Tests
 *
 * TDD: Write these tests FIRST, then implement the endpoint
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiClient } from '../utils/api-client.mjs';
import { generateRegistration, generateProfileUpdate, cleanup } from '../utils/test-data-factory.mjs';

describe('PATCH /candidates/me', () => {
  const createdCandidates = [];
  let authToken = null;
  let testCandidateId = null;

  beforeAll(async () => {
    // Create a candidate for profile update tests
    const payload = generateRegistration();

    const registerResponse = await apiClient.post('/auth/register', payload);

    if (registerResponse.data.candidateId) {
      createdCandidates.push(registerResponse.data.candidateId);
      testCandidateId = registerResponse.data.candidateId;
    }

    // Note: In real tests we'd need to verify email and login to get token
  });

  afterAll(async () => {
    apiClient.clearToken();
    for (const candidateId of createdCandidates) {
      await cleanup.candidate(candidateId);
    }
  });

  it('should return 401 without authentication', async () => {
    // Arrange
    const payload = generateProfileUpdate();

    // Act
    const response = await apiClient.patch('/candidates/me', payload);

    // Assert
    expect(response.status).toBe(401);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('UNAUTHORIZED');
  });

  it('should return 401 with invalid token', async () => {
    // Arrange
    apiClient.setToken('invalid-token');
    const payload = generateProfileUpdate();

    // Act
    const response = await apiClient.patch('/candidates/me', payload);

    // Assert
    expect(response.status).toBe(401);
    expect(response.data.success).toBe(false);

    // Cleanup
    apiClient.clearToken();
  });

  // These tests require a valid auth flow to work
  it.skip('should return 400 for invalid phone format', async () => {
    // Arrange
    apiClient.setToken(authToken);
    const payload = { phone: 'invalid-phone' };

    // Act
    const response = await apiClient.patch('/candidates/me', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');
    expect(response.data.details).toContainEqual(
      expect.objectContaining({ path: 'phone' })
    );

    // Cleanup
    apiClient.clearToken();
  });

  it.skip('should return 400 for invalid postcode format', async () => {
    // Arrange
    apiClient.setToken(authToken);
    const payload = { postcode: 'invalid' };

    // Act
    const response = await apiClient.patch('/candidates/me', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');
    expect(response.data.details).toContainEqual(
      expect.objectContaining({ path: 'postcode' })
    );

    // Cleanup
    apiClient.clearToken();
  });

  it.skip('should return 400 for invalid experience level', async () => {
    // Arrange
    apiClient.setToken(authToken);
    const payload = { experienceLevel: 'invalid-level' };

    // Act
    const response = await apiClient.patch('/candidates/me', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');

    // Cleanup
    apiClient.clearToken();
  });

  it.skip('should return 200 with valid profile update', async () => {
    // Arrange
    apiClient.setToken(authToken);
    const payload = generateProfileUpdate();

    // Act
    const response = await apiClient.patch('/candidates/me', payload);

    // Assert
    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.firstName).toBe(payload.firstName);
    expect(response.data.lastName).toBe(payload.lastName);
    expect(response.data.phone).toBe(payload.phone);
    expect(response.data.city).toBe(payload.city);
    expect(response.data.postcode.full).toBe('SW1A 1AA');
    expect(response.data.experienceLevel).toBe(payload.experienceLevel);

    // Cleanup
    apiClient.clearToken();
  });

  it.skip('should return 200 with partial profile update', async () => {
    // Arrange
    apiClient.setToken(authToken);
    const payload = { firstName: 'PartialUpdate' };

    // Act
    const response = await apiClient.patch('/candidates/me', payload);

    // Assert
    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.firstName).toBe('PartialUpdate');

    // Cleanup
    apiClient.clearToken();
  });
});

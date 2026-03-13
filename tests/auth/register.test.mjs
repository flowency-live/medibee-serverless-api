/**
 * Auth Register Integration Tests
 *
 * TDD: Write these tests FIRST, then implement the endpoint
 */

import { describe, it, expect, afterAll } from 'vitest';
import { apiClient } from '../utils/api-client.mjs';
import { generateRegistration, trackCandidate, cleanup } from '../utils/test-data-factory.mjs';

describe('POST /auth/register', () => {
  const createdCandidates = [];

  afterAll(async () => {
    // Cleanup created test candidates
    for (const candidateId of createdCandidates) {
      await cleanup.candidate(candidateId);
    }
  });

  it('should return 201 for valid registration', async () => {
    // Arrange
    const payload = generateRegistration();

    // Act
    const response = await apiClient.post('/auth/register', payload);

    // Assert
    expect(response.status).toBe(201);
    expect(response.data.success).toBe(true);
    expect(response.data.candidateId).toMatch(/^CAND-[a-zA-Z0-9]+$/);
    expect(response.data.message).toContain('verification');

    // Track for cleanup
    if (response.data.candidateId) {
      createdCandidates.push(response.data.candidateId);
    }
  });

  it('should return 400 for invalid email', async () => {
    // Arrange
    const payload = generateRegistration({ email: 'not-an-email' });

    // Act
    const response = await apiClient.post('/auth/register', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');
    expect(response.data.details).toContainEqual(
      expect.objectContaining({ path: 'email' })
    );
  });

  it('should return 400 for weak password', async () => {
    // Arrange
    const payload = generateRegistration({ password: 'weak' });

    // Act
    const response = await apiClient.post('/auth/register', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');
    expect(response.data.details).toContainEqual(
      expect.objectContaining({ path: 'password' })
    );
  });

  it('should return 400 for invalid UK phone', async () => {
    // Arrange
    const payload = generateRegistration({ phone: '12345' });

    // Act
    const response = await apiClient.post('/auth/register', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');
    expect(response.data.details).toContainEqual(
      expect.objectContaining({ path: 'phone' })
    );
  });

  it('should return 400 for missing required fields', async () => {
    // Arrange
    const payload = { email: 'test@example.com' }; // Missing other fields

    // Act
    const response = await apiClient.post('/auth/register', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');
  });

  it('should return 409 for duplicate email', async () => {
    // Arrange - First registration
    const email = generateRegistration().email;
    const payload1 = generateRegistration({ email });
    const firstResponse = await apiClient.post('/auth/register', payload1);

    if (firstResponse.data.candidateId) {
      createdCandidates.push(firstResponse.data.candidateId);
    }

    // Act - Second registration with same email
    const payload2 = generateRegistration({ email });
    const response = await apiClient.post('/auth/register', payload2);

    // Assert
    expect(response.status).toBe(409);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('EMAIL_EXISTS');
  });

  it('should normalize email to lowercase', async () => {
    // Arrange
    const payload = generateRegistration({ email: 'TEST.User@Example.COM' });

    // Act
    const response = await apiClient.post('/auth/register', payload);

    // Assert
    expect(response.status).toBe(201);

    if (response.data.candidateId) {
      createdCandidates.push(response.data.candidateId);
    }

    // The email should be stored lowercase - verify via login attempt
    // (This will be fully testable when login is implemented)
  });
});

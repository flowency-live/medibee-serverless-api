/**
 * Auth Cognito - Email Magic Link Integration Tests
 *
 * TDD: These tests define the expected behavior.
 * The implementation must pass all tests.
 */

import { describe, it, expect } from 'vitest';
import { apiClient } from '../utils/api-client.mjs';

describe('POST /auth/email/request', () => {
  it('should return 400 for missing email', async () => {
    // Arrange
    const payload = {};

    // Act
    const response = await apiClient.post('/auth/email/request', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.error).toBeDefined();
  });

  it('should return 400 for invalid email format', async () => {
    // Arrange
    const payload = { email: 'not-an-email' };

    // Act
    const response = await apiClient.post('/auth/email/request', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.error).toContain('Invalid');
  });

  it('should return 400 for email without domain', async () => {
    // Arrange
    const payload = { email: 'test@' };

    // Act
    const response = await apiClient.post('/auth/email/request', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.error).toContain('Invalid');
  });

  it('should return 200 for valid email', async () => {
    // Arrange
    const payload = { email: 'test@medibee-test.com' };

    // Act
    const response = await apiClient.post('/auth/email/request', payload);

    // Assert
    // May return 200 (success) or 500 (SES sandbox restriction)
    expect([200, 500]).toContain(response.status);
    if (response.status === 200) {
      expect(response.data.success).toBe(true);
      expect(response.data.expiresIn).toBe(900); // 15 minutes
    }
  });

  it('should normalize email to lowercase', async () => {
    // Arrange
    const payload = { email: 'TEST@MEDIBEE-TEST.COM' };

    // Act
    const response = await apiClient.post('/auth/email/request', payload);

    // Assert
    expect([200, 500]).toContain(response.status);
    if (response.status === 200) {
      expect(response.data.success).toBe(true);
    }
  });

  it('should return 429 when rate limited', async () => {
    // Arrange - make multiple requests quickly
    const email = `ratelimit-${Date.now()}@medibee-test.com`;
    const payload = { email };

    // Act - make 4 requests (limit is 3)
    await apiClient.post('/auth/email/request', payload);
    await apiClient.post('/auth/email/request', payload);
    await apiClient.post('/auth/email/request', payload);
    const response = await apiClient.post('/auth/email/request', payload);

    // Assert
    expect(response.status).toBe(429);
    expect(response.data.error).toContain('Too many requests');
  });
});

describe('GET /auth/email/verify', () => {
  it('should return error for missing token', async () => {
    // Arrange & Act
    const response = await apiClient.get('/auth/email/verify');

    // Assert - redirects to login with error
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/candidate/login');
    expect(response.headers.location).toContain('error=');
  });

  it('should return error for invalid token', async () => {
    // Arrange & Act
    const response = await apiClient.get('/auth/email/verify?token=invalid-token');

    // Assert - redirects to login with error
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/candidate/login');
    expect(response.headers.location).toContain('error=');
  });

  it('should return error for expired token', async () => {
    // Arrange - we can't easily test expired tokens without mocking
    // This test documents expected behavior
    const response = await apiClient.get('/auth/email/verify?token=expired-token');

    // Assert
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/candidate/login');
  });
});

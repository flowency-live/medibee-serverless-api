/**
 * Auth Reset Password Integration Tests
 *
 * TDD: Write these tests FIRST, then implement the endpoint
 */

import { describe, it, expect } from 'vitest';
import { apiClient } from '../utils/api-client.mjs';

describe('POST /auth/reset-password', () => {
  it('should return 400 for missing token', async () => {
    // Arrange
    const payload = { password: 'NewPassword123!' };

    // Act
    const response = await apiClient.post('/auth/reset-password', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for missing password', async () => {
    // Arrange
    const payload = { token: 'some-token' };

    // Act
    const response = await apiClient.post('/auth/reset-password', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for weak password', async () => {
    // Arrange
    const payload = { token: 'some-token', password: 'weak' };

    // Act
    const response = await apiClient.post('/auth/reset-password', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');
    expect(response.data.details).toContainEqual(
      expect.objectContaining({ path: 'password' })
    );
  });

  it('should return 404 for invalid/expired token', async () => {
    // Arrange
    const payload = {
      token: 'invalid-token-that-does-not-exist',
      password: 'NewSecurePass123!',
    };

    // Act
    const response = await apiClient.post('/auth/reset-password', payload);

    // Assert
    expect(response.status).toBe(404);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('TOKEN_NOT_FOUND');
  });

  // This test requires database access to get the actual token
  it.skip('should return 200 for valid token and password', async () => {
    // Arrange - would need to trigger forgot-password first and get token from DB
    const payload = {
      token: 'valid-reset-token',
      password: 'NewSecurePass123!',
    };

    // Act
    const response = await apiClient.post('/auth/reset-password', payload);

    // Assert
    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.message).toContain('reset');
  });

  it.skip('should allow login with new password after reset', async () => {
    // This would be a full flow test
    // 1. Forgot password
    // 2. Get token from DB
    // 3. Reset password
    // 4. Login with new password
  });
});

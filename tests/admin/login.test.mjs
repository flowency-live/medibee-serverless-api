/**
 * Admin Login Integration Tests
 *
 * TDD RED PHASE: Write failing tests first
 * These tests define the expected behavior of the admin login endpoint
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { apiClient } from '../utils/api-client.mjs';

describe('POST /admin/login', () => {
  // Admin credentials should be seeded in test environment
  const validAdminEmail = 'admin@medibee-recruitment.co.uk';
  const validAdminPassword = 'AdminSecure123!';

  it('should return 400 for missing email', async () => {
    // Arrange
    const payload = { password: 'SomePassword123!' };

    // Act
    const response = await apiClient.post('/admin/login', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for missing password', async () => {
    // Arrange
    const payload = { email: validAdminEmail };

    // Act
    const response = await apiClient.post('/admin/login', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for invalid email format', async () => {
    // Arrange
    const payload = { email: 'not-an-email', password: 'SomePassword123!' };

    // Act
    const response = await apiClient.post('/admin/login', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('VALIDATION_ERROR');
  });

  it('should return 401 for non-existent admin email', async () => {
    // Arrange
    const payload = {
      email: 'nonexistent-admin@medibee-test.com',
      password: 'SomePassword123!',
    };

    // Act
    const response = await apiClient.post('/admin/login', payload);

    // Assert
    expect(response.status).toBe(401);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('INVALID_CREDENTIALS');
  });

  it('should return 401 for wrong password', async () => {
    // Arrange
    const payload = {
      email: validAdminEmail,
      password: 'WrongPassword123!',
    };

    // Act
    const response = await apiClient.post('/admin/login', payload);

    // Assert
    expect(response.status).toBe(401);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toBe('INVALID_CREDENTIALS');
  });

  it('should return 200 with admin JWT for valid credentials', async () => {
    // Arrange
    const payload = {
      email: validAdminEmail,
      password: validAdminPassword,
    };

    // Act
    const response = await apiClient.post('/admin/login', payload);

    // Assert
    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.token).toBeDefined();
    expect(response.data.adminId).toMatch(/^ADMIN-[a-zA-Z0-9]+$/);
    expect(response.data.email).toBe(validAdminEmail);
  });

  it('should return JWT with admin issuer claim', async () => {
    // Arrange
    const payload = {
      email: validAdminEmail,
      password: validAdminPassword,
    };

    // Act
    const response = await apiClient.post('/admin/login', payload);

    // Assert
    expect(response.status).toBe(200);
    const token = response.data.token;

    // Decode JWT payload (base64url)
    const payloadPart = token.split('.')[1];
    const decoded = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());

    expect(decoded.iss).toBe('medibee-admin');
    expect(decoded.sub).toMatch(/^ADMIN-[a-zA-Z0-9]+$/);
    expect(decoded.type).toBe('admin');
  });
});

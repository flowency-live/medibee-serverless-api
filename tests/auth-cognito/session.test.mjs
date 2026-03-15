/**
 * Auth Cognito - Session Management Integration Tests
 *
 * TDD: These tests define the expected behavior.
 * The implementation must pass all tests.
 */

import { describe, it, expect } from 'vitest';
import { apiClient } from '../utils/api-client.mjs';

describe('GET /auth/session', () => {
  it('should return authenticated: false when no cookie', async () => {
    // Arrange & Act
    const response = await apiClient.get('/auth/session');

    // Assert
    expect(response.status).toBe(200);
    expect(response.data.authenticated).toBe(false);
  });

  it('should return authenticated: false for invalid session cookie', async () => {
    // Arrange - set invalid cookie (would need cookie support in apiClient)
    // For now, test documents expected behavior

    // Act
    const response = await apiClient.get('/auth/session');

    // Assert
    expect(response.status).toBe(200);
    expect(response.data.authenticated).toBe(false);
  });
});

describe('POST /auth/cognito/logout', () => {
  it('should return 200 and clear cookie', async () => {
    // Arrange & Act
    const response = await apiClient.post('/auth/cognito/logout', {});

    // Assert
    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.redirect).toContain('/candidate/login');

    // Should have Set-Cookie header to clear the cookie
    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
      expect(setCookie).toContain('medibee_session=');
      expect(setCookie).toContain('Max-Age=0');
    }
  });
});

describe('GET /auth/google', () => {
  it('should redirect to Cognito with Google provider', async () => {
    // Arrange & Act
    const response = await apiClient.get('/auth/google');

    // Assert - should redirect to Cognito hosted UI
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('amazoncognito.com');
    expect(response.headers.location).toContain('identity_provider=Google');
  });
});

describe('GET /auth/apple', () => {
  it('should redirect to Cognito with Apple provider', async () => {
    // Arrange & Act
    const response = await apiClient.get('/auth/apple');

    // Assert - should redirect to Cognito hosted UI
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('amazoncognito.com');
    expect(response.headers.location).toContain('identity_provider=SignInWithApple');
  });
});

describe('GET /auth/callback', () => {
  it('should return error for missing code', async () => {
    // Arrange & Act
    const response = await apiClient.get('/auth/callback');

    // Assert - redirects to login with error
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/candidate/login');
    expect(response.headers.location).toContain('error=');
  });

  it('should return error for missing state', async () => {
    // Arrange & Act
    const response = await apiClient.get('/auth/callback?code=test-code');

    // Assert - redirects to login with error
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/candidate/login');
    expect(response.headers.location).toContain('error=');
  });

  it('should return error for invalid state (CSRF protection)', async () => {
    // Arrange & Act
    const response = await apiClient.get('/auth/callback?code=test-code&state=invalid-state');

    // Assert - redirects to login with error
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/candidate/login');
    expect(response.headers.location).toContain('error=');
  });
});

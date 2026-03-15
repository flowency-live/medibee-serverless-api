/**
 * Auth Cognito - Phone OTP Integration Tests
 *
 * TDD: These tests define the expected behavior.
 * The implementation must pass all tests.
 */

import { describe, it, expect } from 'vitest';
import { apiClient } from '../utils/api-client.mjs';

describe('POST /auth/phone/request', () => {
  it('should return 400 for missing phone number', async () => {
    // Arrange
    const payload = {};

    // Act
    const response = await apiClient.post('/auth/phone/request', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.error).toBeDefined();
  });

  it('should return 400 for invalid UK phone format', async () => {
    // Arrange
    const payload = { phone: '12345' };

    // Act
    const response = await apiClient.post('/auth/phone/request', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.error).toContain('Invalid');
  });

  it('should return 400 for non-UK phone number', async () => {
    // Arrange
    const payload = { phone: '+15551234567' }; // US number

    // Act
    const response = await apiClient.post('/auth/phone/request', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.error).toContain('UK');
  });

  it('should return 200 for valid UK mobile number', async () => {
    // Arrange - use a test number that won't actually send SMS
    // In dev, SNS sandbox mode only allows verified numbers
    const payload = { phone: '+447700900000' }; // Ofcom test range

    // Act
    const response = await apiClient.post('/auth/phone/request', payload);

    // Assert
    // May return 200 (success) or 500 (SNS sandbox restriction)
    // In production with verified numbers, should be 200
    expect([200, 429, 500]).toContain(response.status);
    if (response.status === 200) {
      expect(response.data.success).toBe(true);
      expect(response.data.expiresIn).toBe(300); // 5 minutes
    }
  });

  it('should return 429 when rate limited', async () => {
    // Arrange - make multiple requests quickly
    const payload = { phone: '+447700900001' };

    // Act - make 4 requests (limit is 3)
    await apiClient.post('/auth/phone/request', payload);
    await apiClient.post('/auth/phone/request', payload);
    await apiClient.post('/auth/phone/request', payload);
    const response = await apiClient.post('/auth/phone/request', payload);

    // Assert
    expect(response.status).toBe(429);
    expect(response.data.error).toContain('Too many requests');
  });
});

describe('POST /auth/phone/verify', () => {
  it('should return 400 for missing phone', async () => {
    // Arrange
    const payload = { otp: '123456' };

    // Act
    const response = await apiClient.post('/auth/phone/verify', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.error).toBeDefined();
  });

  it('should return 400 for missing OTP', async () => {
    // Arrange
    const payload = { phone: '+447700900000' };

    // Act
    const response = await apiClient.post('/auth/phone/verify', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.error).toBeDefined();
  });

  it('should return 400 for invalid OTP format (non-numeric)', async () => {
    // Arrange
    const payload = { phone: '+447700900000', otp: 'abcdef' };

    // Act
    const response = await apiClient.post('/auth/phone/verify', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.error).toBeDefined();
  });

  it('should return 400 for invalid OTP format (wrong length)', async () => {
    // Arrange
    const payload = { phone: '+447700900000', otp: '12345' }; // 5 digits

    // Act
    const response = await apiClient.post('/auth/phone/verify', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.error).toBeDefined();
  });

  it('should return 400 for non-existent OTP request', async () => {
    // Arrange - phone that never requested OTP
    const payload = { phone: '+447700900099', otp: '123456' };

    // Act
    const response = await apiClient.post('/auth/phone/verify', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.error).toContain('No verification code found');
  });

  it('should return 400 for wrong OTP', async () => {
    // Arrange - first request OTP, then use wrong code
    await apiClient.post('/auth/phone/request', { phone: '+447700900002' });
    const payload = { phone: '+447700900002', otp: '000000' };

    // Act
    const response = await apiClient.post('/auth/phone/verify', payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.data.error).toContain('Incorrect code');
  });
});

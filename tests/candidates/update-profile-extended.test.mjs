/**
 * Extended Profile Fields Integration Tests
 *
 * TDD: These tests are written FIRST, before implementation.
 * All tests should FAIL until the handlers are updated.
 *
 * New fields being tested:
 * - tagline: 100 char professional headline
 * - workHistory: Array of structured work entries
 * - skills: Array of healthcare skills
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiClient } from '../utils/api-client.mjs';
import { generateRegistration, cleanup } from '../utils/test-data-factory.mjs';

/**
 * Generate a valid work history entry
 */
function generateWorkHistoryEntry(overrides = {}) {
  return {
    role: 'Healthcare Assistant',
    employer: 'Sunrise Care Home',
    startDate: '2022-01-15',
    endDate: '2024-03-01',
    description: 'Provided personal care to elderly residents',
    isCurrent: false,
    ...overrides,
  };
}

/**
 * Generate valid extended profile update
 */
function generateExtendedProfileUpdate(overrides = {}) {
  return {
    tagline: 'Compassionate HCA with 5+ years mental health experience',
    workHistory: [
      generateWorkHistoryEntry(),
      generateWorkHistoryEntry({
        role: 'Senior HCA',
        employer: 'NHS Trust',
        startDate: '2024-03-15',
        endDate: null,
        isCurrent: true,
      }),
    ],
    skills: ['Manual Handling', 'Medication Administration', 'Dementia Care'],
    ...overrides,
  };
}

describe('PATCH /candidates/me - Extended Profile Fields', () => {
  const createdCandidates = [];

  beforeAll(async () => {
    // Create a test candidate
    const payload = generateRegistration();
    const registerResponse = await apiClient.post('/auth/register', payload);

    if (registerResponse.data.candidateId) {
      createdCandidates.push(registerResponse.data.candidateId);
    }
  });

  afterAll(async () => {
    apiClient.clearToken();
    for (const candidateId of createdCandidates) {
      await cleanup.candidate(candidateId);
    }
  });

  // ============================================
  // TAGLINE TESTS
  // ============================================

  describe('tagline field', () => {
    it('should accept a valid tagline (100 chars max)', async () => {
      // Arrange
      const tagline = 'Compassionate HCA with 5+ years mental health experience';
      const payload = { tagline };

      // Act
      const response = await apiClient.patch('/candidates/me', payload);

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.tagline).toBe(tagline);
    });

    it('should return 400 for tagline over 100 characters', async () => {
      // Arrange
      const tagline = 'A'.repeat(101); // 101 chars
      const payload = { tagline };

      // Act
      const response = await apiClient.patch('/candidates/me', payload);

      // Assert
      expect(response.status).toBe(400);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('VALIDATION_ERROR');
      expect(response.data.details).toContainEqual(
        expect.objectContaining({ path: 'tagline' })
      );
    });

    it('should accept empty tagline (optional field)', async () => {
      // Arrange
      const payload = { tagline: '' };

      // Act
      const response = await apiClient.patch('/candidates/me', payload);

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
    });
  });

  // ============================================
  // WORK HISTORY TESTS
  // ============================================

  describe('workHistory field', () => {
    it('should accept valid work history array', async () => {
      // Arrange
      const workHistory = [
        generateWorkHistoryEntry(),
        generateWorkHistoryEntry({
          role: 'Senior HCA',
          employer: 'NHS Trust',
          isCurrent: true,
        }),
      ];
      const payload = { workHistory };

      // Act
      const response = await apiClient.patch('/candidates/me', payload);

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.workHistory).toHaveLength(2);
      expect(response.data.workHistory[0].role).toBe('Healthcare Assistant');
      expect(response.data.workHistory[1].isCurrent).toBe(true);
    });

    it('should accept empty work history array', async () => {
      // Arrange
      const payload = { workHistory: [] };

      // Act
      const response = await apiClient.patch('/candidates/me', payload);

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.workHistory).toEqual([]);
    });

    it('should return 400 for work history entry missing required role', async () => {
      // Arrange
      const payload = {
        workHistory: [
          {
            employer: 'Some Place',
            startDate: '2022-01-01',
            // role is missing
          },
        ],
      };

      // Act
      const response = await apiClient.patch('/candidates/me', payload);

      // Assert
      expect(response.status).toBe(400);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for work history entry missing required employer', async () => {
      // Arrange
      const payload = {
        workHistory: [
          {
            role: 'HCA',
            startDate: '2022-01-01',
            // employer is missing
          },
        ],
      };

      // Act
      const response = await apiClient.patch('/candidates/me', payload);

      // Assert
      expect(response.status).toBe(400);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for work history entry missing required startDate', async () => {
      // Arrange
      const payload = {
        workHistory: [
          {
            role: 'HCA',
            employer: 'Care Home',
            // startDate is missing
          },
        ],
      };

      // Act
      const response = await apiClient.patch('/candidates/me', payload);

      // Assert
      expect(response.status).toBe(400);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid date format in work history', async () => {
      // Arrange
      const payload = {
        workHistory: [
          {
            role: 'HCA',
            employer: 'Care Home',
            startDate: '01/01/2022', // Wrong format, should be ISO
          },
        ],
      };

      // Act
      const response = await apiClient.patch('/candidates/me', payload);

      // Assert
      expect(response.status).toBe(400);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for work history with more than 10 entries', async () => {
      // Arrange
      const workHistory = Array.from({ length: 11 }, (_, i) =>
        generateWorkHistoryEntry({ employer: `Employer ${i + 1}` })
      );
      const payload = { workHistory };

      // Act
      const response = await apiClient.patch('/candidates/me', payload);

      // Assert
      expect(response.status).toBe(400);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('VALIDATION_ERROR');
    });
  });

  // ============================================
  // SKILLS TESTS
  // ============================================

  describe('skills field', () => {
    it('should accept valid skills array', async () => {
      // Arrange
      const skills = ['Manual Handling', 'Medication Administration', 'Dementia Care'];
      const payload = { skills };

      // Act
      const response = await apiClient.patch('/candidates/me', payload);

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.skills).toEqual(skills);
    });

    it('should accept empty skills array', async () => {
      // Arrange
      const payload = { skills: [] };

      // Act
      const response = await apiClient.patch('/candidates/me', payload);

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.skills).toEqual([]);
    });

    it('should return 400 for skill over 100 characters', async () => {
      // Arrange
      const skills = ['A'.repeat(101)]; // 101 chars
      const payload = { skills };

      // Act
      const response = await apiClient.patch('/candidates/me', payload);

      // Assert
      expect(response.status).toBe(400);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for more than 20 skills', async () => {
      // Arrange
      const skills = Array.from({ length: 21 }, (_, i) => `Skill ${i + 1}`);
      const payload = { skills };

      // Act
      const response = await apiClient.patch('/candidates/me', payload);

      // Assert
      expect(response.status).toBe(400);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('VALIDATION_ERROR');
    });

    it('should deduplicate skills', async () => {
      // Arrange
      const skills = ['Manual Handling', 'Manual Handling', 'Dementia Care'];
      const payload = { skills };

      // Act
      const response = await apiClient.patch('/candidates/me', payload);

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.skills).toHaveLength(2);
      expect(response.data.skills).toContain('Manual Handling');
      expect(response.data.skills).toContain('Dementia Care');
    });
  });

  // ============================================
  // COMBINED UPDATE TESTS
  // ============================================

  describe('combined extended profile update', () => {
    it('should accept all extended fields in single update', async () => {
      // Arrange
      const payload = generateExtendedProfileUpdate();

      // Act
      const response = await apiClient.patch('/candidates/me', payload);

      // Assert
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.tagline).toBe(payload.tagline);
      expect(response.data.workHistory).toHaveLength(2);
      expect(response.data.skills).toHaveLength(3);
    });

    it('should merge extended fields with existing profile data', async () => {
      // Arrange - first update basic profile
      const basicPayload = {
        firstName: 'Jane',
        lastName: 'Doe',
        experienceLevel: '5-plus-years',
      };
      await apiClient.patch('/candidates/me', basicPayload);

      // Act - then update extended fields only
      const extendedPayload = {
        tagline: 'Experienced mental health specialist',
        skills: ['Mental Health', 'Crisis Intervention'],
      };
      const response = await apiClient.patch('/candidates/me', extendedPayload);

      // Assert - both basic and extended fields should be present
      expect(response.status).toBe(200);
      expect(response.data.firstName).toBe('Jane');
      expect(response.data.lastName).toBe('Doe');
      expect(response.data.experienceLevel).toBe('5-plus-years');
      expect(response.data.tagline).toBe(extendedPayload.tagline);
      expect(response.data.skills).toEqual(extendedPayload.skills);
    });
  });
});

describe('GET /candidates/{id} - Extended Profile Fields', () => {
  it.skip('should return extended fields for authorized client', async () => {
    // This test requires a full client auth flow
    // Skipped until client auth is set up in test infrastructure
    expect(true).toBe(true);
  });

  it.skip('should include workHistory in profile response', async () => {
    // This test requires a full auth flow
    expect(true).toBe(true);
  });

  it.skip('should include skills in profile response', async () => {
    // This test requires a full auth flow
    expect(true).toBe(true);
  });

  it.skip('should include tagline in profile response', async () => {
    // This test requires a full auth flow
    expect(true).toBe(true);
  });
});

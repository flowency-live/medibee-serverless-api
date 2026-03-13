/**
 * Test Data Factory
 * Generates test data for integration tests
 */

import { nanoid } from 'nanoid';

let testCounter = 0;

/**
 * Generate a unique test email
 */
export function generateTestEmail() {
  testCounter++;
  return `test-${Date.now()}-${testCounter}@medibee-test.com`;
}

/**
 * Generate a valid registration payload
 */
export function generateRegistration(overrides = {}) {
  return {
    email: generateTestEmail(),
    password: 'SecurePass123!',
    firstName: 'Test',
    lastName: 'User',
    phone: '07700900123',
    ...overrides,
  };
}

/**
 * Generate a candidate profile update payload
 */
export function generateProfileUpdate(overrides = {}) {
  return {
    firstName: 'Updated',
    lastName: 'Name',
    phone: '07700900456',
    city: 'London',
    postcode: 'SW1A 1AA',
    experienceLevel: '3-5-years',
    preferredSettings: ['mental-health', 'acute-care'],
    professionalSummary: 'Experienced healthcare assistant with 4 years of experience in mental health settings. Passionate about patient care and committed to continuous professional development.',
    rightToWork: true,
    dbsStatus: 'cleared',
    ...overrides,
  };
}

/**
 * Track created test data for cleanup
 */
const createdCandidates = [];

export function trackCandidate(candidateId) {
  createdCandidates.push(candidateId);
}

/**
 * Cleanup test data (call in afterAll)
 */
export async function cleanupTestData() {
  // TODO: Implement cleanup via admin API or direct DynamoDB delete
  console.log('Test data to clean up:', createdCandidates);
  createdCandidates.length = 0;
}

export const cleanup = {
  candidate: async (candidateId) => {
    // TODO: Implement direct DynamoDB delete for test cleanup
    console.log('Would clean up candidate:', candidateId);
  },
};

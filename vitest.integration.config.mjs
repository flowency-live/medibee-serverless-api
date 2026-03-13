import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Integration Test Config
 * Runs tests that require a running API server (deployed or local)
 * Set API_BASE_URL environment variable to point to the API
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/auth/**/*.test.mjs',
      'tests/admin/**/*.test.mjs',
      'tests/candidates/delete-account.test.mjs',
      'tests/uploads/cv-upload.test.mjs',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '/opt/nodejs': path.resolve(__dirname, 'lambda-layers/medibee-common/nodejs'),
    },
  },
});

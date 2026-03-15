import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Unit Test Config
 * Runs tests that call handlers directly with mocked AWS SDKs
 * Does NOT require a running server
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{mjs,ts}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Integration tests that require a running API server
      'tests/auth/**/*.test.mjs',
      'tests/auth-cognito/**/*.test.mjs',
      'tests/admin/**/*.test.mjs',
      'tests/candidates/get-profile.test.mjs',
      'tests/candidates/update-profile.test.mjs',
      'tests/candidates/delete-account.test.mjs',
      'tests/uploads/cv-upload.test.mjs',
      // Webhook tests require stripe package
      'tests/subscription/webhook.test.mjs',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'dist/', 'cdk/', '**/*.test.{mjs,ts}'],
    },
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '/opt/nodejs': path.resolve(__dirname, 'lambda-layers/medibee-common/nodejs'),
    },
  },
});

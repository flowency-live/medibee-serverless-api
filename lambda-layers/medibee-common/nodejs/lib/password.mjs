/**
 * Password Hashing Utilities
 *
 * Uses hash-wasm (pure WebAssembly Argon2id) for cross-platform compatibility.
 * Works on Lambda ARM64, Windows, Linux x64 without native compilation.
 *
 * SECURITY: Follows OWASP 2026 recommendations:
 * - Algorithm: Argon2id (RFC 9106)
 * - Memory: 19 MiB (19,456 KB)
 * - Iterations: 2
 * - Parallelism: 1
 */

import { argon2id, argon2Verify } from 'hash-wasm';
import crypto from 'crypto';

// OWASP recommended Argon2id parameters
const ARGON2_CONFIG = {
  parallelism: 1,
  iterations: 2,
  memorySize: 19456, // 19 MiB
  hashLength: 32,
  outputType: 'encoded', // PHC string format for storage
};

/**
 * Hash a password using Argon2id
 * @param {string} password - Plain text password to hash
 * @returns {Promise<string>} PHC-formatted hash string
 */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);

  return await argon2id({
    password,
    salt,
    ...ARGON2_CONFIG,
  });
}

/**
 * Verify a password against a stored hash
 * @param {string} hash - PHC-formatted hash string from database
 * @param {string} password - Plain text password to verify
 * @returns {Promise<boolean>} True if password matches
 */
export async function verifyPassword(hash, password) {
  try {
    return await argon2Verify({
      password,
      hash,
    });
  } catch {
    // Invalid hash format or verification error
    return false;
  }
}

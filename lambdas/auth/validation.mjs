/**
 * Auth Lambda Validation Schemas
 */

import { z } from 'zod';
import {
  emailSchema,
  ukPhoneSchema,
  passwordSchema,
} from '/opt/nodejs/lib/validation.mjs';

// Registration request schema
export const RegisterSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().min(1, 'First name is required').max(50, 'First name too long'),
  lastName: z.string().min(1, 'Last name is required').max(50, 'Last name too long'),
  phone: ukPhoneSchema,
});

// Verify email request schema
export const VerifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

// Login request schema
export const LoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

// Forgot password request schema
export const ForgotPasswordSchema = z.object({
  email: emailSchema,
});

// Reset password request schema
export const ResetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: passwordSchema,
});

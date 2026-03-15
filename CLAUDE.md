# Medibee Serverless API - Development Guidelines

> **Inherits from:** `C:\VSProjects\.claude\CLAUDE.md` (global rules apply)
>
> This document adds project-specific context. Global rules CANNOT be overridden.

---

## Project Overview

**medibee-serverless-api** is the backend API for the Medibee Talent Showcase Platform.

- **Purpose:** Candidate registration, profile management, CV uploads, authentication
- **Type:** Serverless API (AWS Lambda + API Gateway + DynamoDB)
- **Deployment:** CDK with CI/CD via GitHub Actions
- **Region:** eu-west-2 (London)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     API Gateway (HTTP API)                   │
│                           │                                  │
│                    Lambda Authorizer                         │
│                           │                                  │
│         ┌─────────────────┼─────────────────┐               │
│         │                 │                 │               │
│    Auth Lambda      Candidates Lambda  Uploads Lambda       │
│         │                 │                 │               │
│         └─────────────────┼─────────────────┘               │
│                           │                                  │
│              ┌────────────┼────────────┐                    │
│              │            │            │                    │
│          DynamoDB        S3          SES                    │
│       (medibee-main)  (medibee-files)  (emails)            │
└─────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
medibee-serverless-api/
├── cdk/                      # Infrastructure as Code
│   ├── bin/medibee-api.ts   # CDK app entry point
│   └── lib/                 # Stack definitions
├── lambda-layers/           # Shared Lambda layer
│   └── medibee-common/
│       └── nodejs/lib/      # Shared utilities
├── lambdas/                 # Lambda function code
│   ├── auth/               # Legacy authentication endpoints
│   ├── auth-cognito/       # Cognito authentication (phone/email/OAuth)
│   ├── candidates/         # Profile CRUD endpoints
│   ├── clients/            # Client/organisation endpoints
│   ├── subscription/       # Stripe subscription endpoints
│   ├── matching/           # Candidate browse/search endpoints
│   ├── contacts/           # Contact request endpoints
│   ├── admin/              # Admin dashboard endpoints
│   └── uploads/            # CV upload endpoints
└── tests/                   # Test files (mirrors lambdas/)
```

---

## DynamoDB Single-Table Design

**Table:** `medibee-main-{stage}`

| Entity | PK | SK |
|--------|----|----|
| Candidate Profile | `CANDIDATE#{id}` | `PROFILE` |
| Candidate Auth | `CANDIDATE#{id}` | `AUTH#EMAIL` |
| Verification Token | `VERIFY#{token}` | `VERIFY` |
| Session | `SESSION#{sessionId}` | `SESSION` |

**GSIs:**
- GSI1: Email lookup (`EMAIL#{email}` → `CANDIDATE`)
- GSI2: Status filter (`STATUS#{status}` → `CANDIDATE#{id}`)
- GSI3: Location search (`LOCATION#{outward}` → `CANDIDATE#{id}`)

---

## Lambda Handler Pattern

```javascript
// lambdas/{name}/index.mjs
import { createLogger } from '/opt/nodejs/lib/logger.mjs';
import { corsHeaders, handleOptions } from '/opt/nodejs/lib/cors.mjs';
import { successResponse, errorResponse } from '/opt/nodejs/lib/responses.mjs';

export const handler = async (event, context) => {
  // 1. Handle OPTIONS (CORS preflight)
  if (event.httpMethod === 'OPTIONS') {
    return handleOptions();
  }

  const logger = createLogger(event, context);

  try {
    // 2. Parse and validate input (MANDATORY - per CLAUDE.md)
    const body = JSON.parse(event.body || '{}');
    const validation = schema.safeParse(body);

    if (!validation.success) {
      return errorResponse(400, 'VALIDATION_ERROR', validation.error.issues);
    }

    // 3. Business logic (call domain layer)
    const result = await processRequest(validation.data);

    // 4. Return success
    return successResponse(200, result);

  } catch (error) {
    logger.error({ error: error.message, stack: error.stack }, 'Request failed');
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
};
```

---

## MANDATORY: Input Validation with Zod

**Per CLAUDE.md rules - ALL external input MUST be validated.**

Every Lambda handler MUST:

1. **Define Zod schemas** in a `lib/validation.mjs` file
2. **Validate at the boundary** before any business logic
3. **Return typed data** from the schema, not raw input

```javascript
// lambdas/{name}/lib/validation.mjs
import { z } from 'zod';

export const RequestSchema = z.object({
  email: z.string().email(),
  phone: z.string().regex(/^(?:\+44|0)7\d{9}$/),
});

export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: result.error.errors[0]?.message || 'Validation failed',
  };
}
```

**NEVER:**
- Trust `event.body` without validation
- Trust `queryStringParameters` without validation
- Use type assertions (`as Type`) instead of validation
- Skip validation "for speed" or "simplicity"

---

## Security Requirements

### Authentication
- JWT tokens use HS256 with secret from SSM Parameter Store
- Secret path: `/medibee/auth/jwt-secret`
- Token expiry: 7 days
- Authorizer fails CLOSED (deny by default)

### Authorization
- candidateId MUST be extracted from JWT claims only
- NEVER trust candidateId from request body or URL params
- All queries must be scoped to the authenticated candidate

### File Uploads
- PDF only (validate magic bytes: `%PDF-`)
- Max size: 5MB
- Presigned URLs expire in 5 minutes
- Confirm endpoint validates file before updating profile

### Data Security
- No internal IDs (PK, SK, GSI keys) in API responses
- Passwords hashed with argon2
- Verification tokens use nanoid (cryptographically secure)
- Sessions stored in DynamoDB with TTL

---

## Testing Requirements

### TDD Workflow
1. Write failing integration test (RED)
2. Implement Lambda handler (GREEN)
3. Refactor if needed
4. Commit

### Test File Location
```
tests/
├── auth/
│   ├── register.test.mjs
│   ├── verify-email.test.mjs
│   └── login.test.mjs
├── auth-cognito/              # Cognito auth tests
│   ├── phone-otp.test.mjs
│   ├── email-magic-link.test.mjs
│   └── session.test.mjs
├── candidates/
│   ├── get-profile.test.mjs
│   └── update-profile.test.mjs
└── uploads/
    └── cv-upload.test.mjs
```

### TDD Enforcement

**Tests MUST be written BEFORE implementation.**

When creating a new Lambda or endpoint:
1. Create tests first in `tests/{lambda-name}/`
2. Run tests - they MUST fail (RED state)
3. Implement the handler
4. Run tests - they MUST pass (GREEN state)
5. Only then commit

**NEVER commit Lambda code without corresponding tests.**

### Running Tests
```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:integration  # Integration tests against deployed API
```

---

## Deployment

### DO NOT deploy manually
All deployments go through CI/CD:
1. Push to main branch
2. GitHub Actions runs tests
3. CDK deploys on success

### Stack Names
- `medibee-foundation-{stage}` - DynamoDB, S3, SSM
- `medibee-api-{stage}` - API Gateway, Authorizer
- `medibee-candidates-{stage}` - Lambda functions

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STAGE` | dev / prod |
| `TABLE_NAME` | DynamoDB table name |
| `FILES_BUCKET` | S3 bucket name |
| `JWT_SECRET_PARAM` | SSM parameter path for JWT secret |
| `SES_FROM_EMAIL` | Verified SES sender email |

---

## Related Documentation

- [MVP PRD](C:\VSProjects\_Websites\Medibee-Website\.documentation\MEDIBEE_TALENT_SHOWCASE_MVP_PRD.md)
- [Implementation Plan](C:\VSProjects\_Websites\Medibee-Website\.documentation\MEDIBEE_TALENT_SHOWCASE_IMPLEMENTATION_PLAN.md)
- [Global Development Standards](C:\VSProjects\.claude\CLAUDE.md)
- [Security Guardrails](C:\VSProjects\.claude\skills\security-guardrails.md)

---

*Last Updated: March 2026*

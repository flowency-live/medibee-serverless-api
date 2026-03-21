# Medibee Serverless API

Backend API for the Medibee Talent Showcase Platform.

## Architecture

- **API Gateway (HTTP):** RESTful API endpoints
- **Lambda Functions:** Node.js 20.x, ARM64 architecture
- **DynamoDB:** Single-table design with GSIs
- **Cognito:** User authentication (email, phone, OAuth)
- **S3:** Credential document storage (encrypted)

## Project Structure

```
medibee-serverless-api/
├── bin/
│   └── medibee-api.ts          # CDK app entry point
├── lib/
│   └── medibee-api-stack.ts    # Main CDK stack
├── src/
│   ├── handlers/
│   │   ├── auth/               # Authentication endpoints
│   │   ├── candidates/         # Candidate profile endpoints
│   │   ├── clients/            # Provider/client endpoints
│   │   └── admin/              # Admin dashboard endpoints
│   ├── domain/                 # Domain entities
│   └── infrastructure/         # Database, S3 utilities
├── tests/
│   ├── integration/            # API integration tests
│   └── unit/                   # Unit tests
├── cdk.json
├── package.json
└── tsconfig.json
```

## API Endpoints

### Authentication (`/auth`)
- `POST /auth/register/candidate` - Register HCA
- `POST /auth/register/client` - Register care provider
- `POST /auth/login/candidate` - HCA login
- `POST /auth/login/client` - Provider login
- `POST /auth/verify-email` - Email verification
- `GET /health` - Health check

### Candidates (`/candidates`)
- `GET /candidates` - List candidates
- `GET /candidates/{id}` - Get profile
- `PUT /candidates/{id}` - Update profile
- `POST /candidates/{id}/experience` - Add experience
- `GET /candidates/{id}/credentials` - List credentials
- `POST /candidates/{id}/credentials/upload` - Get upload URL

### Clients (`/clients`)
- `GET /clients/candidates` - Browse candidates
- `GET /clients/{id}` - Get organisation
- `PUT /clients/{id}` - Update organisation
- `GET /clients/{id}/shortlists` - List shortlists
- `POST /clients/{id}/shortlists` - Create shortlist
- `POST /clients/{id}/shortlists/{sid}/candidates` - Add to shortlist
- `GET /clients/{id}/introductions` - List introductions
- `POST /clients/{id}/introductions` - Request introduction

### Admin (`/admin`)
- `GET /admin/analytics` - Dashboard metrics
- `GET /admin/clients/pending` - Pending approvals
- `POST /admin/clients/{id}/approve` - Approve client
- `POST /admin/clients/{id}/reject` - Reject client
- `GET /admin/credentials/pending` - Pending verifications
- `GET /admin/credentials/{id}/document` - View document
- `POST /admin/credentials/{id}/verify` - Verify credential
- `GET /admin/introductions/pending` - Pending introductions
- `POST /admin/introductions/{id}/status` - Update status

## Development

### Prerequisites
- Node.js 20+
- AWS CLI configured
- AWS CDK CLI (`npm install -g aws-cdk`)

### Setup
```bash
npm install
npm run build
```

### Deploy
```bash
# Deploy to dev
npm run cdk:deploy -- -c environment=dev

# Deploy to prod
npm run cdk:deploy -- -c environment=prod
```

### Test
```bash
npm run test
npm run test:coverage
```

## Environment Variables

Lambda functions receive:
- `TABLE_NAME` - DynamoDB table name
- `CREDENTIALS_BUCKET` - S3 bucket for documents
- `USER_POOL_ID` - Cognito User Pool ID
- `USER_POOL_CLIENT_ID` - Cognito Client ID
- `ENVIRONMENT` - dev/staging/prod
- `TENANT_ID` - Multi-tenant key (TENANT#MEDIBEE)

## DynamoDB Schema

Single-table design with tenant isolation:

| Entity | PK | SK | GSI1PK | GSI1SK |
|--------|----|----|--------|--------|
| Candidate | TENANT#MEDIBEE | CAND-xxx | TENANT#MEDIBEE#CANDIDATES | CAND-xxx |
| Client | TENANT#MEDIBEE | CLIENT-xxx | TENANT#MEDIBEE#CLIENTS | CLIENT-xxx |
| Credential | TENANT#MEDIBEE | CAND-xxx#CRED#xxx | TENANT#MEDIBEE#CREDENTIALS#STATUS | CRED-xxx |
| Shortlist | TENANT#MEDIBEE | CLIENT-xxx#SHORTLIST#xxx | TENANT#MEDIBEE#SHORTLISTS#CLIENT-xxx | SLIST-xxx |
| Introduction | TENANT#MEDIBEE | INTRO#xxx | TENANT#MEDIBEE#INTRODUCTIONS#STATUS | INTRO-xxx |

## Related Documentation

- [Product Backlog](../Medibee-Website/.documentation/CPO/PRODUCT_BACKLOG_V1.md)
- [ADR-001: Backend Architecture](../Medibee-Website/.documentation/CPO/ADR/ADR-001-BACKEND-ARCHITECTURE.md)
- [ADR-002: Authentication Strategy](../Medibee-Website/.documentation/CPO/ADR/ADR-002-AUTHENTICATION-STRATEGY.md)
- [ADR-003: Credential Storage](../Medibee-Website/.documentation/CPO/ADR/ADR-003-CREDENTIAL-STORAGE.md)

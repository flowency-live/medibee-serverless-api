# Route to Production

> **Current Environment:** Dev (`medibee.opstack.uk`)
> **Production Domain:** `www.medibee-recruitment.co.uk`
> **Last Updated:** 2026-03-13

---

## Overview

This document outlines all steps required to migrate from the development environment (`opstack.uk`) to the production domain (`medibee-recruitment.co.uk`).

---

## Pre-Production Checklist

### 1. Domain Configuration

| Item | Dev Value | Prod Value | Status |
|------|-----------|------------|--------|
| Frontend URL | `https://medibee.opstack.uk` | `https://www.medibee-recruitment.co.uk` | ⏳ Pending |
| API URL | `https://api.medibee.opstack.uk` | `https://api.medibee-recruitment.co.uk` | ⏳ Pending |
| Email From | `noreply@medibee.opstack.uk` | `noreply@medibee-recruitment.co.uk` | ⏳ Pending |

### 2. DNS Configuration

**Production domain needs:**
- [ ] Domain registered and DNS accessible
- [ ] Route53 hosted zone for `medibee-recruitment.co.uk`
- [ ] ACM certificate for `*.medibee-recruitment.co.uk` in `eu-west-2`
- [ ] ACM certificate for `*.medibee-recruitment.co.uk` in `us-east-1` (for CloudFront)

### 3. SES Configuration

**Current (Dev):**
- Domain: `opstack.uk` (verified)
- From: `noreply@medibee.opstack.uk`

**Production requires:**
- [ ] Verify `medibee-recruitment.co.uk` domain in SES
- [ ] Add DKIM records to DNS
- [ ] Add SPF record: `v=spf1 include:amazonses.com ~all`
- [ ] Add DMARC record: `v=DMARC1; p=quarantine; rua=mailto:dmarc@medibee-recruitment.co.uk`
- [ ] Request SES production access (exit sandbox) if not already done

### 4. Stripe Configuration

**Development:**
- Using Stripe test mode
- Webhook endpoint: `https://api.medibee.opstack.uk/subscriptions/webhook`

**Production requires:**
- [ ] Create Stripe production API keys
- [ ] Create production products and prices
- [ ] Configure production webhook endpoint
- [ ] Update SSM parameters with production keys

**Stripe SSM Parameters to update:**
```
/medibee/prod/stripe/secret-key
/medibee/prod/stripe/webhook-secret
/medibee/prod/stripe/price-bronze
/medibee/prod/stripe/price-silver
/medibee/prod/stripe/price-gold
```

### 5. Environment Variables

**Frontend (Amplify):**
```bash
# Update in Amplify Console > Environment Variables
NEXT_PUBLIC_SITE_URL=https://www.medibee-recruitment.co.uk
NEXT_PUBLIC_API_URL=https://api.medibee-recruitment.co.uk
```

**Backend (SSM Parameters):**
```bash
# JWT Secret (use a new, strong secret for prod)
/medibee/prod/jwt-secret

# SES
/medibee/prod/ses/from-email=noreply@medibee-recruitment.co.uk

# Frontend URL (for email links)
/medibee/prod/frontend-url=https://www.medibee-recruitment.co.uk
```

---

## Deployment Steps

### Phase 1: Infrastructure Preparation

```bash
# 1. Create ACM certificate for API domain
aws acm request-certificate \
  --domain-name "api.medibee-recruitment.co.uk" \
  --validation-method DNS \
  --region eu-west-2

# 2. Create ACM certificate for frontend (if using CloudFront)
aws acm request-certificate \
  --domain-name "www.medibee-recruitment.co.uk" \
  --subject-alternative-names "medibee-recruitment.co.uk" \
  --validation-method DNS \
  --region us-east-1

# 3. Verify domain in SES
aws ses verify-domain-identity \
  --domain medibee-recruitment.co.uk \
  --region eu-west-2

# 4. Get DKIM tokens and add to DNS
aws ses verify-domain-dkim \
  --domain medibee-recruitment.co.uk \
  --region eu-west-2
```

### Phase 2: Create Production SSM Parameters

```bash
# JWT Secret (generate a strong random value)
aws ssm put-parameter \
  --name "/medibee/prod/jwt-secret" \
  --type "SecureString" \
  --value "YOUR_STRONG_SECRET_HERE"

# SES From Email
aws ssm put-parameter \
  --name "/medibee/prod/ses/from-email" \
  --type "String" \
  --value "noreply@medibee-recruitment.co.uk"

# Frontend URL
aws ssm put-parameter \
  --name "/medibee/prod/frontend-url" \
  --type "String" \
  --value "https://www.medibee-recruitment.co.uk"

# Stripe Production Keys
aws ssm put-parameter \
  --name "/medibee/prod/stripe/secret-key" \
  --type "SecureString" \
  --value "sk_live_xxx"

aws ssm put-parameter \
  --name "/medibee/prod/stripe/webhook-secret" \
  --type "SecureString" \
  --value "whsec_xxx"
```

### Phase 3: Deploy Backend

```bash
# Deploy to production
cd cdk
npx cdk deploy --all --context stage=prod --require-approval broadening
```

### Phase 4: Configure API Custom Domain

After CDK deploy, configure custom domain in API Gateway:
1. Go to API Gateway Console
2. Select the production API
3. Custom domain names → Create
4. Domain: `api.medibee-recruitment.co.uk`
5. Select the ACM certificate
6. Create API mapping to production stage

### Phase 5: Update Frontend

1. Update Amplify environment variables
2. Trigger a new build
3. Configure custom domain in Amplify:
   - Add `www.medibee-recruitment.co.uk`
   - Add `medibee-recruitment.co.uk` (redirect to www)

### Phase 6: DNS Cutover

Add/update DNS records:
```
# API
api.medibee-recruitment.co.uk → [API Gateway domain name]

# Frontend (Amplify)
www.medibee-recruitment.co.uk → [Amplify CloudFront distribution]
medibee-recruitment.co.uk → [Amplify CloudFront distribution]
```

---

## Post-Deployment Verification

### Critical Checks

- [ ] Frontend loads at `https://www.medibee-recruitment.co.uk`
- [ ] API responds at `https://api.medibee-recruitment.co.uk/health`
- [ ] Candidate registration works (email received)
- [ ] Client registration works (email received)
- [ ] Stripe checkout completes successfully
- [ ] Stripe webhooks are received
- [ ] Admin login works
- [ ] Contact requests work (credit deduction)

### Monitoring Setup

- [ ] CloudWatch alarms configured for Lambda errors
- [ ] CloudWatch alarms configured for API Gateway 5xx
- [ ] Budget alerts configured

---

## Rollback Plan

If issues occur:

1. **DNS Rollback:** Point domains back to dev environment temporarily
2. **Frontend:** Revert Amplify environment variables, trigger rebuild
3. **Backend:** `cdk destroy --all --context stage=prod` (caution: destroys data)

---

## Notes

- Keep dev environment running for testing
- Production uses separate DynamoDB table (`medibee-table-prod`)
- Production uses separate S3 bucket (`medibee-files-prod`)
- All SSM parameters are stage-specific (`/medibee/dev/` vs `/medibee/prod/`)

---

## Contacts

| Role | Contact |
|------|---------|
| Technical Lead | [TBD] |
| Stripe Account | [TBD] |
| Domain Registrar | [TBD] |

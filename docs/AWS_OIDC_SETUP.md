# AWS OIDC Setup for GitHub Actions

This document explains how to configure AWS OIDC authentication for GitHub Actions deployment.

## Why OIDC?

OIDC (OpenID Connect) is more secure than long-lived access keys because:
- No secrets to rotate or leak
- Short-lived credentials (valid for single job run)
- Audit trail in AWS CloudTrail
- Can restrict by repository, branch, and environment

## Setup Steps

### Step 1: Create OIDC Identity Provider in AWS

Run this in AWS Console (IAM > Identity providers > Add provider) or via CLI:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

> Note: The thumbprint may need updating. Get current from: https://github.blog/changelog/2023-06-27-github-actions-update-on-oidc-integration-with-aws/

### Step 2: Create IAM Role for GitHub Actions

Create a role with the following trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::771551874768:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:flowency-live/medibee-serverless-api:*"
        }
      }
    }
  ]
}
```

### Step 3: Attach Permission Policy

Create and attach this policy to the role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CDKDeployment",
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "s3:*",
        "iam:*",
        "lambda:*",
        "apigateway:*",
        "dynamodb:*",
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:PutParameter",
        "ses:*",
        "logs:*",
        "events:*",
        "ecr:GetAuthorizationToken"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CDKBootstrap",
      "Effect": "Allow",
      "Action": [
        "sts:AssumeRole"
      ],
      "Resource": [
        "arn:aws:iam::771551874768:role/cdk-*"
      ]
    }
  ]
}
```

### Step 4: Add Role ARN to GitHub Secrets

1. Go to: https://github.com/flowency-live/medibee-serverless-api/settings/secrets/actions
2. Add new secret:
   - Name: `AWS_CICD_ROLE_ARN`
   - Value: `arn:aws:iam::771551874768:role/medibee-github-actions-role` (your role ARN)

## Quick Setup via AWS CLI

```bash
# 1. Create OIDC provider (if not exists)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
  --region eu-west-2

# 2. Create trust policy file
cat > trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::771551874768:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:flowency-live/medibee-serverless-api:*"
        }
      }
    }
  ]
}
EOF

# 3. Create the role
aws iam create-role \
  --role-name medibee-github-actions-role \
  --assume-role-policy-document file://trust-policy.json

# 4. Create permission policy file
cat > permissions-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CDKDeployment",
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "s3:*",
        "iam:*",
        "lambda:*",
        "apigateway:*",
        "dynamodb:*",
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:PutParameter",
        "ses:*",
        "logs:*",
        "events:*",
        "ecr:GetAuthorizationToken"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CDKBootstrap",
      "Effect": "Allow",
      "Action": [
        "sts:AssumeRole"
      ],
      "Resource": [
        "arn:aws:iam::771551874768:role/cdk-*"
      ]
    }
  ]
}
EOF

# 5. Create and attach the policy
aws iam put-role-policy \
  --role-name medibee-github-actions-role \
  --policy-name MedibeeCDKDeploymentPolicy \
  --policy-document file://permissions-policy.json

# 6. Get the role ARN
aws iam get-role --role-name medibee-github-actions-role --query 'Role.Arn' --output text
```

## Verification

After setup, push to main branch and check:
1. GitHub Actions should authenticate successfully
2. Logs should show "Authenticated via OIDC"
3. Deployment should proceed with CDK

## Troubleshooting

### "Could not load credentials from any providers"
- Verify the OIDC provider exists in IAM
- Check the role trust policy matches the repository name exactly
- Ensure `AWS_CICD_ROLE_ARN` secret is set correctly

### "Access Denied"
- Check the permissions policy has all required actions
- Verify CDK bootstrap roles exist (run `cdk bootstrap` manually first if needed)

### "Invalid identity token"
- The OIDC thumbprint may have changed
- Check GitHub's documentation for the current thumbprint

## Security Best Practices

1. **Restrict by branch**: Change `repo:flowency-live/medibee-serverless-api:*` to `repo:flowency-live/medibee-serverless-api:ref:refs/heads/main` for main-only deployments

2. **Use environment protection**: The workflow uses `environment: development` which can require approvals

3. **Audit regularly**: Check CloudTrail for role assumption events

4. **Least privilege**: Reduce permissions as you understand what's actually needed

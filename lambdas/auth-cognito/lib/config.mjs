/**
 * Auth Cognito Configuration
 *
 * Loads configuration from environment variables and SSM.
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const ssmClient = new SSMClient({});
const secretsClient = new SecretsManagerClient({});

// Cache for SSM parameters and secrets
const cache = new Map();

export const config = {
  stage: process.env.STAGE || 'dev',
  tableName: process.env.TABLE_NAME,
  cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID,
  cognitoClientId: process.env.COGNITO_CLIENT_ID,
  cognitoDomain: process.env.COGNITO_DOMAIN,
  frontendUrl: process.env.FRONTEND_URL,
  apiBaseUrl: process.env.API_BASE_URL,
  callbackUrl: process.env.CALLBACK_URL,
  cookieDomain: process.env.COOKIE_DOMAIN,
  jwtSecretParam: process.env.JWT_SECRET_PARAM,
};

export async function getJwtSecret() {
  const cacheKey = 'jwt-secret';
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const command = new GetParameterCommand({
    Name: config.jwtSecretParam,
    WithDecryption: true,
  });

  const response = await ssmClient.send(command);
  const secret = response.Parameter?.Value;

  if (!secret) {
    throw new Error('JWT secret not found in SSM');
  }

  cache.set(cacheKey, secret);
  return secret;
}

export async function getCognitoClientSecret() {
  const cacheKey = 'cognito-client-secret';
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const paramName = `/medibee/${config.stage}/cognito/client-secret-arn`;
  const paramCommand = new GetParameterCommand({
    Name: paramName,
    WithDecryption: false,
  });

  const paramResponse = await ssmClient.send(paramCommand);
  const secretArn = paramResponse.Parameter?.Value;

  if (!secretArn) {
    throw new Error('Cognito client secret ARN not found in SSM');
  }

  const secretCommand = new GetSecretValueCommand({
    SecretId: secretArn,
  });

  const secretResponse = await secretsClient.send(secretCommand);
  const secret = secretResponse.SecretString;

  if (!secret) {
    throw new Error('Cognito client secret not found in Secrets Manager');
  }

  cache.set(cacheKey, secret);
  return secret;
}

export function isProd() {
  return config.stage === 'prod';
}

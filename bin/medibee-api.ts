#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MedibeeApiStack } from '../lib/medibee-api-stack';

const app = new cdk.App();

const environment = app.node.tryGetContext('environment') || 'dev';

new MedibeeApiStack(app, `MedibeeApi-${environment}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'eu-west-2',
  },
  environment,
  domainName: environment === 'prod' 
    ? 'api.medibee.co.uk' 
    : `api.${environment}.medibee.opstack.uk`,
});

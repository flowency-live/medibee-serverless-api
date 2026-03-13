#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack';
import { ApiStack } from '../lib/api-stack';
import { CandidatesStack } from '../lib/candidates-stack';
import { ClientsStack } from '../lib/clients-stack';
import { SubscriptionStack } from '../lib/subscription-stack';
import { MatchingStack } from '../lib/matching-stack';
import { ContactsStack } from '../lib/contacts-stack';
import { AdminStack } from '../lib/admin-stack';

const app = new cdk.App();

const stage = app.node.tryGetContext('stage') || 'dev';
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'eu-west-2',
};

// Foundation Stack: DynamoDB, S3, SSM
const foundationStack = new FoundationStack(app, `medibee-foundation-${stage}`, {
  env,
  stage,
  description: 'Medibee Talent Showcase - Foundation (DynamoDB, S3, SSM)',
});

// Candidates Stack: Lambda functions for candidates
const candidatesStack = new CandidatesStack(app, `medibee-candidates-${stage}`, {
  env,
  stage,
  table: foundationStack.table,
  filesBucket: foundationStack.filesBucket,
  commonLayer: foundationStack.commonLayer,
  description: 'Medibee Talent Showcase - Candidate Lambda Functions',
});
candidatesStack.addDependency(foundationStack);

// Clients Stack: Lambda functions for clients/organisations
const clientsStack = new ClientsStack(app, `medibee-clients-${stage}`, {
  env,
  stage,
  table: foundationStack.table,
  commonLayer: foundationStack.commonLayer,
  description: 'Medibee Talent Showcase - Client Lambda Functions',
});
clientsStack.addDependency(foundationStack);

// Subscription Stack: Stripe billing and subscription management
const subscriptionStack = new SubscriptionStack(app, `medibee-subscription-${stage}`, {
  env,
  stage,
  table: foundationStack.table,
  commonLayer: foundationStack.commonLayer,
  description: 'Medibee Talent Showcase - Subscription Lambda Functions',
});
subscriptionStack.addDependency(foundationStack);

// Matching Stack: Browse candidates, shortlists
const matchingStack = new MatchingStack(app, `medibee-matching-${stage}`, {
  env,
  stage,
  table: foundationStack.table,
  commonLayer: foundationStack.commonLayer,
  description: 'Medibee Talent Showcase - Matching Lambda Functions',
});
matchingStack.addDependency(foundationStack);

// Contacts Stack: Contact requests with credit deduction
const contactsStack = new ContactsStack(app, `medibee-contacts-${stage}`, {
  env,
  stage,
  table: foundationStack.table,
  commonLayer: foundationStack.commonLayer,
  description: 'Medibee Talent Showcase - Contacts Lambda Functions',
});
contactsStack.addDependency(foundationStack);

// Admin Stack: Moderation, analytics, management
const adminStack = new AdminStack(app, `medibee-admin-${stage}`, {
  env,
  stage,
  table: foundationStack.table,
  commonLayer: foundationStack.commonLayer,
  description: 'Medibee Talent Showcase - Admin Lambda Functions',
});
adminStack.addDependency(foundationStack);

// API Stack: API Gateway, Authorizer, Routes
const apiStack = new ApiStack(app, `medibee-api-${stage}`, {
  env,
  stage,
  authLambda: candidatesStack.authLambda,
  candidatesLambda: candidatesStack.candidatesLambda,
  uploadsLambda: candidatesStack.uploadsLambda,
  clientsLambda: clientsStack.clientsLambda,
  subscriptionLambda: subscriptionStack.subscriptionLambda,
  matchingLambda: matchingStack.matchingLambda,
  contactsLambda: contactsStack.contactsLambda,
  adminLambda: adminStack.adminLambda,
  description: 'Medibee Talent Showcase - API Gateway',
});
apiStack.addDependency(candidatesStack);
apiStack.addDependency(clientsStack);
apiStack.addDependency(subscriptionStack);
apiStack.addDependency(matchingStack);
apiStack.addDependency(contactsStack);
apiStack.addDependency(adminStack);

// Tags for all resources
cdk.Tags.of(app).add('Project', 'medibee-talent-showcase');
cdk.Tags.of(app).add('Stage', stage);
cdk.Tags.of(app).add('ManagedBy', 'CDK');

import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigatewayv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

interface ApiStackProps extends cdk.StackProps {
  stage: string;
  authLambda: lambda.Function;
  candidatesLambda: lambda.Function;
  uploadsLambda: lambda.Function;
  clientsLambda: lambda.Function;
  subscriptionLambda: lambda.Function;
  matchingLambda: lambda.Function;
  contactsLambda: lambda.Function;
  adminLambda: lambda.Function;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigatewayv2.HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { stage, authLambda, candidatesLambda, uploadsLambda, clientsLambda, subscriptionLambda, matchingLambda, contactsLambda, adminLambda } = props;

    // ===========================================
    // Lambda Authorizer
    // ===========================================
    const authorizerLambda = new lambda.Function(this, 'AuthorizerLambda', {
      functionName: `medibee-authorizer-${stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/authorizer')),
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        STAGE: stage,
        JWT_SECRET_PARAM: `/medibee/${stage}/auth/jwt-secret`,
      },
    });

    authorizerLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/medibee/${stage}/auth/*`,
      ],
    }));

    const authorizer = new apigatewayv2Authorizers.HttpLambdaAuthorizer(
      'MedibeeAuthorizer',
      authorizerLambda,
      {
        authorizerName: `medibee-authorizer-${stage}`,
        responseTypes: [apigatewayv2Authorizers.HttpLambdaResponseType.SIMPLE],
        identitySource: ['$request.header.Authorization'],
        resultsCacheTtl: cdk.Duration.seconds(0), // No caching for security
      }
    );

    // ===========================================
    // HTTP API
    // ===========================================
    this.api = new apigatewayv2.HttpApi(this, 'MedibeeApi', {
      apiName: `medibee-api-${stage}`,
      description: 'Medibee Talent Showcase Platform API',
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PATCH,
          apigatewayv2.CorsHttpMethod.DELETE,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: stage === 'prod'
          ? ['https://www.medibee-recruitment.co.uk', 'https://medibee-recruitment.co.uk']
          : ['https://medibee.opstack.uk', 'http://localhost:3000'],
        allowCredentials: true,
        maxAge: cdk.Duration.hours(1),
      },
    });

    // ===========================================
    // Lambda Integrations
    // ===========================================
    const authIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
      'AuthIntegration',
      authLambda
    );

    const candidatesIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
      'CandidatesIntegration',
      candidatesLambda
    );

    const uploadsIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
      'UploadsIntegration',
      uploadsLambda
    );

    const clientsIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
      'ClientsIntegration',
      clientsLambda
    );

    const subscriptionIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
      'SubscriptionIntegration',
      subscriptionLambda
    );

    const matchingIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
      'MatchingIntegration',
      matchingLambda
    );

    const contactsIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
      'ContactsIntegration',
      contactsLambda
    );

    const adminIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
      'AdminIntegration',
      adminLambda
    );

    // ===========================================
    // Public Routes (no auth)
    // ===========================================
    this.api.addRoutes({
      path: '/auth/register',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: authIntegration,
    });

    this.api.addRoutes({
      path: '/auth/verify-email',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: authIntegration,
    });

    this.api.addRoutes({
      path: '/auth/login',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: authIntegration,
    });

    this.api.addRoutes({
      path: '/auth/forgot-password',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: authIntegration,
    });

    this.api.addRoutes({
      path: '/auth/reset-password',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: authIntegration,
    });

    // Client public routes
    this.api.addRoutes({
      path: '/clients/register',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: clientsIntegration,
    });

    this.api.addRoutes({
      path: '/clients/verify-email',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: clientsIntegration,
    });

    this.api.addRoutes({
      path: '/clients/login',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: clientsIntegration,
    });

    this.api.addRoutes({
      path: '/clients/forgot-password',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: clientsIntegration,
    });

    this.api.addRoutes({
      path: '/clients/reset-password',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: clientsIntegration,
    });

    this.api.addRoutes({
      path: '/clients/health',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: clientsIntegration,
    });

    // Subscription webhook (public, uses Stripe signature)
    this.api.addRoutes({
      path: '/subscriptions/webhook',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: subscriptionIntegration,
    });

    this.api.addRoutes({
      path: '/subscriptions/health',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: subscriptionIntegration,
    });

    // ===========================================
    // Protected Routes (require auth)
    // ===========================================
    this.api.addRoutes({
      path: '/auth/logout',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: authIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/candidates/me',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PATCH],
      integration: candidatesIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/candidates/me/availability',
      methods: [apigatewayv2.HttpMethod.PATCH],
      integration: candidatesIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/uploads/cv/presigned-url',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: uploadsIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/uploads/cv/confirm',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: uploadsIntegration,
      authorizer,
    });

    // Client protected routes
    this.api.addRoutes({
      path: '/clients/logout',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: clientsIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/clients/me',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PATCH, apigatewayv2.HttpMethod.DELETE],
      integration: clientsIntegration,
      authorizer,
    });

    // Candidate DELETE route (GDPR)
    this.api.addRoutes({
      path: '/candidates/me',
      methods: [apigatewayv2.HttpMethod.DELETE],
      integration: candidatesIntegration,
      authorizer,
    });

    // Subscription protected routes
    this.api.addRoutes({
      path: '/subscriptions/checkout',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: subscriptionIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/subscriptions/portal',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: subscriptionIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/subscriptions/me',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: subscriptionIntegration,
      authorizer,
    });

    // ===========================================
    // Matching Routes (require client auth)
    // ===========================================
    this.api.addRoutes({
      path: '/candidates',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: matchingIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/candidates/{candidateId}',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: matchingIntegration,
      authorizer,
    });

    // Shortlist routes
    this.api.addRoutes({
      path: '/shortlists',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST],
      integration: matchingIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/shortlists/{shortlistId}',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.DELETE],
      integration: matchingIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/shortlists/{shortlistId}/candidates',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: matchingIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/shortlists/{shortlistId}/candidates/{candidateId}',
      methods: [apigatewayv2.HttpMethod.DELETE],
      integration: matchingIntegration,
      authorizer,
    });

    // ===========================================
    // Contacts Routes (require client auth)
    // ===========================================
    this.api.addRoutes({
      path: '/contacts',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST],
      integration: contactsIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/contacts/{contactId}',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: contactsIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/contacts/health',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: contactsIntegration,
    });

    // ===========================================
    // Admin Routes
    // ===========================================
    // Public admin login
    this.api.addRoutes({
      path: '/admin/login',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: adminIntegration,
    });

    this.api.addRoutes({
      path: '/admin/health',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: adminIntegration,
    });

    // Protected admin routes (require admin auth)
    this.api.addRoutes({
      path: '/admin/candidates',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: adminIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/admin/candidates/{candidateId}',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: adminIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/admin/candidates/{candidateId}/approve',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: adminIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/admin/candidates/{candidateId}/reject',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: adminIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/admin/candidates/{candidateId}/suspend',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: adminIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/admin/candidates/{candidateId}/reinstate',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: adminIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/admin/clients',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: adminIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/admin/clients/{clientId}',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: adminIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/admin/clients/{clientId}/suspend',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: adminIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/admin/clients/{clientId}/reinstate',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: adminIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/admin/contacts',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: adminIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/admin/contacts/{contactId}',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: adminIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/admin/contacts/{contactId}/resolve',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: adminIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/admin/analytics',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: adminIntegration,
      authorizer,
    });

    this.api.addRoutes({
      path: '/admin/analytics/export',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: adminIntegration,
      authorizer,
    });

    // ===========================================
    // Health Check (public)
    // ===========================================
    this.api.addRoutes({
      path: '/health',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: authIntegration, // Reuse auth lambda for health check
    });

    // ===========================================
    // Outputs
    // ===========================================
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.apiEndpoint,
      description: 'API Gateway URL',
      exportName: `medibee-api-url-${stage}`,
    });
  }
}

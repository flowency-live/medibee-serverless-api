import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayIntegrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface MedibeeApiStackProps extends cdk.StackProps {
  environment: string;
  domainName: string;
}

export class MedibeeApiStack extends cdk.Stack {
  public readonly api: apigateway.HttpApi;
  public readonly userPool: cognito.UserPool;
  public readonly table: dynamodb.Table;
  public readonly credentialsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: MedibeeApiStackProps) {
    super(scope, id, props);

    const { environment } = props;

    // ============================================
    // DynamoDB Table (Single-Table Design)
    // ============================================
    this.table = new dynamodb.Table(this, 'MedibeeTable', {
      tableName: `medibee-${environment}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    // GSI1: For querying by type within tenant
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: For email lookups
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ============================================
    // S3 Bucket for Credentials (Encrypted)
    // ============================================
    this.credentialsBucket = new s3.Bucket(this, 'CredentialsBucket', {
      bucketName: `medibee-credentials-${environment}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      removalPolicy: environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: environment !== 'prod',
      lifecycleRules: [
        {
          id: 'move-to-ia',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    // ============================================
    // Cognito User Pool
    // ============================================
    this.userPool = new cognito.UserPool(this, 'MedibeeUserPool', {
      userPoolName: `medibee-users-${environment}`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
        phone: true,
      },
      autoVerify: {
        email: true,
        phone: true,
      },
      standardAttributes: {
        email: { required: true, mutable: true },
        phoneNumber: { required: false, mutable: true },
        givenName: { required: true, mutable: true },
        familyName: { required: true, mutable: true },
      },
      customAttributes: {
        userType: new cognito.StringAttribute({ mutable: false }),
        tenantId: new cognito.StringAttribute({ mutable: false }),
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // User Pool Client
    const userPoolClient = this.userPool.addClient('MedibeeWebClient', {
      userPoolClientName: `medibee-web-${environment}`,
      authFlows: {
        userPassword: true,
        userSrp: true,
        custom: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
        callbackUrls: environment === 'prod'
          ? ['https://www.medibee.co.uk/auth/callback']
          : ['https://medibee.opstack.uk/auth/callback', 'http://localhost:3000/auth/callback'],
        logoutUrls: environment === 'prod'
          ? ['https://www.medibee.co.uk']
          : ['https://medibee.opstack.uk', 'http://localhost:3000'],
      },
      generateSecret: false,
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // User Pool Domain
    this.userPool.addDomain('MedibeeCognitoDomain', {
      cognitoDomain: {
        domainPrefix: `medibee-${environment}`,
      },
    });

    // ============================================
    // Lambda Functions
    // ============================================
    const lambdaEnvironment = {
      TABLE_NAME: this.table.tableName,
      CREDENTIALS_BUCKET: this.credentialsBucket.bucketName,
      USER_POOL_ID: this.userPool.userPoolId,
      USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
      ENVIRONMENT: environment,
      TENANT_ID: 'TENANT#MEDIBEE',
    };

    // Auth Lambda
    const authLambda = new lambda.Function(this, 'AuthLambda', {
      functionName: `medibee-auth-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('src/handlers/auth'),
      environment: lambdaEnvironment,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    });

    // Candidates Lambda
    const candidatesLambda = new lambda.Function(this, 'CandidatesLambda', {
      functionName: `medibee-candidates-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('src/handlers/candidates'),
      environment: lambdaEnvironment,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    });

    // Clients Lambda
    const clientsLambda = new lambda.Function(this, 'ClientsLambda', {
      functionName: `medibee-clients-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('src/handlers/clients'),
      environment: lambdaEnvironment,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    });

    // Admin Lambda
    const adminLambda = new lambda.Function(this, 'AdminLambda', {
      functionName: `medibee-admin-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('src/handlers/admin'),
      environment: lambdaEnvironment,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    });

    // Grant permissions
    this.table.grantReadWriteData(authLambda);
    this.table.grantReadWriteData(candidatesLambda);
    this.table.grantReadWriteData(clientsLambda);
    this.table.grantReadWriteData(adminLambda);

    this.credentialsBucket.grantReadWrite(candidatesLambda);
    this.credentialsBucket.grantRead(adminLambda);

    // ============================================
    // HTTP API Gateway
    // ============================================
    this.api = new apigateway.HttpApi(this, 'MedibeeApi', {
      apiName: `medibee-api-${environment}`,
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id'],
        allowMethods: [
          apigateway.CorsHttpMethod.GET,
          apigateway.CorsHttpMethod.POST,
          apigateway.CorsHttpMethod.PUT,
          apigateway.CorsHttpMethod.DELETE,
          apigateway.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: environment === 'prod'
          ? ['https://www.medibee.co.uk']
          : ['https://medibee.opstack.uk', 'http://localhost:3000'],
        maxAge: cdk.Duration.days(1),
      },
    });

    // Auth routes
    this.api.addRoutes({
      path: '/auth/{proxy+}',
      methods: [apigateway.HttpMethod.ANY],
      integration: new apigatewayIntegrations.HttpLambdaIntegration('AuthIntegration', authLambda),
    });

    // Candidates routes
    this.api.addRoutes({
      path: '/candidates/{proxy+}',
      methods: [apigateway.HttpMethod.ANY],
      integration: new apigatewayIntegrations.HttpLambdaIntegration('CandidatesIntegration', candidatesLambda),
    });
    this.api.addRoutes({
      path: '/candidates',
      methods: [apigateway.HttpMethod.ANY],
      integration: new apigatewayIntegrations.HttpLambdaIntegration('CandidatesRootIntegration', candidatesLambda),
    });

    // Clients routes
    this.api.addRoutes({
      path: '/clients/{proxy+}',
      methods: [apigateway.HttpMethod.ANY],
      integration: new apigatewayIntegrations.HttpLambdaIntegration('ClientsIntegration', clientsLambda),
    });
    this.api.addRoutes({
      path: '/clients',
      methods: [apigateway.HttpMethod.ANY],
      integration: new apigatewayIntegrations.HttpLambdaIntegration('ClientsRootIntegration', clientsLambda),
    });

    // Admin routes
    this.api.addRoutes({
      path: '/admin/{proxy+}',
      methods: [apigateway.HttpMethod.ANY],
      integration: new apigatewayIntegrations.HttpLambdaIntegration('AdminIntegration', adminLambda),
    });
    this.api.addRoutes({
      path: '/admin',
      methods: [apigateway.HttpMethod.ANY],
      integration: new apigatewayIntegrations.HttpLambdaIntegration('AdminRootIntegration', adminLambda),
    });

    // Health check
    this.api.addRoutes({
      path: '/health',
      methods: [apigateway.HttpMethod.GET],
      integration: new apigatewayIntegrations.HttpLambdaIntegration('HealthIntegration', authLambda),
    });

    // ============================================
    // Outputs
    // ============================================
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url || '',
      description: 'API Gateway URL',
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: 'DynamoDB Table Name',
    });

    new cdk.CfnOutput(this, 'CredentialsBucketName', {
      value: this.credentialsBucket.bucketName,
      description: 'S3 Credentials Bucket',
    });
  }
}

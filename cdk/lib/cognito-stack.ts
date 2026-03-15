import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';
import { getCommonLayer } from './shared/layer-lookup';

interface CognitoStackProps extends cdk.StackProps {
  stage: string;
  table: dynamodb.ITable;
  commonLayer?: lambda.ILayerVersion;
}

export class CognitoStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly authCognitoLambda: lambda.Function;
  public readonly cognitoDomain: string;

  constructor(scope: Construct, id: string, props: CognitoStackProps) {
    super(scope, id, props);

    const { stage, table } = props;
    const commonLayer = getCommonLayer(this, stage, props.commonLayer);

    const isProd = stage === 'prod';
    const domainPrefix = isProd ? 'medibee-auth' : `medibee-auth-${stage}`;

    // ===========================================
    // Cognito User Pool
    // ===========================================
    this.userPool = new cognito.UserPool(this, 'CandidateUserPool', {
      userPoolName: `medibee-candidate-pool-${stage}`,
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
        email: { required: false, mutable: true },
        phoneNumber: { required: false, mutable: true },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: true,
        otp: false,
      },
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ===========================================
    // Cognito Domain
    // ===========================================
    const domain = this.userPool.addDomain('CognitoDomain', {
      cognitoDomain: {
        domainPrefix: domainPrefix,
      },
    });

    this.cognitoDomain = `https://${domainPrefix}.auth.${this.region}.amazoncognito.com`;

    // ===========================================
    // OAuth Secrets (from Secrets Manager)
    // ===========================================
    // These secrets should be created manually or via a separate process
    // They contain the OAuth credentials from Google/Apple

    // Google OAuth - conditional on secret existing
    const googleSecretArn = ssm.StringParameter.valueForStringParameter(
      this,
      `/medibee/${stage}/oauth/google-secret-arn`
    );

    // We use Lazy evaluation because the secret might not exist in dev
    const googleProvider = new cognito.UserPoolIdentityProviderGoogle(
      this,
      'GoogleProvider',
      {
        userPool: this.userPool,
        clientId: ssm.StringParameter.valueForStringParameter(
          this,
          `/medibee/${stage}/oauth/google-client-id`
        ),
        clientSecretValue: cdk.SecretValue.secretsManager(googleSecretArn),
        scopes: ['email', 'profile', 'openid'],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
          familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
          profilePicture: cognito.ProviderAttribute.GOOGLE_PICTURE,
        },
      }
    );

    // Apple OAuth - also conditional
    const appleProvider = new cognito.UserPoolIdentityProviderApple(
      this,
      'AppleProvider',
      {
        userPool: this.userPool,
        clientId: ssm.StringParameter.valueForStringParameter(
          this,
          `/medibee/${stage}/oauth/apple-service-id`
        ),
        teamId: ssm.StringParameter.valueForStringParameter(
          this,
          `/medibee/${stage}/oauth/apple-team-id`
        ),
        keyId: ssm.StringParameter.valueForStringParameter(
          this,
          `/medibee/${stage}/oauth/apple-key-id`
        ),
        privateKeyValue: cdk.SecretValue.secretsManager(
          ssm.StringParameter.valueForStringParameter(
            this,
            `/medibee/${stage}/oauth/apple-private-key-arn`
          )
        ),
        scopes: ['email', 'name'],
        attributeMapping: {
          email: cognito.ProviderAttribute.APPLE_EMAIL,
          givenName: cognito.ProviderAttribute.APPLE_FIRST_NAME,
          familyName: cognito.ProviderAttribute.APPLE_LAST_NAME,
        },
      }
    );

    // ===========================================
    // User Pool Client
    // ===========================================
    const callbackUrls = isProd
      ? [
          'https://api.medibee-recruitment.co.uk/auth/callback',
        ]
      : [
          'https://api.medibee.opstack.uk/auth/callback',
          'http://localhost:3001/auth/callback', // Local API dev
        ];

    const logoutUrls = isProd
      ? [
          'https://www.medibee-recruitment.co.uk',
          'https://medibee-recruitment.co.uk',
        ]
      : [
          'https://medibee.opstack.uk',
          'http://localhost:3000',
        ];

    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `medibee-web-client-${stage}`,
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false,
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls,
        logoutUrls,
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.GOOGLE,
        cognito.UserPoolClientIdentityProvider.APPLE,
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
      generateSecret: true, // Required for server-side OAuth
      preventUserExistenceErrors: true,
      authFlows: {
        userPassword: false, // We use custom Lambda auth, not Cognito passwords
        userSrp: false,
        custom: true, // For phone OTP custom flow
      },
    });

    // Ensure providers are created before client
    this.userPoolClient.node.addDependency(googleProvider);
    this.userPoolClient.node.addDependency(appleProvider);

    // ===========================================
    // Auth Cognito Lambda
    // ===========================================
    this.authCognitoLambda = new lambda.Function(this, 'AuthCognitoLambda', {
      functionName: `medibee-auth-cognito-${stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../lambdas/auth-cognito')
      ),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      layers: [commonLayer],
      environment: {
        STAGE: stage,
        TABLE_NAME: table.tableName,
        COGNITO_USER_POOL_ID: this.userPool.userPoolId,
        COGNITO_CLIENT_ID: this.userPoolClient.userPoolClientId,
        COGNITO_DOMAIN: this.cognitoDomain,
        JWT_SECRET_PARAM: `/medibee/${stage}/auth/jwt-secret`,
        FRONTEND_URL: isProd
          ? 'https://www.medibee-recruitment.co.uk'
          : 'https://medibee.opstack.uk',
        API_BASE_URL: isProd
          ? 'https://api.medibee-recruitment.co.uk'
          : 'https://api.medibee.opstack.uk',
        CALLBACK_URL: isProd
          ? 'https://api.medibee-recruitment.co.uk/auth/callback'
          : 'https://api.medibee.opstack.uk/auth/callback',
        COOKIE_DOMAIN: isProd ? '.medibee-recruitment.co.uk' : '.opstack.uk',
      },
    });

    // DynamoDB permissions
    table.grantReadWriteData(this.authCognitoLambda);

    // SSM permissions (for JWT secret and OAuth config)
    this.authCognitoLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/medibee/${stage}/*`,
        ],
      })
    );

    // Secrets Manager permissions (for Cognito client secret)
    this.authCognitoLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:medibee/${stage}/*`,
        ],
      })
    );

    // SNS permissions for phone OTP
    this.authCognitoLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sns:Publish'],
        resources: ['*'], // SNS Publish requires * for phone numbers
        conditions: {
          StringEquals: {
            'sns:Protocol': 'sms',
          },
        },
      })
    );

    // SES permissions for magic link emails
    this.authCognitoLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [
          `arn:aws:ses:${this.region}:${this.account}:identity/*`,
        ],
      })
    );

    // Cognito permissions
    this.authCognitoLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminUpdateUserAttributes',
        ],
        resources: [this.userPool.userPoolArn],
      })
    );

    // ===========================================
    // Store Cognito config in SSM for other services
    // ===========================================
    new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: `/medibee/${stage}/cognito/user-pool-id`,
      stringValue: this.userPool.userPoolId,
    });

    new ssm.StringParameter(this, 'UserPoolClientIdParam', {
      parameterName: `/medibee/${stage}/cognito/client-id`,
      stringValue: this.userPoolClient.userPoolClientId,
    });

    new ssm.StringParameter(this, 'CognitoDomainParam', {
      parameterName: `/medibee/${stage}/cognito/domain`,
      stringValue: this.cognitoDomain,
    });

    // ===========================================
    // Outputs
    // ===========================================
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `medibee-user-pool-id-${stage}`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `medibee-user-pool-client-id-${stage}`,
    });

    new cdk.CfnOutput(this, 'CognitoDomainOutput', {
      value: this.cognitoDomain,
      description: 'Cognito Hosted UI Domain',
      exportName: `medibee-cognito-domain-${stage}`,
    });
  }
}

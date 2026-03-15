import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';
import { getCommonLayer } from './shared/layer-lookup';

interface AdminStackProps extends cdk.StackProps {
  stage: string;
  table: dynamodb.Table;
  commonLayer?: lambda.ILayerVersion;
}

export class AdminStack extends cdk.Stack {
  public readonly adminLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: AdminStackProps) {
    super(scope, id, props);

    const { stage, table } = props;
    const commonLayer = getCommonLayer(this, stage, props.commonLayer);

    // Common Lambda environment variables
    const commonEnv = {
      STAGE: stage,
      TABLE_NAME: table.tableName,
      JWT_SECRET_PARAM: `/medibee/${stage}/auth/jwt-secret`,
      SES_FROM_EMAIL: 'noreply@medibee-recruitment.co.uk',
      ADMIN_EMAIL: 'admin@medibee-recruitment.co.uk',
      SITE_URL: stage === 'prod'
        ? 'https://www.medibee-recruitment.co.uk'
        : 'https://medibee.opstack.uk',
      NODE_OPTIONS: '--enable-source-maps',
    };

    // Common Lambda configuration
    const commonConfig = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512, // Higher memory for analytics queries
      layers: [commonLayer] as lambda.ILayerVersion[],
      environment: commonEnv,
    };

    // ===========================================
    // Admin Lambda
    // ===========================================
    this.adminLambda = new lambda.Function(this, 'AdminLambda', {
      ...commonConfig,
      functionName: `medibee-admin-${stage}`,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/admin')),
      description: 'Medibee Admin: moderation, analytics, management',
    });

    // Admin Lambda permissions - read/write for all moderation operations
    table.grantReadWriteData(this.adminLambda);

    // SSM Parameter Store access (for JWT secret)
    this.adminLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/medibee/${stage}/auth/*`,
      ],
    }));

    // SES permissions for notification emails
    this.adminLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'ses:FromAddress': 'noreply@medibee-recruitment.co.uk',
        },
      },
    }));

    // ===========================================
    // Outputs
    // ===========================================
    new cdk.CfnOutput(this, 'AdminLambdaArn', {
      value: this.adminLambda.functionArn,
      exportName: `medibee-admin-lambda-arn-${stage}`,
    });
  }
}

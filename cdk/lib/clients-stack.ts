import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

interface ClientsStackProps extends cdk.StackProps {
  stage: string;
  table: dynamodb.Table;
  commonLayer: lambda.LayerVersion;
}

export class ClientsStack extends cdk.Stack {
  public readonly clientsLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: ClientsStackProps) {
    super(scope, id, props);

    const { stage, table, commonLayer } = props;

    // Common Lambda environment variables
    const commonEnv = {
      STAGE: stage,
      TABLE_NAME: table.tableName,
      JWT_SECRET_PARAM: `/medibee/${stage}/auth/jwt-secret`,
      SES_FROM_EMAIL: 'noreply@medibee-recruitment.co.uk',
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
      memorySize: 256,
      layers: [commonLayer] as lambda.ILayerVersion[],
      environment: commonEnv,
    };

    // ===========================================
    // Clients Lambda
    // ===========================================
    this.clientsLambda = new lambda.Function(this, 'ClientsLambda', {
      ...commonConfig,
      functionName: `medibee-clients-${stage}`,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/clients')),
      description: 'Medibee Clients: register, verify, login, profile CRUD, password reset',
    });

    // Clients Lambda permissions
    table.grantReadWriteData(this.clientsLambda);

    // SSM Parameter Store access (for JWT secret)
    this.clientsLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/medibee/${stage}/auth/*`,
      ],
    }));

    // SES permissions for emails
    this.clientsLambda.addToRolePolicy(new iam.PolicyStatement({
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
    new cdk.CfnOutput(this, 'ClientsLambdaArn', {
      value: this.clientsLambda.functionArn,
      exportName: `medibee-clients-lambda-arn-${stage}`,
    });
  }
}

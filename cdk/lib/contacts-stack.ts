import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

interface ContactsStackProps extends cdk.StackProps {
  stage: string;
  table: dynamodb.Table;
  commonLayer: lambda.LayerVersion;
}

export class ContactsStack extends cdk.Stack {
  public readonly contactsLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: ContactsStackProps) {
    super(scope, id, props);

    const { stage, table, commonLayer } = props;

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
      memorySize: 256,
      layers: [commonLayer] as lambda.ILayerVersion[],
      environment: commonEnv,
    };

    // ===========================================
    // Contacts Lambda
    // ===========================================
    this.contactsLambda = new lambda.Function(this, 'ContactsLambda', {
      ...commonConfig,
      functionName: `medibee-contacts-${stage}`,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/contacts')),
      description: 'Medibee Contacts: request contact, list contacts, credit deduction',
    });

    // Contacts Lambda permissions
    table.grantReadWriteData(this.contactsLambda);

    // SSM Parameter Store access (for JWT secret)
    this.contactsLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/medibee/${stage}/auth/*`,
      ],
    }));

    // SES permissions for notification emails
    this.contactsLambda.addToRolePolicy(new iam.PolicyStatement({
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
    new cdk.CfnOutput(this, 'ContactsLambdaArn', {
      value: this.contactsLambda.functionArn,
      exportName: `medibee-contacts-lambda-arn-${stage}`,
    });
  }
}

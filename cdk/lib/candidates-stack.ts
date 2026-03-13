import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';

interface CandidatesStackProps extends cdk.StackProps {
  stage: string;
  table: dynamodb.Table;
  filesBucket: s3.Bucket;
}

export class CandidatesStack extends cdk.Stack {
  public readonly authLambda: lambda.Function;
  public readonly candidatesLambda: lambda.Function;
  public readonly uploadsLambda: lambda.Function;
  public readonly commonLayer: lambda.LayerVersion;

  constructor(scope: Construct, id: string, props: CandidatesStackProps) {
    super(scope, id, props);

    const { stage, table, filesBucket } = props;

    // ===========================================
    // Lambda Layer (shared utilities)
    // ===========================================
    this.commonLayer = new lambda.LayerVersion(this, 'CommonLayer', {
      layerVersionName: `medibee-common-${stage}`,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda-layers/medibee-common')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: 'Medibee shared utilities (logger, cors, auth, responses)',
    });

    // Common Lambda environment variables
    const commonEnv = {
      STAGE: stage,
      TABLE_NAME: table.tableName,
      FILES_BUCKET: filesBucket.bucketName,
      JWT_SECRET_PARAM: `/medibee/${stage}/auth/jwt-secret`,
      SES_FROM_EMAIL: 'noreply@medibee-recruitment.co.uk',
      NODE_OPTIONS: '--enable-source-maps',
    };

    // Common Lambda configuration
    const commonConfig: Partial<lambda.FunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      layers: [this.commonLayer],
      environment: commonEnv,
    };

    // ===========================================
    // Auth Lambda
    // ===========================================
    this.authLambda = new lambda.Function(this, 'AuthLambda', {
      ...commonConfig,
      functionName: `medibee-auth-${stage}`,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/auth')),
      description: 'Medibee Auth: register, verify, login, logout',
    });

    // Auth Lambda permissions
    table.grantReadWriteData(this.authLambda);
    this.authLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/medibee/${stage}/auth/*`,
      ],
    }));
    this.authLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'ses:FromAddress': 'noreply@medibee-recruitment.co.uk',
        },
      },
    }));

    // ===========================================
    // Candidates Lambda
    // ===========================================
    this.candidatesLambda = new lambda.Function(this, 'CandidatesLambda', {
      ...commonConfig,
      functionName: `medibee-candidates-${stage}`,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/candidates')),
      description: 'Medibee Candidates: profile CRUD, availability',
    });

    // Candidates Lambda permissions
    table.grantReadWriteData(this.candidatesLambda);
    filesBucket.grantRead(this.candidatesLambda);
    this.candidatesLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/medibee/${stage}/auth/*`,
      ],
    }));

    // ===========================================
    // Uploads Lambda
    // ===========================================
    this.uploadsLambda = new lambda.Function(this, 'UploadsLambda', {
      ...commonConfig,
      functionName: `medibee-uploads-${stage}`,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/uploads')),
      description: 'Medibee Uploads: CV presigned URLs, validation',
    });

    // Uploads Lambda permissions
    table.grantReadWriteData(this.uploadsLambda);
    filesBucket.grantReadWrite(this.uploadsLambda);
    this.uploadsLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/medibee/${stage}/auth/*`,
      ],
    }));

    // ===========================================
    // Outputs
    // ===========================================
    new cdk.CfnOutput(this, 'AuthLambdaArn', {
      value: this.authLambda.functionArn,
      exportName: `medibee-auth-lambda-arn-${stage}`,
    });

    new cdk.CfnOutput(this, 'CandidatesLambdaArn', {
      value: this.candidatesLambda.functionArn,
      exportName: `medibee-candidates-lambda-arn-${stage}`,
    });

    new cdk.CfnOutput(this, 'UploadsLambdaArn', {
      value: this.uploadsLambda.functionArn,
      exportName: `medibee-uploads-lambda-arn-${stage}`,
    });
  }
}

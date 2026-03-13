import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';

interface FoundationStackProps extends cdk.StackProps {
  stage: string;
}

export class FoundationStack extends cdk.Stack {
  public readonly table: dynamodb.Table;
  public readonly filesBucket: s3.Bucket;
  public readonly commonLayer: lambda.LayerVersion;

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);

    const { stage } = props;

    // ===========================================
    // DynamoDB Single-Table Design
    // ===========================================
    this.table = new dynamodb.Table(this, 'MedibeeTable', {
      tableName: `medibee-main-${stage}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: stage === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'TTL',
    });

    // GSI1: Email lookup (for login)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: Status lookup (for admin filtering)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI3: Location lookup (for client search)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: { name: 'GSI3PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI3SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ===========================================
    // S3 Bucket for CVs and Profile Photos
    // ===========================================
    this.filesBucket = new s3.Bucket(this, 'FilesBucket', {
      bucketName: `medibee-files-${stage}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      removalPolicy: stage === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: stage !== 'prod',
      lifecycleRules: [
        {
          id: 'DeleteOldVersions',
          noncurrentVersionExpiration: cdk.Duration.days(30),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: stage === 'prod'
            ? ['https://www.medibee-recruitment.co.uk', 'https://medibee-recruitment.co.uk']
            : ['https://medibee.opstack.uk', 'http://localhost:3000'],
          allowedHeaders: ['*'],
          maxAge: 300,
        },
      ],
    });

    // ===========================================
    // SSM Parameters
    // ===========================================
    // JWT Secret - create parameter, value set manually in console
    new ssm.StringParameter(this, 'JWTSecretParam', {
      parameterName: `/medibee/${stage}/auth/jwt-secret`,
      stringValue: 'PLACEHOLDER-SET-VIA-CONSOLE',
      description: 'JWT signing secret for Medibee auth (replace via console)',
      tier: ssm.ParameterTier.STANDARD,
    });

    // ===========================================
    // Lambda Layer (shared utilities)
    // ===========================================
    this.commonLayer = new lambda.LayerVersion(this, 'CommonLayer', {
      layerVersionName: `medibee-common-${stage}`,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda-layers/medibee-common')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: 'Medibee shared utilities (logger, cors, auth, responses)',
    });

    // ===========================================
    // Outputs
    // ===========================================
    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: 'DynamoDB table name',
      exportName: `medibee-table-name-${stage}`,
    });

    new cdk.CfnOutput(this, 'FilesBucketName', {
      value: this.filesBucket.bucketName,
      description: 'S3 bucket for CVs',
      exportName: `medibee-files-bucket-${stage}`,
    });
  }
}

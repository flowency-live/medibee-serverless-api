import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';
import { getCommonLayer } from './shared/layer-lookup';

interface MatchingStackProps extends cdk.StackProps {
  stage: string;
  table: dynamodb.Table;
  commonLayer?: lambda.ILayerVersion;
}

export class MatchingStack extends cdk.Stack {
  public readonly matchingLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: MatchingStackProps) {
    super(scope, id, props);

    const { stage, table } = props;
    const commonLayer = getCommonLayer(this, stage, props.commonLayer);

    // Common Lambda environment variables
    const commonEnv = {
      STAGE: stage,
      TABLE_NAME: table.tableName,
      JWT_SECRET_PARAM: `/medibee/${stage}/auth/jwt-secret`,
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
    // Matching Lambda
    // ===========================================
    this.matchingLambda = new lambda.Function(this, 'MatchingLambda', {
      ...commonConfig,
      functionName: `medibee-matching-${stage}`,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/matching')),
      description: 'Medibee Matching: browse candidates, view candidate, shortlists',
    });

    // Matching Lambda permissions
    table.grantReadWriteData(this.matchingLambda);

    // SSM Parameter Store access (for JWT secret)
    this.matchingLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/medibee/${stage}/auth/*`,
      ],
    }));

    // ===========================================
    // Outputs
    // ===========================================
    new cdk.CfnOutput(this, 'MatchingLambdaArn', {
      value: this.matchingLambda.functionArn,
      exportName: `medibee-matching-lambda-arn-${stage}`,
    });
  }
}

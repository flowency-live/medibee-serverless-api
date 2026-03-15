import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';
import { getCommonLayer } from './shared/layer-lookup';

interface SubscriptionStackProps extends cdk.StackProps {
  stage: string;
  table: dynamodb.Table;
  commonLayer?: lambda.ILayerVersion;
}

export class SubscriptionStack extends cdk.Stack {
  public readonly subscriptionLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: SubscriptionStackProps) {
    super(scope, id, props);

    const { stage, table } = props;
    const commonLayer = getCommonLayer(this, stage, props.commonLayer);

    // Stripe Price IDs (placeholder values, set via SSM or environment)
    const stripePriceIds = {
      bronze: process.env.STRIPE_BRONZE_PRICE_ID || 'price_bronze_placeholder',
      silver: process.env.STRIPE_SILVER_PRICE_ID || 'price_silver_placeholder',
      gold: process.env.STRIPE_GOLD_PRICE_ID || 'price_gold_placeholder',
    };

    // Common Lambda environment variables
    const commonEnv = {
      STAGE: stage,
      TABLE_NAME: table.tableName,
      JWT_SECRET_PARAM: `/medibee/${stage}/auth/jwt-secret`,
      STRIPE_SECRET_PARAM: `/medibee/${stage}/stripe/secret-key`,
      STRIPE_WEBHOOK_SECRET_PARAM: `/medibee/${stage}/stripe/webhook-secret`,
      STRIPE_BRONZE_PRICE_ID: stripePriceIds.bronze,
      STRIPE_SILVER_PRICE_ID: stripePriceIds.silver,
      STRIPE_GOLD_PRICE_ID: stripePriceIds.gold,
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
    // Subscription Lambda
    // ===========================================
    this.subscriptionLambda = new lambda.Function(this, 'SubscriptionLambda', {
      ...commonConfig,
      functionName: `medibee-subscription-${stage}`,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/subscription')),
      description: 'Medibee Subscription: checkout, billing portal, Stripe webhooks',
    });

    // Subscription Lambda permissions
    table.grantReadWriteData(this.subscriptionLambda);

    // SSM Parameter Store access (for JWT and Stripe secrets)
    this.subscriptionLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/medibee/${stage}/auth/*`,
        `arn:aws:ssm:${this.region}:${this.account}:parameter/medibee/${stage}/stripe/*`,
      ],
    }));

    // ===========================================
    // Outputs
    // ===========================================
    new cdk.CfnOutput(this, 'SubscriptionLambdaArn', {
      value: this.subscriptionLambda.functionArn,
      exportName: `medibee-subscription-lambda-arn-${stage}`,
    });
  }
}

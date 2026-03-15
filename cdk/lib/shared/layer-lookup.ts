import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

/**
 * Look up the common Lambda layer.
 *
 * Strategy:
 * - If commonLayer is passed (first deploy or foundation in same deploy), use it
 * - Otherwise, look up from SSM (subsequent deploys)
 *
 * This avoids CloudFormation cross-stack export issues where updating
 * a layer causes "export in use" errors.
 */
export function getCommonLayer(
  scope: Construct,
  stage: string,
  commonLayerProp?: lambda.ILayerVersion
): lambda.ILayerVersion {
  // If passed directly, use it (first deploy scenario)
  if (commonLayerProp) {
    return commonLayerProp;
  }

  // Look up from SSM (normal deploy scenario)
  const layerArn = ssm.StringParameter.valueForStringParameter(
    scope,
    `/medibee/${stage}/layer/common-layer-arn`
  );

  return lambda.LayerVersion.fromLayerVersionArn(
    scope,
    'ImportedCommonLayer',
    layerArn
  );
}

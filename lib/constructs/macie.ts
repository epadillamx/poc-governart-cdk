import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as macie from 'aws-cdk-lib/aws-macie';
import * as s3 from 'aws-cdk-lib/aws-s3';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export interface MacieProps {
  readonly prefix: string;
  readonly rawBucket: s3.IBucket;
}

/**
 * Macie session via CFN, classification job via custom resource
 * (AWS::Macie::Job is not a CloudFormation resource type).
 */
export class Macie extends Construct {
  public readonly session: macie.CfnSession;
  public readonly job: AwsCustomResource;

  constructor(scope: Construct, id: string, props: MacieProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    this.session = new macie.CfnSession(this, 'Session', {
      findingPublishingFrequency: 'FIFTEEN_MINUTES',
      status: 'ENABLED',
    });

    this.job = new AwsCustomResource(this, 'ClassificationJob', {
      onCreate: {
        service: 'Macie2',
        action: 'createClassificationJob',
        parameters: {
          name: `${props.prefix}-pii-scan`,
          description: 'PoC PII scan over raw bucket',
          jobType: 'ONE_TIME',
          s3JobDefinition: {
            bucketDefinitions: [
              {
                accountId: stack.account,
                buckets: [props.rawBucket.bucketName],
              },
            ],
          },
          clientToken: `${props.prefix}-pii-scan-token`,
        },
        physicalResourceId: PhysicalResourceId.fromResponse('jobId'),
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['macie2:CreateClassificationJob', 'macie2:DescribeClassificationJob'],
          resources: ['*'],
        }),
      ]),
      installLatestAwsSdk: false,
    });
    this.job.node.addDependency(this.session);
  }
}

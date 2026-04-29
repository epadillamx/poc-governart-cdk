import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface StorageProps {
  readonly prefix: string;
  readonly tablePrefix: string;
}

export class Storage extends Construct {
  public readonly rawBucket: s3.Bucket;
  public readonly tablePrefix: string;

  constructor(scope: Construct, id: string, props: StorageProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);
    this.tablePrefix = props.tablePrefix;

    this.rawBucket = new s3.Bucket(this, 'RawBucket', {
      bucketName: `${props.prefix}-raw-${stack.account}-${stack.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
  }
}

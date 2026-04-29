import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lakeformation from 'aws-cdk-lib/aws-lakeformation';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface LakeFormationProps {
  readonly prefix: string;
  readonly rawBucket: s3.IBucket;
  readonly databaseName: string;
  readonly crawlerRole: iam.IRole;
  /**
   * ARN of the role that runs `cdk deploy`. Required when `manageAdmins` is true.
   */
  readonly cdkExecRoleArn?: string;
  /**
   * Optional pre-existing role ARN to grant SELECT on the table.
   * When omitted, a new role is created.
   */
  readonly dataAnalystRoleArn?: string;
  /**
   * If true, the stack manages the LF Data Lake Administrators list via CfnDataLakeSettings.
   * DANGEROUS: replaces the existing admin list. Default: false (manual setup via console — see plan §7.4).
   */
  readonly manageAdmins?: boolean;
}

export class LakeFormation extends Construct {
  public readonly settings?: lakeformation.CfnDataLakeSettings;
  public readonly locationResource: lakeformation.CfnResource;
  public readonly dataAnalystRole: iam.IRole;
  /** All LF permissions created here — used by callers as a dependency anchor. */
  public readonly permissions: lakeformation.CfnPermissions[] = [];

  constructor(scope: Construct, id: string, props: LakeFormationProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    if (props.manageAdmins) {
      const adminArns = new Set<string>();
      if (props.cdkExecRoleArn) adminArns.add(props.cdkExecRoleArn);
      if (props.dataAnalystRoleArn) adminArns.add(props.dataAnalystRoleArn);
      this.settings = new lakeformation.CfnDataLakeSettings(this, 'Settings', {
        admins: Array.from(adminArns).map((arn) => ({
          dataLakePrincipalIdentifier: arn,
        })),
      });
    }

    this.locationResource = new lakeformation.CfnResource(this, 'RawLocation', {
      resourceArn: props.rawBucket.bucketArn,
      useServiceLinkedRole: true,
    });
    if (this.settings) {
      this.locationResource.addDependency(this.settings);
    }

    const crawlerLocPerm = new lakeformation.CfnPermissions(this, 'CrawlerLocationPerm', {
      dataLakePrincipal: { dataLakePrincipalIdentifier: props.crawlerRole.roleArn },
      resource: {
        dataLocationResource: {
          catalogId: stack.account,
          s3Resource: props.rawBucket.bucketArn,
        },
      },
      permissions: ['DATA_LOCATION_ACCESS'],
    });
    crawlerLocPerm.addDependency(this.locationResource);
    this.permissions.push(crawlerLocPerm);

    const crawlerDbPerm = new lakeformation.CfnPermissions(this, 'CrawlerDbPerm', {
      dataLakePrincipal: { dataLakePrincipalIdentifier: props.crawlerRole.roleArn },
      resource: {
        databaseResource: {
          catalogId: stack.account,
          name: props.databaseName,
        },
      },
      permissions: ['CREATE_TABLE', 'DESCRIBE', 'ALTER'],
    });
    if (this.settings) crawlerDbPerm.addDependency(this.settings);
    this.permissions.push(crawlerDbPerm);

    if (props.dataAnalystRoleArn) {
      this.dataAnalystRole = iam.Role.fromRoleArn(this, 'DataAnalyst', props.dataAnalystRoleArn, {
        mutable: false,
      });
    } else {
      this.dataAnalystRole = new iam.Role(this, 'DataAnalyst', {
        roleName: `${props.prefix}-data-analyst-role`,
        assumedBy: new iam.AccountPrincipal(stack.account),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonAthenaFullAccess'),
        ],
      });
    }

    const analystSelectPerm = new lakeformation.CfnPermissions(this, 'AnalystSelectPerm', {
      dataLakePrincipal: { dataLakePrincipalIdentifier: this.dataAnalystRole.roleArn },
      resource: {
        tableResource: {
          catalogId: stack.account,
          databaseName: props.databaseName,
          tableWildcard: {},
        },
      },
      permissions: ['SELECT', 'DESCRIBE'],
    });
    if (this.settings) analystSelectPerm.addDependency(this.settings);
    this.permissions.push(analystSelectPerm);
  }
}

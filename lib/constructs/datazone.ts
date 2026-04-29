import * as cdk from 'aws-cdk-lib';
import * as datazone from 'aws-cdk-lib/aws-datazone';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface DataZoneProps {
  readonly prefix: string;
}

export class DataZone extends Construct {
  public readonly domain: datazone.CfnDomain;
  public readonly project: datazone.CfnProject;
  public readonly executionRole: iam.Role;

  constructor(scope: Construct, id: string, props: DataZoneProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    this.executionRole = new iam.Role(this, 'DomainExecRole', {
      roleName: `${props.prefix}-datazone-exec-role`,
      assumedBy: new iam.ServicePrincipal('datazone.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': stack.account },
        },
      }),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonDataZoneDomainExecutionRolePolicy'),
      ],
    });

    this.domain = new datazone.CfnDomain(this, 'Domain', {
      name: `${props.prefix}-domain`,
      description: 'PoC Gobernanza - Data Domain',
      domainExecutionRole: this.executionRole.roleArn,
    });

    this.project = new datazone.CfnProject(this, 'Project', {
      name: `${props.prefix.replace(/-/g, '_')}_project`,
      description: 'PoC project',
      domainIdentifier: this.domain.attrId,
    });
  }
}

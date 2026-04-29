import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Storage } from './constructs/storage';
import { GlueCatalog } from './constructs/glue-catalog';
import { LakeFormation } from './constructs/lake-formation';
import { GlueDataQuality } from './constructs/glue-dq';
import { Macie } from './constructs/macie';
import { DataZone } from './constructs/datazone';
import { Lineage } from './constructs/lineage';

export interface GovernanceStackProps extends cdk.StackProps {
  readonly stage: string;
  readonly projectName: string;
  readonly cdkExecRoleArn?: string;
  readonly dataAnalystRoleArn?: string;
  readonly enableMacie: boolean;
  readonly manageLfAdmins: boolean;
}

export class GovernanceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GovernanceStackProps) {
    super(scope, id, props);

    const prefix = `${props.projectName}-${props.stage}`;
    const tablePrefix = 'clientes';
    const tableName = 'clientes';

    const storage = new Storage(this, 'Storage', { prefix, tablePrefix });

    const catalog = new GlueCatalog(this, 'GlueCatalog', {
      prefix,
      rawBucket: storage.rawBucket,
      tablePrefix,
    });

    const lf = new LakeFormation(this, 'LakeFormation', {
      prefix,
      rawBucket: storage.rawBucket,
      databaseName: catalog.databaseName,
      crawlerRole: catalog.crawlerRole,
      cdkExecRoleArn: props.cdkExecRoleArn,
      dataAnalystRoleArn: props.dataAnalystRoleArn,
      manageAdmins: props.manageLfAdmins,
    });
    catalog.crawler.addDependency(lf.locationResource);
    for (const perm of lf.permissions) catalog.crawler.addDependency(perm);

    new GlueDataQuality(this, 'GlueDataQuality', {
      prefix,
      databaseName: catalog.databaseName,
      tableName,
    });

    if (props.enableMacie) {
      new Macie(this, 'Macie', {
        prefix,
        rawBucket: storage.rawBucket,
      });
    }

    const dz = new DataZone(this, 'DataZone', { prefix });

    const lineage = new Lineage(this, 'Lineage', {
      domainId: dz.domain.attrId,
      databaseName: catalog.databaseName,
      tableName,
      rawBucketName: storage.rawBucket.bucketName,
      tablePrefix,
    });

    new cdk.CfnOutput(this, 'RawBucketName', { value: storage.rawBucket.bucketName });
    new cdk.CfnOutput(this, 'GlueDatabaseName', { value: catalog.databaseName });
    new cdk.CfnOutput(this, 'GlueTableName', { value: tableName });
    new cdk.CfnOutput(this, 'CrawlerName', { value: catalog.crawler.ref });
    new cdk.CfnOutput(this, 'DataZoneDomainId', { value: dz.domain.attrId });
    new cdk.CfnOutput(this, 'DataZoneProjectId', { value: dz.project.attrId });
    new cdk.CfnOutput(this, 'DataAnalystRoleArn', {
      value: lf.dataAnalystRole.roleArn,
    });
    new cdk.CfnOutput(this, 'LineageInputDataset', { value: lineage.inputDataset });
    new cdk.CfnOutput(this, 'LineageOutputDataset', { value: lineage.outputDataset });
  }
}

import * as cdk from 'aws-cdk-lib';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface GlueCatalogProps {
  readonly prefix: string;
  readonly rawBucket: s3.IBucket;
  readonly tablePrefix: string;
  readonly tableName: string;
}

export class GlueCatalog extends Construct {
  public readonly databaseName: string;
  public readonly database: glue.CfnDatabase;
  public readonly table: glue.CfnTable;
  public readonly crawler: glue.CfnCrawler;
  public readonly crawlerRole: iam.Role;

  constructor(scope: Construct, id: string, props: GlueCatalogProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);
    this.databaseName = `${props.prefix.replace(/-/g, '_')}_db`;

    this.database = new glue.CfnDatabase(this, 'Database', {
      catalogId: stack.account,
      databaseInput: {
        name: this.databaseName,
        description: `PoC Gobernanza - ${props.prefix}`,
      },
    });

    // Table is pre-declared so DQ ruleset (and other table-bound resources)
     // can attach to it at deploy time. The crawler is configured with
     // UPDATE_IN_DATABASE, so it refines schema/partitions on subsequent runs
     // without recreating the table.
    this.table = new glue.CfnTable(this, 'Table', {
      catalogId: stack.account,
      databaseName: this.databaseName,
      tableInput: {
        name: props.tableName,
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          classification: 'csv',
          'skip.header.line.count': '1',
          typeOfData: 'file',
        },
        storageDescriptor: {
          location: `s3://${props.rawBucket.bucketName}/${props.tablePrefix}/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat:
            'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary:
              'org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe',
            parameters: { 'field.delim': ',' },
          },
          columns: [
            { name: 'id', type: 'bigint' },
            { name: 'nombre', type: 'string' },
            { name: 'email', type: 'string' },
            { name: 'telefono', type: 'string' },
            { name: 'pais', type: 'string' },
          ],
        },
      },
    });
    this.table.addDependency(this.database);

    this.crawlerRole = new iam.Role(this, 'CrawlerRole', {
      roleName: `${props.prefix}-glue-crawler-role`,
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
      ],
    });
    props.rawBucket.grantRead(this.crawlerRole);

    this.crawler = new glue.CfnCrawler(this, 'Crawler', {
      name: `${props.prefix}-${props.tablePrefix}-crawler`,
      role: this.crawlerRole.roleArn,
      databaseName: this.databaseName,
      targets: {
        s3Targets: [
          { path: `s3://${props.rawBucket.bucketName}/${props.tablePrefix}/` },
        ],
      },
      tablePrefix: '',
      schemaChangePolicy: {
        updateBehavior: 'UPDATE_IN_DATABASE',
        deleteBehavior: 'LOG',
      },
      recrawlPolicy: { recrawlBehavior: 'CRAWL_EVERYTHING' },
    });
    this.crawler.addDependency(this.database);
  }
}

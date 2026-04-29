import { Construct } from 'constructs';

export interface LineageProps {
  readonly domainId: string;
  readonly databaseName: string;
  readonly tableName: string;
  readonly rawBucketName: string;
  readonly tablePrefix: string;
}

/**
 * No CFN resources — exposes canonical IDs that the emit-lineage script
 * uses when calling DataZone:PostLineageEvent with OpenLineage payloads.
 */
export class Lineage extends Construct {
  public readonly domainId: string;
  public readonly inputDataset: string;
  public readonly outputDataset: string;
  public readonly jobName: string;

  constructor(scope: Construct, id: string, props: LineageProps) {
    super(scope, id);

    this.domainId = props.domainId;
    this.inputDataset = `${props.rawBucketName}/${props.tablePrefix}/`;
    this.outputDataset = `${props.databaseName}.${props.tableName}`;
    this.jobName = 'manual-csv-upload';
  }
}

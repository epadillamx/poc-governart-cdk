import * as glue from 'aws-cdk-lib/aws-glue';
import { Construct } from 'constructs';

export interface GlueDataQualityProps {
  readonly prefix: string;
  readonly databaseName: string;
  readonly tableName: string;
}

export class GlueDataQuality extends Construct {
  public readonly ruleset: glue.CfnDataQualityRuleset;

  constructor(scope: Construct, id: string, props: GlueDataQualityProps) {
    super(scope, id);

    this.ruleset = new glue.CfnDataQualityRuleset(this, 'Ruleset', {
      name: `${props.prefix}-${props.tableName}-ruleset`,
      description: 'PoC DQ ruleset',
      ruleset: [
        'Rules = [',
        '  RowCount > 0,',
        '  IsComplete "id",',
        '  IsUnique "id",',
        '  ColumnExists "email"',
        ']',
      ].join('\n'),
      targetTable: {
        databaseName: props.databaseName,
        tableName: props.tableName,
      },
    });
  }
}

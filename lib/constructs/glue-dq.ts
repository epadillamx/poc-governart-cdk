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

    // Ruleset is created standalone — the target table (`tableName` in
     // `databaseName`) is produced by the crawler post-deploy, so binding
     // `targetTable` here fails CFN validation with EntityNotFoundException.
     // Operator picks the table when running the ruleset from the Glue console.
    this.ruleset = new glue.CfnDataQualityRuleset(this, 'Ruleset', {
      name: `${props.prefix}-${props.tableName}-ruleset`,
      description: `PoC DQ ruleset (target: ${props.databaseName}.${props.tableName})`,
      ruleset: [
        'Rules = [',
        '  RowCount > 0,',
        '  IsComplete "id",',
        '  IsUnique "id",',
        '  ColumnExists "email"',
        ']',
      ].join('\n'),
    });
  }
}

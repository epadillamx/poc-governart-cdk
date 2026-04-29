#!/usr/bin/env ts-node
/**
 * Emits OpenLineage events to DataZone for the manual CSV upload step.
 *
 * Usage:
 *   npm run emit-lineage -- <domainId> <rawBucket> <databaseName> [tableName]
 *
 * Or set in .env:
 *   DATAZONE_DOMAIN_ID, RAW_BUCKET_NAME, GLUE_DATABASE_NAME, GLUE_TABLE_NAME
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
import {
  DataZoneClient,
  PostLineageEventCommand,
} from '@aws-sdk/client-datazone';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main(): Promise<void> {
  const domainId = process.argv[2] ?? process.env.DATAZONE_DOMAIN_ID;
  const rawBucket = process.argv[3] ?? process.env.RAW_BUCKET_NAME;
  const databaseName = process.argv[4] ?? process.env.GLUE_DATABASE_NAME;
  const tableName = process.argv[5] ?? process.env.GLUE_TABLE_NAME ?? 'clientes';

  if (!domainId || !rawBucket || !databaseName) {
    console.error(
      'Missing args. Usage: npm run emit-lineage -- <domainId> <rawBucket> <databaseName> [tableName]',
    );
    process.exit(1);
  }

  const region = process.env.AWS_REGION ?? 'us-east-1';
  const client = new DataZoneClient({ region });

  const runId = `manual-csv-upload-${Date.now()}`;
  const baseEvent = {
    producer: 'poc-gov/manual-csv-upload',
    schemaURL: 'https://openlineage.io/spec/2-0-2/OpenLineage.json',
    job: { namespace: 'poc-gov', name: 'manual-csv-upload' },
    run: { runId },
    inputs: [
      {
        namespace: 's3',
        name: `${rawBucket}/clientes/clientes.csv`,
      },
    ],
    outputs: [
      {
        namespace: 'awsglue',
        name: `${databaseName}.${tableName}`,
      },
    ],
  };

  const events = [
    { ...baseEvent, eventType: 'START', eventTime: new Date().toISOString() },
    {
      ...baseEvent,
      eventType: 'COMPLETE',
      eventTime: new Date(Date.now() + 1000).toISOString(),
    },
  ];

  for (const evt of events) {
    const payload = new TextEncoder().encode(JSON.stringify(evt));
    await client.send(
      new PostLineageEventCommand({
        domainIdentifier: domainId,
        event: payload,
      }),
    );
    console.log(`[ok] emitted ${evt.eventType} event runId=${runId}`);
  }

  console.log('Done. Open the asset in DataZone and check the Lineage tab.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

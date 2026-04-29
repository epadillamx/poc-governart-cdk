#!/usr/bin/env node
import 'source-map-support/register';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as cdk from 'aws-cdk-lib';
import { GovernanceStack } from '../lib/governance-stack';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const account =
  process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID;
const region =
  process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION ?? 'us-east-1';
const stage = process.env.STAGE ?? 'dev';
const projectName = process.env.PROJECT_NAME ?? 'poc-gov';
const cdkExecRoleArn = process.env.CDK_EXEC_ROLE_ARN;
const dataAnalystRoleArn = process.env.DATA_ANALYST_ROLE_ARN || undefined;
const enableMacie = (process.env.ENABLE_MACIE ?? 'true').toLowerCase() !== 'false';
const manageLfAdmins = (process.env.MANAGE_LF_ADMINS ?? 'false').toLowerCase() === 'true';

if (!account) {
  throw new Error(
    'Missing CDK_DEFAULT_ACCOUNT in .env. Copy .env.example to .env and fill values.',
  );
}

if (manageLfAdmins && !cdkExecRoleArn) {
  throw new Error(
    'MANAGE_LF_ADMINS=true requires CDK_EXEC_ROLE_ARN to be set, otherwise admins list would be wiped.',
  );
}

const app = new cdk.App();

new GovernanceStack(app, `${projectName}-${stage}-governance`, {
  env: { account, region },
  stage,
  projectName,
  cdkExecRoleArn,
  dataAnalystRoleArn,
  enableMacie,
  manageLfAdmins,
  description: 'PoC Gobernanza de Datos - S3 + Glue + LF + Macie + DataZone',
});

app.synth();

#!/usr/bin/env ts-node
/**
 * Cross-platform `cdk deploy` wrapper. Loads values from .env so the user
 * doesn't have to `source .env` (or run the PowerShell equivalent) before
 * deploying.
 *
 * Usage: npm run deploy [-- <extra cdk args>]
 */
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const account = process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID;
const profile = process.env.AWS_PROFILE;

const missing: string[] = [];
if (!account) missing.push('CDK_DEFAULT_ACCOUNT');
if (!profile) missing.push('AWS_PROFILE');
if (missing.length > 0) {
  console.error(
    `[deploy] Missing in .env: ${missing.join(', ')}. ` +
      'Copy .env.example to .env and fill values.',
  );
  process.exit(1);
}

const extraArgs = process.argv.slice(2);
const args = [
  'cdk',
  'deploy',
  '--require-approval',
  'never',
  '--profile',
  profile!,
  ...extraArgs,
];

console.log(`[deploy] npx ${args.join(' ')}`);

const result = spawnSync('npx', args, {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

process.exit(result.status ?? 1);

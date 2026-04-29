#!/usr/bin/env ts-node
/**
 * Cross-platform `cdk bootstrap` wrapper. Loads values from .env so the user
 * doesn't have to pass --profile / aws://account/region by hand.
 *
 * Usage: npm run bootstrap
 */
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const account = process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID;
const region =
  process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION ?? 'us-east-1';
const profile = process.env.AWS_PROFILE;

const missing: string[] = [];
if (!account) missing.push('CDK_DEFAULT_ACCOUNT');
if (!profile) missing.push('AWS_PROFILE');
if (missing.length > 0) {
  console.error(
    `[bootstrap] Missing in .env: ${missing.join(', ')}. ` +
      'Copy .env.example to .env and fill values.',
  );
  process.exit(1);
}

const target = `aws://${account}/${region}`;
const args = ['cdk', 'bootstrap', target, '--profile', profile!];

console.log(`[bootstrap] npx ${args.join(' ')}`);

const result = spawnSync('npx', args, {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

process.exit(result.status ?? 1);

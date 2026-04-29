#!/usr/bin/env ts-node
/**
 * Cross-platform `cdk synth` wrapper. Loads values from .env so the user
 * doesn't have to `source .env` first. Synth itself does not call AWS, but
 * `bin/app.ts` reads CDK_DEFAULT_ACCOUNT / AWS_REGION / etc. from the env.
 *
 * Usage: npm run synth [-- <extra cdk args>]
 */
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const account = process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID;
if (!account) {
  console.error(
    '[synth] Missing CDK_DEFAULT_ACCOUNT in .env. ' +
      'Copy .env.example to .env and fill values.',
  );
  process.exit(1);
}

const extraArgs = process.argv.slice(2);
const args = ['cdk', 'synth', ...extraArgs];

console.log(`[synth] npx ${args.join(' ')}`);

const result = spawnSync('npx', args, {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

process.exit(result.status ?? 1);

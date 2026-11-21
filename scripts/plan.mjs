import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { computePlan } from './lib/plan.mjs';
import { env, main, setOutput } from './lib/gha.mjs';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function readBefore(sha) {
  if (!/^[0-9a-f]{40}$/.test(sha) || /^0+$/.test(sha)) return { before: null, changedFiles: null };
  try {
    git('cat-file', '-e', `${sha}^{commit}`);
  } catch {
    console.log(`::warning::変更前の commit ${sha} が履歴に無いので全部ビルドする`);
    return { before: null, changedFiles: null };
  }
  const changedFiles = git('diff', '--name-only', sha, 'HEAD').split('\n').filter(Boolean);
  let before = null;
  try {
    before = JSON.parse(git('show', `${sha}:versions.json`));
  } catch {
    before = null;
  }
  return { before, changedFiles };
}

main(async () => {
  const event = env('EVENT_NAME');
  const after = JSON.parse(readFileSync('versions.json', 'utf8'));
  const { before, changedFiles } = event === 'push' ? readBefore(env('BEFORE_SHA', { optional: true })) : {};
  const plan = computePlan({
    event, before, after, changedFiles, phpVersion: env('PHP_VERSION_INPUT', { optional: true }),
  });
  for (const [k, v] of Object.entries(plan)) setOutput(k, v);
  setOutput('frankenphpVersion', after.frankenphp.version);
  setOutput('frankenphpCommit', after.frankenphp.commit);
  setOutput('platformCount', String(after.platforms.length));
  const redispatchCount = env('REDISPATCH_COUNT_INPUT', { optional: true }) || '0';
  if (!/^\d+$/.test(redispatchCount)) throw new Error(`redispatch-count が 0 以上の整数ではない: '${redispatchCount}'`);
  setOutput('redispatchCount', redispatchCount);
  console.log(JSON.stringify(plan, null, 2));
});

// versions.json の FrankenPHP のタグが、pin した commit を指しているかを確かめる。
// Renovate はタグと commit を同時に更新するので、タグの付け替え（同じ版名で別 commit）をここで止める。
// 入力（環境変数）: VERSIONS_FILE（省略時は versions.json）
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tagCommit } from './lib/ls-remote.mjs';
import { validateVersions } from './lib/plan.mjs';
import { env, main, setOutput } from './lib/gha.mjs';

main(async () => {
  const versions = JSON.parse(readFileSync(env('VERSIONS_FILE', { optional: true }) || 'versions.json', 'utf8'));
  validateVersions(versions);
  const { repository, version, commit } = versions.frankenphp;
  const out = execFileSync('git', ['ls-remote', `https://github.com/${repository}.git`, `refs/tags/${version}`, `refs/tags/${version}^{}`], { encoding: 'utf8' });
  const actual = tagCommit(out, version);
  if (actual !== commit) throw new Error(`${repository} の ${version} は ${actual ?? '（無い）'} を指していて、pin した ${commit} と違う`);
  console.log(`${repository} ${version} → ${commit}`);
  setOutput('version', version);
  setOutput('commit', commit);
});

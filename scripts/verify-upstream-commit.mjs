import { client } from './lib/github.mjs';
import { reachableFromDefault } from './lib/upstream.mjs';
import { env, main } from './lib/gha.mjs';

// library/php の GitCommit が docker-library/php の既定ブランチから到達できるかを確かめる（fork ネットワークの
// commit を同じリポジトリの名前で取らないように）。
main(async () => {
  const commit = env('GIT_COMMIT');
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`GIT_COMMIT が不正: ${commit}`);
  const { rest } = client(env('GH_TOKEN'));
  const repo = 'docker-library/php';
  const { default_branch: branch } = await rest('GET', `/repos/${repo}`);
  const { status } = await rest('GET', `/repos/${repo}/compare/${branch}...${commit}`);
  if (!reachableFromDefault(status)) throw new Error(`${repo}@${commit} は ${branch} から到達できない（compare: ${status}）`);
  console.log(`${repo}@${commit} は ${branch} から到達できる（${status}）`);
});

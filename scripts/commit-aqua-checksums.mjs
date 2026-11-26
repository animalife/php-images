import { commitChecksums } from './lib/aqua-checksums.mjs';
import { client } from './lib/github.mjs';
import { appendSummary, env, main } from './lib/gha.mjs';

main(async () => {
  const branch = env('TARGET_BRANCH');
  const result = await commitChecksums({
    artifactDir: env('ARTIFACT_DIR'),
    repo: env('GITHUB_REPOSITORY'),
    branch,
    headSha: env('HEAD_SHA'),
    graphql: client(env('GH_TOKEN')).graphql,
  });
  appendSummary(result.committed
    ? [`${branch} に aqua-checksums.json を作り直したコミットを積んだ: ${result.url}`, '', ...result.paths.map((p) => `- \`${p}\``)].join('\n')
    : 'aqua-checksums.json は最新なので、コミットしなかった。');
});

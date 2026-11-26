// 作業ツリーの COMMIT_PATHS の変更を、createCommitOnBranch で TARGET_BRANCH に積む。
// ruleset が署名を必須にするので、git push ではなく GitHub が署名する API でコミットする。
// 作業ツリー（cwd）は信頼しない PR の head でよい。このスクリプトと lib は既定ブランチの信頼版を実行する。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { buildAddArgs, parseNameStatusZ } from './lib/signed-commit.mjs';
import { client } from './lib/github.mjs';
import { env, main } from './lib/gha.mjs';

main(async () => {
  const repo = env('GITHUB_REPOSITORY');
  const branch = env('TARGET_BRANCH');
  const headline = env('COMMIT_MESSAGE');
  const { graphql } = client(env('GH_TOKEN'));

  execFileSync('git', buildAddArgs(env('COMMIT_PATHS')), { stdio: 'inherit' });
  const { addPaths, delPaths } = parseNameStatusZ(
    execFileSync('git', ['diff', '--cached', '--name-status', '-z', 'HEAD'], { encoding: 'utf8' }),
  );
  if (addPaths.length === 0 && delPaths.length === 0) {
    console.log('コミットする変更が無い');
    return;
  }

  // 作業ツリーを取った後に枝が進んでいたら、API が expectedHeadOid の不一致で拒む（古い内容で上書きしない）。
  const expectedHeadOid = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const data = await graphql(
    `mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid url } } }`,
    {
      input: {
        branch: { repositoryNameWithOwner: repo, branchName: branch },
        message: { headline },
        expectedHeadOid,
        fileChanges: {
          additions: addPaths.map((path) => ({ path, contents: readFileSync(path).toString('base64') })),
          deletions: delPaths.map((path) => ({ path })),
        },
      },
    },
  );
  const { oid, url } = data.createCommitOnBranch.commit;
  console.log(`${branch} に署名済みのコミットを積んだ: ${oid} ${url}`);
});

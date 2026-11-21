import { setTimeout as delay } from 'node:timers/promises';
import { bumpBranch, bumpVersions, formatVersions, settleBumpAction } from './lib/bump.mjs';
import { client, PR_BUMP_QUERY, prState } from './lib/github.mjs';
import { env, main, setOutput } from './lib/gha.mjs';

main(async () => {
  const version = env('PHP_VERSION');
  const repo = env('GITHUB_REPOSITORY');
  const [owner, name] = repo.split('/');
  const { rest, graphql } = client(env('GH_TOKEN'));
  const branch = bumpBranch(version);

  // 待っている間に main が進んでいても、最新の main から PR を作るのですれ違わない。
  const head = (await rest('GET', `/repos/${repo}/git/ref/heads/main`)).object.sha;
  const file = await rest('GET', `/repos/${repo}/contents/versions.json?ref=${head}`);
  const next = bumpVersions(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')), version);

  const open = await rest('GET', `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`);
  const readPr = async () => {
    if (open.length === 0) return null;
    const pr = prState(await graphql(PR_BUMP_QUERY, { owner, name, number: open[0].number }));
    return { number: open[0].number, state: pr.state, mergeable: pr.mergeable, autoMergeRequest: pr.autoMergeRequest, isInMergeQueue: pr.isInMergeQueue, id: pr.id, url: pr.url };
  };
  let openPr = null;
  const readAndKeep = async () => { openPr = await readPr(); return openPr; };
  // mergeable が UNKNOWN（計算中）なら、確定するまで 15 秒おきに最大 10 回読み直す。
  const action = await settleBumpAction({ needed: next !== null, readPr: readAndKeep, polls: 10, wait: () => delay(15_000) });

  async function deleteBranch() {
    if (await rest('GET', `/repos/${repo}/git/ref/heads/${branch}`, undefined, { allow404: true })) {
      await rest('DELETE', `/repos/${repo}/git/refs/heads/${branch}`);
    }
  }

  async function enableAutoMerge(id) {
    try {
      await graphql(`mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id }) { clientMutationId } }`, { id });
    } catch (e) {
      // 必須チェックやマージキューの ruleset が無いと、auto-merge を有効にできない（すぐマージできる状態だと拒まれる）。
      throw new Error(`auto-merge を有効にできない。main の ruleset（必須チェックとマージキュー）とリポジトリの「Allow auto-merge」を確かめる: ${e.message}`);
    }
  }

  if (action.kind === 'none') {
    console.log(`::notice::main の versions.json はすでに PHP ${version} 以上なので何もしない`);
    await deleteBranch();
    setOutput('pr', '');
    return;
  }
  if (action.kind === 'close') {
    // 負けた夜の PR（Renovate などで main が先にその版以上になった）を閉じ、枝を消す。
    await rest('PATCH', `/repos/${repo}/pulls/${action.pr}`, { state: 'closed' });
    await deleteBranch();
    console.log(`::notice::main の versions.json はすでに PHP ${version} 以上なので、PR #${action.pr} を閉じた`);
    setOutput('pr', '');
    return;
  }
  if (action.kind === 'watch') {
    if (action.enableAutoMerge) {
      await enableAutoMerge(openPr.id);
      console.log(`PR #${action.pr} の auto-merge が外れていたので有効にし直した`);
    } else {
      console.log(`PHP ${version} の PR はすでにある: ${openPr.url}`);
    }
    setOutput('pr', String(action.pr));
    return;
  }

  if (action.kind === 'recreate') {
    // 同じ minor の digest 更新などが先に main に入って conflict した PR は、閉じて最新の main から作り直す。
    await rest('PATCH', `/repos/${repo}/pulls/${action.pr}`, { state: 'closed' });
    console.log(`PR #${action.pr} は main と conflict しているので閉じて作り直す`);
  }
  // 前回の失敗で枝だけ残っていれば消して作り直す（force での付け替えは、枝の ruleset で禁止されうるので使わない）。
  await deleteBranch();
  await rest('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: head });

  // ruleset が署名を必須にするので、git push ではなく GitHub が署名する createCommitOnBranch で積む。
  const headline = `chore(php): PHP ${version} に上げる`;
  const body = [
    `php.net で PHP ${version} が公開されたので、versions.json の pin を上げる。`,
    '公式イメージがまだ無いので officialDigest は null にする（公開後に Renovate が埋める）。',
    '',
    `起動した run: ${env('RUN_URL')}`,
  ].join('\n');
  await graphql(`mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }`, {
    input: {
      branch: { repositoryNameWithOwner: repo, branchName: branch },
      message: { headline, body },
      expectedHeadOid: head,
      fileChanges: { additions: [{ path: 'versions.json', contents: Buffer.from(formatVersions(next)).toString('base64') }] },
    },
  });

  const pr = await rest('POST', `/repos/${repo}/pulls`, { title: headline, head: branch, base: 'main', body });
  // マージキューを必須にしたブランチでは、auto-merge を有効にするとチェックが通った時点でキューに入る。
  await enableAutoMerge(pr.node_id);
  console.log(`PHP ${version} の PR を作り、auto-merge を有効にした: ${pr.html_url}`);
  setOutput('pr', String(pr.number));
});

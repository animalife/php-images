import { bumpBranch, bumpVersions, formatVersions } from './lib/bump.mjs';
import { env, main, setOutput } from './lib/gha.mjs';

const API = 'https://api.github.com';

function client(token) {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  async function rest(method, path, body, { allow404 = false } = {}) {
    const res = await fetch(`${API}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
    if (allow404 && res.status === 404) return null;
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }
  async function graphql(query, variables) {
    const out = await rest('POST', '/graphql', { query, variables });
    if (out.errors) throw new Error(`GraphQL: ${JSON.stringify(out.errors)}`);
    return out.data;
  }
  return { rest, graphql };
}

main(async () => {
  const version = env('PHP_VERSION');
  const repo = env('GITHUB_REPOSITORY');
  const [owner] = repo.split('/');
  const { rest, graphql } = client(env('GH_TOKEN'));

  // 待っている間に main が進んでいても、最新の main から PR を作るのですれ違わない。
  const head = (await rest('GET', `/repos/${repo}/git/ref/heads/main`)).object.sha;
  const file = await rest('GET', `/repos/${repo}/contents/versions.json?ref=${head}`);
  const current = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  const next = bumpVersions(current, version);
  if (next === null) {
    console.log(`::notice::main の versions.json はすでに PHP ${version} 以上なので何もしない`);
    setOutput('result', 'up-to-date');
    return;
  }

  const branch = bumpBranch(version);
  const open = await rest('GET', `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`);
  if (open.length > 0) {
    console.log(`::notice::PHP ${version} の PR はすでにある: ${open[0].html_url}`);
    setOutput('result', 'exists');
    return;
  }

  // 前回の失敗で枝だけ残っていれば、main の先端へ付け替えてから積む。
  if (await rest('GET', `/repos/${repo}/git/ref/heads/${branch}`, undefined, { allow404: true })) {
    await rest('PATCH', `/repos/${repo}/git/refs/heads/${branch}`, { sha: head, force: true });
  } else {
    await rest('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: head });
  }

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
  await graphql(`mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id }) { clientMutationId } }`, { id: pr.node_id });
  console.log(`PHP ${version} の PR を作り、auto-merge を有効にした: ${pr.html_url}`);
  setOutput('result', 'created');
  setOutput('url', pr.html_url);
});

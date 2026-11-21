import { setTimeout as delay } from 'node:timers/promises';
import { bumpBranch, bumpVersions } from './lib/bump.mjs';
import { client, PR_STATE_QUERY, prState } from './lib/github.mjs';
import { assessPr, needsMainCheck } from './lib/publish.mjs';
import { env, main } from './lib/gha.mjs';

// 夜の PR がマージされるまで見届ける。閉じられた・conflict（main がまだその版でないとき）・チェックの失敗・
// auto-merge が外れた・期限切れなら失敗にする（dispatch した人に失敗の通知が届くように）。
main(async () => {
  const repo = env('GITHUB_REPOSITORY');
  const [owner, name] = repo.split('/');
  const version = env('PHP_VERSION');
  const number = Number(env('PR'));
  const interval = Number(env('INTERVAL_SECONDS'));
  const deadline = Date.now() + Number(env('DEADLINE_SECONDS')) * 1000;
  const { rest, graphql } = client(env('GH_TOKEN'));

  async function mainCovers() {
    const file = await rest('GET', `/repos/${repo}/contents/versions.json?ref=main`);
    return bumpVersions(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')), version) === null;
  }

  let lastError = null;
  for (;;) {
    let state = null;
    let covers = false;
    try {
      state = prState(await graphql(PR_STATE_QUERY, { owner, name, number }));
      if (needsMainCheck(state)) covers = await mainCovers();
      lastError = null;
    } catch (e) {
      lastError = e;
      state = null;
      console.log(`PR か main の状態を読めなかった: ${e.message}`);
    }
    if (state !== null) {
      // assessPr の例外（閉じられた・conflict など）はそのまま run の失敗にする。
      const result = assessPr(state, { mainCovers: covers });
      if (result === 'merged') {
        console.log(`PR #${number} がマージされた: ${state.url}`);
        return;
      }
      if (result === 'superseded') {
        // Renovate の patch PR などが先に main をその版以上にした。残った PR を閉じ、枝を消す。
        if (state.state === 'OPEN') await rest('PATCH', `/repos/${repo}/pulls/${number}`, { state: 'closed' });
        const branch = bumpBranch(version);
        if (await rest('GET', `/repos/${repo}/git/ref/heads/${branch}`, undefined, { allow404: true })) {
          await rest('DELETE', `/repos/${repo}/git/refs/heads/${branch}`);
        }
        console.log(`::notice::main はすでに PHP ${version} 以上なので、PR #${number} を閉じて終える`);
        return;
      }
      console.log(`${new Date().toISOString()} PR #${number}: ${state.state} / ${state.mergeable} / queue ${state.isInMergeQueue} / checks ${state.rollup ?? 'none'}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`PR #${number} が期限までにマージされなかった${lastError ? `（最後の確認で失敗: ${lastError.message}）` : ''}`);
    }
    await delay(interval * 1000);
  }
});

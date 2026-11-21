import { setTimeout as delay } from 'node:timers/promises';
import { bumpBranch, bumpVersions } from './lib/bump.mjs';
import { client, PR_STATE_QUERY, prState } from './lib/github.mjs';
import { assessPr, canRedispatch, needsMainCheck, nextSuspectCount } from './lib/publish.mjs';
import { env, main, setOutput } from './lib/gha.mjs';

// 夜の PR がマージされるまで見届ける（PR の失敗を run の失敗と Issue に変えるため）。
main(async () => {
  const repo = env('GITHUB_REPOSITORY');
  const [owner, name] = repo.split('/');
  const version = env('PHP_VERSION');
  const number = Number(env('PR'));
  const redispatchCount = env('REDISPATCH_COUNT');
  const interval = Number(env('INTERVAL_SECONDS'));
  const deadline = Date.now() + Number(env('DEADLINE_SECONDS')) * 1000;
  const { rest, graphql } = client(env('GH_TOKEN'));

  async function mainCovers() {
    const file = await rest('GET', `/repos/${repo}/contents/versions.json?ref=main`);
    return bumpVersions(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')), version) === null;
  }

  let suspects = 0;
  let lastError = null;
  for (;;) {
    let state = null;
    let covers = false;
    try {
      state = prState(await graphql(PR_STATE_QUERY, { owner, name, number }));
      if (needsMainCheck(state)) covers = await mainCovers();
      lastError = null;
    } catch (e) {
      // 権限不足などの恒久的なエラーは、待っても直らないのですぐ失敗にする。
      if (e.permanent) throw e;
      lastError = e;
      state = null;
      console.log(`PR か main の状態を読めなかった（再試行する）: ${e.message}`);
    }
    if (state !== null) {
      // assessPr の例外（閉じられた・チェックの失敗）はそのまま run の失敗にする。
      const result = assessPr(state, { mainCovers: covers });
      suspects = nextSuspectCount(suspects, result);
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
      if (result === 'conflict') {
        // 同じ minor の digest 更新などが先に main に入った。同じ版で dispatch し直し、新しい run の bump が
        // conflict した PR を閉じて最新の main から作り直す。
        if (!canRedispatch(redispatchCount)) throw new Error(`PR #${number} が main と conflict している（立て直しの上限に達した）`);
        setOutput('redispatch', 'true');
        console.log(`::notice::PR #${number} が main と conflict したので、PHP ${version} で dispatch し直す`);
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

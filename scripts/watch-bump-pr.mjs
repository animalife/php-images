import { setTimeout as delay } from 'node:timers/promises';
import { client, PR_STATE_QUERY, prState } from './lib/github.mjs';
import { assessPr } from './lib/publish.mjs';
import { env, main } from './lib/gha.mjs';

// 夜の PR がマージされるまで見届ける。閉じられた・conflict・チェックの失敗・auto-merge が外れた・期限切れなら失敗にする
// （dispatch した人に失敗の通知が届くように）。
main(async () => {
  const [owner, name] = env('GITHUB_REPOSITORY').split('/');
  const number = Number(env('PR'));
  const interval = Number(env('INTERVAL_SECONDS'));
  const deadline = Date.now() + Number(env('DEADLINE_SECONDS')) * 1000;
  const { graphql } = client(env('GH_TOKEN'));
  let lastError = null;
  for (;;) {
    let state = null;
    try {
      state = prState(await graphql(PR_STATE_QUERY, { owner, name, number }));
      lastError = null;
    } catch (e) {
      lastError = e;
      console.log(`PR の状態を読めなかった: ${e.message}`);
    }
    if (state !== null) {
      // assessPr の例外（閉じられた・conflict など）はそのまま run の失敗にする。
      if (assessPr(state) === 'merged') {
        console.log(`PR #${number} がマージされた: ${state.url}`);
        return;
      }
      console.log(`${new Date().toISOString()} PR #${number}: ${state.state} / ${state.mergeable} / checks ${state.rollup ?? 'none'}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`PR #${number} が期限までにマージされなかった${lastError ? `（最後の確認で失敗: ${lastError.message}）` : ''}`);
    }
    await delay(interval * 1000);
  }
});

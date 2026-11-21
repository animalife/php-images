import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForRelease } from '../lib/php-release.mjs';

const released = { version: '8.6.1', source: [{ filename: 'php-8.6.1.tar.xz', sha256: 'b'.repeat(64) }] };
const unknown = { error: 'Unknown version' };

// 応答を順に返す偽の fetch と、呼ばれるたびに interval だけ進む偽の時計。
function harness(responses, { interval = 300, deadline = 1000 } = {}) {
  let clock = 0;
  const logs = [];
  const run = waitForRelease({
    version: '8.6.1',
    interval,
    deadline,
    now: () => clock,
    sleep: async (s) => { clock += s; },
    fetchJson: async () => {
      const r = responses.shift();
      if (r instanceof Error) throw r;
      return r;
    },
    log: (m) => logs.push(m),
  });
  return { run, logs };
}

test('公開されたらリリース情報を返す', async () => {
  const { run } = harness([unknown, unknown, released]);
  assert.deepEqual(await run, { status: 'found', release: released });
});

test('期限までに公開されなければ timeout を返す（失敗ではない）', async () => {
  const { run } = harness([unknown, unknown, unknown, unknown, unknown]);
  assert.deepEqual(await run, { status: 'timeout' });
});

test('一時的な取得失敗は待ち続ける', async () => {
  const { run, logs } = harness([new Error('ECONNRESET'), released]);
  assert.equal((await run).status, 'found');
  assert.ok(logs.some((m) => m.includes('ECONNRESET')));
});

// 応答の形が変わったまま期限切れになると「未公開だった」と区別がつかず、夜の経路が黙って止まる。
test('最後の試行が取得・解釈の失敗のまま期限が来たら error を返す', async () => {
  const { run } = harness([unknown, new Error('bad'), new Error('bad'), new Error('bad'), new Error('bad')]);
  const result = await run;
  assert.equal(result.status, 'error');
  assert.match(result.message, /bad/);
});

test('期限を過ぎて眠らない（最後の sleep は残り時間で切る）', async () => {
  const slept = [];
  let clock = 0;
  await waitForRelease({
    version: '8.6.1',
    interval: 300,
    deadline: 700,
    now: () => clock,
    sleep: async (s) => { slept.push(s); clock += s; },
    fetchJson: async () => unknown,
    log: () => {},
  });
  assert.deepEqual(slept, [300, 300, 100]);
});

// JSON が先に更新され tarball がまだ配信されていないと、ビルドの curl が 404 で落ちる。
test('リリース情報が出ても tarball が取れなければ待ち続ける', async () => {
  let clock = 0;
  const ready = [false, true];
  const result = await waitForRelease({
    version: '8.6.1',
    interval: 300,
    deadline: 1000,
    now: () => clock,
    sleep: async (s) => { clock += s; },
    fetchJson: async () => released,
    assetsReady: async () => ready.shift(),
    log: () => {},
  });
  assert.equal(result.status, 'found');
  assert.equal(clock, 300);
});

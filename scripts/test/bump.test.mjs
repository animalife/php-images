import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bumpVersions, formatVersions, bumpBranch, bumpAction, settleBumpAction, enableAutoMergeOrMerged } from '../lib/bump.mjs';

const repoVersions = () => JSON.parse(readFileSync(new URL('../../versions.json', import.meta.url), 'utf8'));

test('パッチ版を上げ、digest は null にする（公式イメージがまだ無い）', () => {
  const next = bumpVersions(repoVersions(), '8.6.1');
  assert.equal(next.php['8.6'].officialTag, '8.6.1-cli-trixie');
  assert.equal(next.php['8.6'].officialDigest, null);
});

test('main がすでにその版以上なら何もしない', () => {
  const v = repoVersions();
  const pinned = v.php['8.6'].officialTag.split('-')[0];
  assert.equal(bumpVersions(v, pinned), null);
  const [maj, min, patch] = pinned.split('.').map(Number);
  if (patch > 0) assert.equal(bumpVersions(v, `${maj}.${min}.${patch - 1}`), null);
});

test('versions.json に無い minor・不正な版は例外', () => {
  assert.throws(() => bumpVersions(repoVersions(), '8.7.0'), /8\.7/);
  assert.throws(() => bumpVersions(repoVersions(), '8.6.01'), /版/);
});

// Renovate の custom manager は versions.json のこの書式を前提に置き換えるので、夜のジョブも同じ書式で書く。
test('versions.json はリポジトリのファイルと同じ書式で書く（版だけの差分になる）', () => {
  const original = readFileSync(new URL('../../versions.json', import.meta.url), 'utf8');
  assert.equal(formatVersions(JSON.parse(original)), original);
  const changed = formatVersions(bumpVersions(JSON.parse(original), '8.6.9')).split('\n')
    .filter((line, i) => line !== original.split('\n')[i]);
  assert.equal(changed.length, 2);
});

test('PR のブランチ名は版から決まる', () => {
  assert.equal(bumpBranch('8.6.1'), 'php-version/8.6.1');
  assert.throws(() => bumpBranch('8.6'), /版/);
});

const prState = (o) => ({ number: 7, autoMergeRequest: {}, ...o });

test('bumpAction: main がすでにその版以上なら、残っている同じ版の PR を閉じる', () => {
  assert.deepEqual(bumpAction({ needed: false, openPr: prState({}) }), { kind: 'close', pr: 7 });
  assert.deepEqual(bumpAction({ needed: false, openPr: null }), { kind: 'none' });
});

// dispatch し直したとき、既存の PR の auto-merge が外れていれば有効にし直してから見届ける。
test('bumpAction: 同じ版の PR があれば、auto-merge を確かめて見届けに回す', () => {
  assert.deepEqual(bumpAction({ needed: true, openPr: prState({}) }), { kind: 'watch', pr: 7, enableAutoMerge: false });
  assert.deepEqual(bumpAction({ needed: true, openPr: prState({ autoMergeRequest: null }) }), { kind: 'watch', pr: 7, enableAutoMerge: true });
});

test('bumpAction: PR が無ければ作る', () => {
  assert.deepEqual(bumpAction({ needed: true, openPr: null }), { kind: 'create' });
});

test('bumpAction: 既存の PR がマージキューに入っていれば auto-merge を投げない', () => {
  assert.deepEqual(bumpAction({ needed: true, openPr: prState({ autoMergeRequest: null, isInMergeQueue: true }) }), { kind: 'watch', pr: 7, enableAutoMerge: false });
});

test('bumpAction: 同じ版の PR が conflict なら、閉じてから main から作り直す', () => {
  assert.deepEqual(bumpAction({ needed: true, openPr: prState({ mergeable: 'CONFLICTING' }) }), { kind: 'recreate', pr: 7 });
});

// 作り直した直後などは mergeable が UNKNOWN（GitHub が計算中）。そのまま watch に進むと、後で conflict と分かって
// 立て直しの回数を無駄に使う。確定するまで待って読み直す。
test('bumpAction: 同じ版の PR の mergeable が UNKNOWN なら、確定するまで待つ', () => {
  assert.deepEqual(bumpAction({ needed: true, openPr: prState({ mergeable: 'UNKNOWN' }) }), { kind: 'wait-mergeable', pr: 7 });
});

// open の一覧で見つけた後、読み直す間にマージ・クローズされることがある。マージ済みの PR は mergeable が UNKNOWN、
// autoMergeRequest が null のままなので、state を見ずに判定すると auto-merge を投げ直して失敗する。
test('bumpAction: 読み直した PR がマージ済みなら見届けに回し（auto-merge は投げない）、閉じられていれば作り直す', () => {
  assert.deepEqual(bumpAction({ needed: true, openPr: prState({ state: 'MERGED', mergeable: 'UNKNOWN', autoMergeRequest: null }) }), { kind: 'watch', pr: 7, enableAutoMerge: false });
  assert.deepEqual(bumpAction({ needed: true, openPr: prState({ state: 'CLOSED', mergeable: 'UNKNOWN' }) }), { kind: 'create' });
});

const states = (...list) => {
  const queue = [...list];
  return async () => queue.shift() ?? list.at(-1);
};

test('settleBumpAction: UNKNOWN の間は読み直し、確定したらその判定を返す', async () => {
  const readPr = states(prState({ mergeable: 'UNKNOWN' }), prState({ mergeable: 'CONFLICTING' }));
  const action = await settleBumpAction({ needed: true, readPr, polls: 10, wait: async () => {} });
  assert.deepEqual(action, { kind: 'recreate', pr: 7 });
});

// 捕まえる変異: settle のループで MERGED を判定しない（UNKNOWN のまま上限まで待ってから同じ値に落ちる）。
// MERGED を見た時点で止まることを、待った回数で判別する。
test('settleBumpAction: 待つ間にマージされたら、そこで止まって auto-merge を投げずに見届けへ', async () => {
  let waits = 0;
  const readPr = states(prState({ mergeable: 'UNKNOWN' }), prState({ state: 'MERGED', mergeable: 'UNKNOWN', autoMergeRequest: null }));
  const action = await settleBumpAction({ needed: true, readPr, polls: 10, wait: async () => { waits += 1; } });
  assert.deepEqual(action, { kind: 'watch', pr: 7, enableAutoMerge: false });
  assert.equal(waits, 1);
});

test('settleBumpAction: UNKNOWN が確定しなければ見届けへ。auto-merge は付いていればそのまま', async () => {
  let waits = 0;
  const readPr = states(prState({ mergeable: 'UNKNOWN' }));
  const action = await settleBumpAction({ needed: true, readPr, polls: 3, wait: async () => { waits += 1; } });
  assert.deepEqual(action, { kind: 'watch', pr: 7, enableAutoMerge: false });
  assert.equal(waits, 3);
});

// 事件: 確定しないまま見届けに移るとき常に auto-merge を投げなかったので、auto-merge が外れた PR を dispatch し直すと、
// 見届けが suspect を 3 回見て必ず失敗した。
test('settleBumpAction: UNKNOWN が確定せず、キュー外で auto-merge が外れていれば有効にし直す', async () => {
  const readPr = states(prState({ mergeable: 'UNKNOWN', autoMergeRequest: null }));
  assert.deepEqual(await settleBumpAction({ needed: true, readPr, polls: 2, wait: async () => {} }), { kind: 'watch', pr: 7, enableAutoMerge: true });
  const queued = states(prState({ mergeable: 'UNKNOWN', autoMergeRequest: null, isInMergeQueue: true }));
  assert.deepEqual(await settleBumpAction({ needed: true, readPr: queued, polls: 2, wait: async () => {} }), { kind: 'watch', pr: 7, enableAutoMerge: false });
});

// 捕まえる変異: MERGED の判定を !needed の後ろに移す（needed=false で close を返して、マージ済みの PR を閉じに行く）。
test('bumpAction: needed=false でも、マージ済みの PR は閉じずに見届けへ', () => {
  assert.deepEqual(bumpAction({ needed: false, openPr: prState({ state: 'MERGED', mergeable: 'UNKNOWN', autoMergeRequest: null }) }), { kind: 'watch', pr: 7, enableAutoMerge: false });
});

// 捕まえる変異: CLOSED のときに needed を見ずに常に create を返す。
test('bumpAction: 閉じられた PR は、上げる必要があれば作り直し、なければ何もしない', () => {
  assert.deepEqual(bumpAction({ needed: true, openPr: prState({ state: 'CLOSED' }) }), { kind: 'create' });
  assert.deepEqual(bumpAction({ needed: false, openPr: prState({ state: 'CLOSED' }) }), { kind: 'none' });
});

// 有効にする直前にマージされると enable は失敗する。読み直してマージ済みなら見届けに進む。
test('enableAutoMergeOrMerged: enable が失敗しても、PR がマージ済みなら成功として扱う', async () => {
  const fail = async () => { throw new Error('Pull request is in clean status'); };
  assert.equal(await enableAutoMergeOrMerged({ enable: fail, readPr: async () => prState({ state: 'MERGED' }) }), 'merged');
  await assert.rejects(enableAutoMergeOrMerged({ enable: fail, readPr: async () => prState({ state: 'OPEN' }) }), /clean status/);
  assert.equal(await enableAutoMergeOrMerged({ enable: async () => {}, readPr: async () => null }), 'enabled');
});

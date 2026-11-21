import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bumpVersions, formatVersions, bumpBranch, bumpAction } from '../lib/bump.mjs';

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

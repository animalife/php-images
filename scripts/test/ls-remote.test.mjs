import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagCommit } from '../lib/ls-remote.mjs';

const a = 'a'.repeat(40);
const b = 'b'.repeat(40);

test('注釈付きタグは ^{} の行（commit）を使う', () => {
  assert.equal(tagCommit(`${a}\trefs/tags/v1.14.0\n${b}\trefs/tags/v1.14.0^{}\n`, 'v1.14.0'), b);
});

test('軽量タグはその行の値を使う', () => {
  assert.equal(tagCommit(`${a}\trefs/tags/v1.14.0\n`, 'v1.14.0'), a);
});

// 前方一致で拾うと v1.14.0-rc1 などの別タグを掴む。
test('タグ名は完全一致で比べる', () => {
  assert.equal(tagCommit(`${a}\trefs/tags/v1.14.0-rc1\n`, 'v1.14.0'), null);
});

test('無ければ null', () => {
  assert.equal(tagCommit('', 'v1.14.0'), null);
});

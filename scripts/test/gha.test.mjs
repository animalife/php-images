import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendSummary, env } from '../lib/gha.mjs';

// 捕まえる変異: optional の未定義変数を必須扱いにして例外にする（呼び出し側が渡さない入力で落ちる）。
test('optional の環境変数は未定義でも空文字を返す', () => {
  delete process.env.PHP_IMAGES_TEST_UNSET;
  assert.equal(env('PHP_IMAGES_TEST_UNSET', { optional: true }), '');
  assert.throws(() => env('PHP_IMAGES_TEST_UNSET'), /PHP_IMAGES_TEST_UNSET/);
});

test('必須の環境変数は空文字も例外にする', () => {
  process.env.PHP_IMAGES_TEST_EMPTY = '';
  assert.throws(() => env('PHP_IMAGES_TEST_EMPTY'), /PHP_IMAGES_TEST_EMPTY/);
  assert.equal(env('PHP_IMAGES_TEST_EMPTY', { optional: true }), '');
});

// 捕まえる変異: 上書きで書き、同じ job の前の step が書いた summary を消す。
test('step summary は GITHUB_STEP_SUMMARY のファイルに追記する', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gha-test-'));
  const saved = process.env.GITHUB_STEP_SUMMARY;
  try {
    process.env.GITHUB_STEP_SUMMARY = join(dir, 'summary.md');
    appendSummary('a');
    appendSummary('b');
    assert.equal(readFileSync(process.env.GITHUB_STEP_SUMMARY, 'utf8'), 'a\nb\n');
  } finally {
    if (saved === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

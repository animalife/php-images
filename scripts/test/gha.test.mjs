import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../lib/gha.mjs';

// ci.yml は PHP_VERSION_INPUT を渡さずに plan.mjs を呼ぶ。未定義を例外にすると CI Gate が常に落ちる。
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

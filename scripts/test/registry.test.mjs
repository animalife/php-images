import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNotFound } from '../lib/registry.mjs';

// imagetools inspect が存在しないタグで返す stderr（2026-11-21、docker buildx v0.38.1 で
// docker buildx imagetools inspect ghcr.io/animalife/php-images/php:nonexist を実行して確認した形）。
test('タグが無いときの stderr を not found と判定する', () => {
  assert.equal(isNotFound('ERROR: ghcr.io/animalife/php-images/php:8.6-cli-trixie: not found\n'), true);
  assert.equal(isNotFound('ERROR: localhost:5055/t/php:nonexist: not found'), true);
});

// 認証やネットワークの失敗を「タグが無い」と取り違えると、現行が無いものとして移動タグを動かしてしまう。
test('認証・ネットワークの失敗は not found にしない', () => {
  assert.equal(isNotFound('ERROR: failed to authorize: failed to fetch anonymous token: unexpected status: 401 Unauthorized'), false);
  assert.equal(isNotFound('ERROR: dial tcp: lookup ghcr.io: no such host'), false);
  assert.equal(isNotFound(''), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPermanentGraphqlError, isPermanentHttpStatus, prState } from '../lib/github.mjs';

// 権限不足などの恒久的なエラーを一時的な失敗として扱うと、2 時間ポーリングを続けてから期限切れで落ちる。
test('GraphQL の FORBIDDEN / NOT_FOUND / Resource not accessible は恒久的なエラー', () => {
  assert.equal(isPermanentGraphqlError([{ type: 'FORBIDDEN', message: 'x' }]), true);
  assert.equal(isPermanentGraphqlError([{ type: 'NOT_FOUND', message: 'x' }]), true);
  assert.equal(isPermanentGraphqlError([{ message: 'Resource not accessible by integration' }]), true);
  assert.equal(isPermanentGraphqlError([{ type: 'INTERNAL', message: 'Something went wrong' }]), false);
});

test('HTTP の 4xx（429 を除く）は恒久的、5xx と 429 は一時的', () => {
  assert.equal(isPermanentHttpStatus(403), true);
  assert.equal(isPermanentHttpStatus(404), true);
  assert.equal(isPermanentHttpStatus(422), true);
  assert.equal(isPermanentHttpStatus(429), false);
  assert.equal(isPermanentHttpStatus(502), false);
});

// bump は App のトークンで読むので、statusCheckRollup（Checks / Commit statuses の権限が要る）を含まない問い合わせを使う。
test('prState は statusCheckRollup や mergeQueueEntry が無い応答も読める', () => {
  const data = { repository: { pullRequest: { id: 'X', state: 'OPEN', mergeable: 'MERGEABLE', url: 'u', isInMergeQueue: false, autoMergeRequest: null } } };
  assert.deepEqual(prState(data), { id: 'X', url: 'u', state: 'OPEN', mergeable: 'MERGEABLE', autoMergeRequest: null, isInMergeQueue: false, rollup: null });
});

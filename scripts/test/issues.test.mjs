import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueTitle, nightIssueVersion } from '../lib/issues.mjs';

// 夜のジョブの失敗と push・復旧の失敗は Issue を分ける。無関係な push の成功で夜の失敗の記録が消えないように。
test('Issue のタイトルは、push・復旧と夜のジョブ（版ごと）で分ける', () => {
  assert.equal(issueTitle({ phpVersion: '' }), 'build ワークフローが main で失敗している');
  assert.equal(issueTitle({ phpVersion: '8.6.1' }), '夜のジョブが PHP 8.6.1 を上げられていない');
});

test('夜のジョブの Issue のタイトルから版を読む', () => {
  assert.equal(nightIssueVersion('夜のジョブが PHP 8.6.1 を上げられていない'), '8.6.1');
  assert.equal(nightIssueVersion('build ワークフローが main で失敗している'), null);
  assert.equal(nightIssueVersion('夜のジョブが PHP 8.6 を上げられていない'), null);
});

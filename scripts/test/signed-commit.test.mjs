import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAddArgs, parseNameStatusZ } from '../lib/signed-commit.mjs';

test('空の出力は変更なしと判定される', () => {
  assert.deepEqual(parseNameStatusZ(''), { addPaths: [], delPaths: [] });
});

test('変更(M)と追加(A)は addPaths に入る', () => {
  assert.deepEqual(parseNameStatusZ('M\0.github/aqua-checksums.json\0A\0new.json\0'), {
    addPaths: ['.github/aqua-checksums.json', 'new.json'],
    delPaths: [],
  });
});

test('削除(D)は delPaths に入る', () => {
  assert.deepEqual(parseNameStatusZ('D\0old.json\0'), { addPaths: [], delPaths: ['old.json'] });
});

// 捕まえる変異: R/C を 1 パスとして読み、以降のレコードがずれる。
test('リネーム(R)は旧パス削除と新パス追加に展開される', () => {
  assert.deepEqual(parseNameStatusZ('R100\0docs/old.md\0docs/new.md\0'), {
    addPaths: ['docs/new.md'],
    delPaths: ['docs/old.md'],
  });
});

test('コピー(C)は新パスの追加だけ（旧パスは消さない）', () => {
  assert.deepEqual(parseNameStatusZ('C100\0docs/base.md\0docs/copy.md\0'), {
    addPaths: ['docs/copy.md'],
    delPaths: [],
  });
});

test('型変更(T)は addPaths に入る', () => {
  assert.deepEqual(parseNameStatusZ('T\0bin/tool\0'), { addPaths: ['bin/tool'], delPaths: [] });
});

test('追加・変更・削除・リネームが混在しても振り分けがずれない', () => {
  const raw = 'A\0new/dir/file.md\0M\0README.md\0D\0removed.md\0R090\0a.md\0b.md\0M\0last.json\0';
  assert.deepEqual(parseNameStatusZ(raw), {
    addPaths: ['new/dir/file.md', 'README.md', 'b.md', 'last.json'],
    delPaths: ['removed.md', 'a.md'],
  });
});

test('ステージ対象のパスだけを -- の後ろに並べる', () => {
  assert.deepEqual(buildAddArgs('  .github/aqua-checksums.json \n .github/aqua-ci/aqua-checksums.json '), [
    'add',
    '--',
    '.github/aqua-checksums.json',
    '.github/aqua-ci/aqua-checksums.json',
  ]);
});

// 捕まえる変異: パスが空のとき `git add -A` に倒れ、作業ツリーに展開した信頼版スクリプト（.base-trusted）まで
// コミットに巻き込む。
test('ステージ対象のパスが空なら例外にする', () => {
  assert.throws(() => buildAddArgs(''), /COMMIT_PATHS/);
  assert.throws(() => buildAddArgs('   '), /COMMIT_PATHS/);
});

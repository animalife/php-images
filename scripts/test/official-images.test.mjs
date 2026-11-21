import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findTag } from '../lib/official-images.mjs';

const library = readFileSync(new URL('./fixtures/library-php.txt', import.meta.url), 'utf8');

test('追うタグの GitCommit と Directory を引く', () => {
  assert.deepEqual(findTag(library, '8.6-cli-trixie'), {
    gitRepo: 'https://github.com/docker-library/php.git',
    gitCommit: '3b25f4162a9bd144d3f447d03cb8fe16c0d2c9cc',
    directory: '8.6/trixie/cli',
  });
  assert.equal(findTag(library, '8.5-zts-trixie').directory, '8.5/trixie/zts');
});

// 文字列の部分一致で探すと、存在しない 8.6-cli-trix が 8.6-cli-trixie の stanza に当たる。
test('タグは Tags の要素と完全一致で探す', () => {
  assert.throws(() => findTag(library, '8.6-cli-trix'), /見つからない/);
  assert.equal(findTag(library, '8.6-cli').directory, '8.6/trixie/cli');
});

test('見つからなければ例外にする', () => {
  assert.throws(() => findTag(library, '8.7-cli-trixie'), /見つからない/);
});

test('同じタグが複数の stanza にあれば例外にする', () => {
  const dup = `${library}\nTags: 8.6-cli-trixie\nGitCommit: ${'a'.repeat(40)}\nDirectory: x\n`;
  assert.throws(() => findTag(dup, '8.6-cli-trixie'), /複数/);
});

test('stanza の GitRepo はヘッダの既定値より優先する', () => {
  const other = `GitRepo: https://github.com/docker-library/php.git\n\nTags: t1\nGitRepo: https://example.com/fork.git\nGitCommit: ${'b'.repeat(40)}\nDirectory: d\n`;
  assert.equal(findTag(other, 't1').gitRepo, 'https://example.com/fork.git');
});

test('GitCommit が 40 桁の 16 進でなければ例外にする', () => {
  const bad = 'GitRepo: https://github.com/docker-library/php.git\n\nTags: t1\nGitCommit: master\nDirectory: d\n';
  assert.throws(() => findTag(bad, 't1'), /GitCommit/);
});

test('Directory が無い・親ディレクトリへ出る値なら例外にする', () => {
  const head = `GitRepo: https://github.com/docker-library/php.git\n\nTags: t1\nGitCommit: ${'c'.repeat(40)}\n`;
  assert.throws(() => findTag(head, 't1'), /Directory/);
  assert.throws(() => findTag(`${head}Directory: ../x\n`, 't1'), /Directory/);
  assert.throws(() => findTag(`${head}Directory: /etc\n`, 't1'), /Directory/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSource } from '../lib/source.mjs';

const library = readFileSync(new URL('./fixtures/library-php.txt', import.meta.url), 'utf8');

test('パッチ付きのタグが library/php にあれば、その GitCommit / Directory から取る', () => {
  assert.deepEqual(resolveSource(library, '8.6.0-cli-trixie', '8.6-cli-trixie'), {
    gitRepo: 'https://github.com/docker-library/php.git',
    gitCommit: '3b25f4162a9bd144d3f447d03cb8fe16c0d2c9cc',
    directory: '8.6/trixie/cli',
    viaMoving: false,
  });
});

// official がまだ追いついていない（8.6.1）か、先へ進んでパッチ付きのタグが消えた場合。
test('パッチ付きのタグが無ければ移動タグから取る', () => {
  const r = resolveSource(library, '8.6.1-cli-trixie', '8.6-cli-trixie');
  assert.equal(r.viaMoving, true);
  assert.equal(r.directory, '8.6/trixie/cli');
});

test('移動タグも無ければ例外', () => {
  assert.throws(() => resolveSource(library, '8.7.0-cli-trixie', '8.7-cli-trixie'), /見つからない/);
});

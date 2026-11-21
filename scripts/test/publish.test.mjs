import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinsStale, decidePublish, tagsToApply, choosePhpBase } from '../lib/publish.mjs';

const digest = (c) => `sha256:${c.repeat(64)}`;
const versions = () => ({
  platforms: [{ platform: 'linux/amd64', runner: 'ubuntu-24.04' }],
  frankenphp: { repository: 'php/frankenphp', version: 'v1.14.0', commit: 'a'.repeat(40) },
  baseImages: {
    php: { 'debian:trixie-slim': digest('1') },
    frankenphp: { 'golang:1.27-trixie': digest('2') },
  },
  php: {
    '8.6': { os: 'trixie', officialTag: '8.6.0-cli-trixie', officialDigest: digest('3') },
    '8.5': { os: 'trixie', officialTag: '8.5.13-zts-trixie', officialDigest: digest('4') },
  },
});

test('php の古さは baseImages.php とその版の pin で決まる', () => {
  for (const mutate of [
    (v) => { v.baseImages.php['debian:trixie-slim'] = digest('5'); },
    (v) => { v.php['8.6'].officialTag = '8.6.1-cli-trixie'; },
  ]) {
    const main = versions();
    mutate(main);
    assert.equal(pinsStale(versions(), main, 'php', '8.6'), true, mutate.toString());
  }
});

// php イメージに関係しない pin まで比べると、FrankenPHP の更新だけで php が公開されなくなる。
test('FrankenPHP の pin や別の版の更新では php は古くならない', () => {
  const main = versions();
  main.frankenphp.version = 'v1.14.1';
  main.baseImages.frankenphp['golang:1.27-trixie'] = digest('6');
  main.php['8.5'].officialTag = '8.5.14-zts-trixie';
  assert.equal(pinsStale(versions(), main, 'php', '8.6'), false);
});

// officialDigest はビルドのきっかけで、Dockerfile はビルド時点の library/php から取るので内容の入力ではない。
test('officialDigest の更新（null から埋まる場合を含む）では古くならない', () => {
  const run = versions();
  run.php['8.6'].officialDigest = null;
  assert.equal(pinsStale(run, versions(), 'php', '8.6'), false);
  assert.equal(pinsStale(run, versions(), 'frankenphp', '8.6'), false);
});

test('FrankenPHP の古さは FrankenPHP の pin と両方の baseImages と php の pin で決まる', () => {
  for (const mutate of [
    (v) => { v.frankenphp.commit = 'b'.repeat(40); },
    (v) => { v.baseImages.frankenphp['golang:1.27-trixie'] = digest('9'); },
    (v) => { v.baseImages.php['debian:trixie-slim'] = digest('9'); },
    (v) => { v.php['8.6'].officialTag = '8.6.1-cli-trixie'; },
  ]) {
    const main = versions();
    mutate(main);
    assert.equal(pinsStale(versions(), main, 'frankenphp', '8.6'), true, mutate.toString());
  }
});

test('キーの順序が違うだけなら古くない', () => {
  const main = versions();
  main.frankenphp = { commit: main.frankenphp.commit, version: main.frankenphp.version, repository: main.frankenphp.repository };
  assert.equal(pinsStale(versions(), main, 'frankenphp', '8.6'), false);
});

test('pin が main の先端と一致すれば固定タグと移動タグを付ける', () => {
  assert.equal(decidePublish({ stale: false, runAttempt: '1' }), 'move');
  assert.equal(decidePublish({ stale: false, runAttempt: '2' }), 'move');
});

// 古い pin で組んだ run が、新しい pin のビルドを巻き戻さないため。main が先に進んでいれば、その push の run が組み直す。
test('pin が古ければタグを付けない', () => {
  assert.equal(decidePublish({ stale: true, runAttempt: '1' }), 'skip');
});

// 再実行（Re-run）した run には「後続の run が組み直す」前提が成り立たないので、skip で緑にせず失敗させる。
test('再実行した run の pin が古ければ失敗', () => {
  assert.throws(() => decidePublish({ stale: true, runAttempt: '2' }), /再実行/);
  assert.throws(() => decidePublish({ stale: false, runAttempt: '' }), /RUN_ATTEMPT/);
});

test('付けるタグは判定で決まる', () => {
  const tags = { fixed: '8.6.1-cli-trixie', moving: '8.6-cli-trixie' };
  assert.deepEqual(tagsToApply('move', 'ghcr.io/x/php', tags), ['ghcr.io/x/php:8.6.1-cli-trixie', 'ghcr.io/x/php:8.6-cli-trixie']);
  assert.deepEqual(tagsToApply('skip', 'ghcr.io/x/php', tags), []);
  assert.throws(() => tagsToApply('keep', 'ghcr.io/x/php', tags), /keep/);
});

const record = (decision) => ({ decision, digest: digest('a'), phpVersion: '8.6.1' });

test('php を作らなかった版の FrankenPHP は移動タグの php の上に組む', () => {
  assert.deepEqual(choosePhpBase({ built: false, record: null }), { source: 'moving' });
});

test('この run で php を作った版は、その digest の上に組む', () => {
  assert.deepEqual(choosePhpBase({ built: true, record: record('move') }), { source: 'own', digest: digest('a'), phpVersion: '8.6.1' });
});

test('この run の php が公開されなかった・結果が無いなら失敗', () => {
  assert.throws(() => choosePhpBase({ built: true, record: null }), /公開の結果/);
  assert.throws(() => choosePhpBase({ built: true, record: record('skip') }), /公開されていない/);
});

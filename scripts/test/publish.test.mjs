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
    '8.6': { os: 'trixie', officialTag: '8.6-cli-trixie', officialDigest: digest('3') },
    '8.5': { os: 'trixie', officialTag: '8.5-zts-trixie', officialDigest: digest('4') },
  },
});

test('php の古さは baseImages.php とその版の設定だけで決まる', () => {
  const main = versions();
  main.baseImages.php['debian:trixie-slim'] = digest('5');
  assert.equal(pinsStale(versions(), main, 'php', '8.6'), true);
});

// php イメージに関係しない pin まで比べると、FrankenPHP の更新だけで待機 run の php が公開されなくなる。
test('FrankenPHP の pin や別の版の更新では php は古くならない', () => {
  const main = versions();
  main.frankenphp.version = 'v1.14.1';
  main.baseImages.frankenphp['golang:1.27-trixie'] = digest('6');
  main.php['8.5'].officialDigest = digest('7');
  assert.equal(pinsStale(versions(), main, 'php', '8.6'), false);
});

// officialDigest はビルドのきっかけで、Dockerfile はビルド時点の library/php から取るので内容の入力ではない。
test('officialDigest の更新では古くならない', () => {
  const main = versions();
  main.php['8.6'].officialDigest = digest('8');
  assert.equal(pinsStale(versions(), main, 'php', '8.6'), false);
  assert.equal(pinsStale(versions(), main, 'frankenphp', '8.6'), false);
});

test('FrankenPHP の古さは FrankenPHP の pin と両方の baseImages で決まる', () => {
  for (const mutate of [
    (v) => { v.frankenphp.commit = 'b'.repeat(40); },
    (v) => { v.baseImages.frankenphp['golang:1.27-trixie'] = digest('9'); },
    (v) => { v.baseImages.php['debian:trixie-slim'] = digest('9'); },
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

test('push run: 新しければ移動タグを動かし、現行の方が新しければ固定タグだけ付ける', () => {
  assert.equal(decidePublish({ current: { php: '8.6.0' }, candidate: { php: '8.6.1' }, mustLand: false, stale: false }), 'move');
  assert.equal(decidePublish({ current: { php: '8.6.1' }, candidate: { php: '8.6.0' }, mustLand: false, stale: false }), 'keep');
});

// 古い pin で組んだ push run が、同じ版の固定タグや移動タグを新しい pin のビルドから巻き戻さないため。
// main が先に進んでいれば後続の run が組み直すので、この run はタグに触れずに終える。
test('push run: pin が main より古ければタグを付けない', () => {
  assert.equal(decidePublish({ current: { php: '8.6.0' }, candidate: { php: '8.6.0' }, mustLand: false, stale: true }), 'skip');
});

test('push run: 版の一方が上がり一方が下がるなら失敗', () => {
  assert.throws(() => decidePublish({
    current: { php: '8.6.0', frankenphp: 'v1.14.1' }, candidate: { php: '8.6.1', frankenphp: 'v1.14.0' }, mustLand: false, stale: false,
  }), /一方/);
});

// 事件: 待機 run の 8.6.1 が、待機中に FrankenPHP の pin を進めた push run（8.6.0）に移動タグを取られ、
// 警告だけで success になり、セキュリティ版がどの移動タグにも載らなかった。
test('待機 run: 移動タグに載せられないなら失敗させる', () => {
  assert.throws(() => decidePublish({ current: { php: '8.6.0' }, candidate: { php: '8.6.1' }, mustLand: true, stale: true }), /古い/);
  assert.throws(() => decidePublish({
    current: { php: '8.6.0', frankenphp: 'v1.14.1' }, candidate: { php: '8.6.1', frankenphp: 'v1.14.0' }, mustLand: true, stale: false,
  }), /一方/);
});

test('待機 run: 現行が同じかそれ以上の版をすべて持っていれば、固定タグだけで成功にする', () => {
  assert.equal(decidePublish({ current: { php: '8.6.2' }, candidate: { php: '8.6.1' }, mustLand: true, stale: false }), 'keep');
  assert.equal(decidePublish({ current: null, candidate: { php: '8.6.1' }, mustLand: true, stale: false }), 'move');
});

test('付けるタグは判定で決まる', () => {
  const tags = { fixed: '8.6.1-cli-trixie', moving: '8.6-cli-trixie' };
  assert.deepEqual(tagsToApply('move', 'ghcr.io/x/php', tags), ['ghcr.io/x/php:8.6.1-cli-trixie', 'ghcr.io/x/php:8.6-cli-trixie']);
  assert.deepEqual(tagsToApply('keep', 'ghcr.io/x/php', tags), ['ghcr.io/x/php:8.6.1-cli-trixie']);
  assert.deepEqual(tagsToApply('skip', 'ghcr.io/x/php', tags), []);
  assert.throws(() => tagsToApply('conflict', 'ghcr.io/x/php', tags), /conflict/);
});

const record = (decision) => ({ decision, digest: digest('a'), phpVersion: '8.6.1' });

test('php を作らなかった版の FrankenPHP は移動タグの php の上に組む', () => {
  assert.deepEqual(choosePhpBase({ built: false, record: null, mustLand: false }), { source: 'moving' });
});

test('この run で php を作るはずだった版に公開の結果が無ければ失敗', () => {
  assert.throws(() => choosePhpBase({ built: true, record: null, mustLand: false }), /公開の結果/);
});

test('push run: 移動タグを動かしたときだけ自分の php の上に組む', () => {
  assert.deepEqual(choosePhpBase({ built: true, record: record('move'), mustLand: false }), { source: 'own', digest: digest('a'), phpVersion: '8.6.1' });
  assert.deepEqual(choosePhpBase({ built: true, record: record('keep'), mustLand: false }), { source: 'moving' });
  assert.deepEqual(choosePhpBase({ built: true, record: record('skip'), mustLand: false }), { source: 'moving' });
});

test('待機 run: FrankenPHP は必ず自分がビルドした php の上に組む', () => {
  assert.deepEqual(choosePhpBase({ built: true, record: record('keep'), mustLand: true }), { source: 'own', digest: digest('a'), phpVersion: '8.6.1' });
  assert.throws(() => choosePhpBase({ built: false, record: null, mustLand: true }), /待機/);
});

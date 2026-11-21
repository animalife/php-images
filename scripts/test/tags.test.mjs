import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, phpTags, frankenphpTags, canMoveTag, currentFromImage } from '../lib/tags.mjs';

test('compareVersions は数値として比べる', () => {
  assert.equal(compareVersions('8.6.10', '8.6.9'), 1);
  assert.equal(compareVersions('8.6.0', '8.6.0'), 0);
  assert.equal(compareVersions('1.9.0', '1.14.0'), -1);
  assert.throws(() => compareVersions('8.6', '8.6.0'), /版/);
});

test('php のタグは「版-variant-os」と追うタグと同名の移動タグ', () => {
  assert.deepEqual(phpTags({ phpVersion: '8.6.1', officialTag: '8.6-cli-trixie', os: 'trixie' }), {
    fixed: '8.6.1-cli-trixie',
    moving: '8.6-cli-trixie',
  });
  assert.deepEqual(phpTags({ phpVersion: '8.5.14', officialTag: '8.5-zts-trixie', os: 'trixie' }), {
    fixed: '8.5.14-zts-trixie',
    moving: '8.5-zts-trixie',
  });
});

test('php の版が追うタグの minor と違えば例外にする', () => {
  assert.throws(() => phpTags({ phpVersion: '8.7.0', officialTag: '8.6-cli-trixie', os: 'trixie' }), /minor/);
});

test('frankenphp のタグは dunglas/frankenphp と同じ「fp版-php版-os」と移動タグ', () => {
  assert.deepEqual(frankenphpTags({ frankenphpVersion: 'v1.14.0', phpVersion: '8.6.1', os: 'trixie' }), {
    fixed: '1.14.0-php8.6.1-trixie',
    moving: 'php8.6-trixie',
  });
});

test('移動タグは前へしか動かさない', () => {
  assert.equal(canMoveTag(null, { php: '8.6.0' }), 'move');
  assert.equal(canMoveTag({ php: '8.6.0' }, { php: '8.6.1' }), 'move');
  assert.equal(canMoveTag({ php: '8.6.1' }, { php: '8.6.1' }), 'move');
  assert.equal(canMoveTag({ php: '8.6.1' }, { php: '8.6.0' }), 'keep');
});

test('frankenphp の移動タグは FrankenPHP と PHP のどちらも戻らないときだけ動かす', () => {
  const cur = { php: '8.6.1', frankenphp: 'v1.14.0' };
  assert.equal(canMoveTag(cur, { php: '8.6.1', frankenphp: 'v1.14.1' }), 'move');
  assert.equal(canMoveTag(cur, { php: '8.6.2', frankenphp: 'v1.14.0' }), 'move');
  assert.equal(canMoveTag(cur, { php: '8.6.1', frankenphp: 'v1.13.6' }), 'keep');
});

// 待機中に FrankenPHP の pin だけが上がった run が先に移動タグを取ると、後から終わるパッチ入りの run が
// 「FrankenPHP は古い・PHP は新しい」になる。黙って keep にするとパッチが移動タグに届かないまま緑で終わる。
test('片方が上がり片方が下がるなら conflict（人が判断する）', () => {
  const cur = { php: '8.6.0', frankenphp: 'v1.14.1' };
  assert.equal(canMoveTag(cur, { php: '8.6.1', frankenphp: 'v1.14.0' }), 'conflict');
  assert.equal(canMoveTag(cur, { php: '8.5.99', frankenphp: 'v1.15.0' }), 'conflict');
});

test('現行の版が読めない値なら移動を止める（壊れたラベルで黙って上書きしない）', () => {
  assert.throws(() => canMoveTag({ php: '' }, { php: '8.6.1' }), /版/);
});

// docker buildx imagetools inspect --format '{{json .Image}}' の出力（マルチアーキではプラットフォームごとの map）。
const imageJson = (php, fp) => {
  const config = (p) => ({
    config: {
      Env: ['PATH=/usr/local/bin', `PHP_VERSION=${p}`],
      Labels: fp === undefined ? null : { 'org.opencontainers.image.version': fp },
    },
  });
  return { 'linux/amd64': config(php), 'linux/arm64': config(php) };
};

test('現行イメージの設定から php の版を読む', () => {
  assert.deepEqual(currentFromImage(imageJson('8.6.0'), ['php']), { php: '8.6.0' });
});

test('現行イメージの設定から FrankenPHP と php の版を読む', () => {
  assert.deepEqual(currentFromImage(imageJson('8.6.0', 'v1.14.0'), ['php', 'frankenphp']), { php: '8.6.0', frankenphp: 'v1.14.0' });
});

test('単一プラットフォームの出力（map ではなく設定そのもの）も読む', () => {
  assert.deepEqual(currentFromImage(imageJson('8.6.0')['linux/amd64'], ['php']), { php: '8.6.0' });
});

test('プラットフォーム間で版が食い違えば例外にする', () => {
  const j = imageJson('8.6.0');
  j['linux/arm64'].config.Env = ['PHP_VERSION=8.6.1'];
  assert.throws(() => currentFromImage(j, ['php']), /食い違/);
});

test('版が読めなければ例外にする', () => {
  assert.throws(() => currentFromImage(imageJson('8.6.0'), ['php', 'frankenphp']), /frankenphp/);
});

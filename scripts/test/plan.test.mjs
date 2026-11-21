import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateVersions, computePlan } from '../lib/plan.mjs';

const digest = (c) => `sha256:${c.repeat(64)}`;
const base = () => ({
  platforms: [
    { platform: 'linux/amd64', runner: 'ubuntu-24.04' },
    { platform: 'linux/arm64', runner: 'ubuntu-24.04-arm' },
  ],
  frankenphp: { repository: 'php/frankenphp', version: 'v1.14.0', commit: 'a'.repeat(40) },
  baseImages: {
    php: { 'debian:trixie-slim': digest('7') },
    frankenphp: { 'golang:1.27-trixie': digest('8'), 'docker/dockerfile:1': digest('9') },
  },
  php: {
    '8.6': { os: 'trixie', officialTag: '8.6.0-cli-trixie', officialDigest: digest('1') },
    '8.5': { os: 'trixie', officialTag: '8.5.13-zts-trixie', officialDigest: digest('2') },
  },
});

const versionsOf = (plan) => ({ php: plan.phpVersions, frankenphp: plan.frankenphpVersions });

test('validateVersions は正しい設定を通す', () => {
  assert.doesNotThrow(() => validateVersions(base()));
});

test('validateVersions は追うタグと minor / os の食い違いを弾く', () => {
  const v = base();
  v.php['8.6'].officialTag = '8.5.0-cli-trixie';
  assert.throws(() => validateVersions(v), /officialTag/);
  const w = base();
  w.php['8.6'].officialTag = '8.6.0-cli-bookworm';
  assert.throws(() => validateVersions(w), /officialTag/);
});

test('validateVersions は形式の崩れた値を弾く', () => {
  const cases = [
    (v) => { v.php['8.6'].officialDigest = 'sha256:abc'; },
    (v) => { v.frankenphp.version = '1.14.0'; },
    (v) => { v.frankenphp.commit = 'main'; },
    (v) => { v.php['8.x'] = v.php['8.6']; },
    (v) => { v.php['8.6'].officialTag = '8.6.0-fpm-trixie'; },
    // 上流の php_base_variant: 8.6 以上は cli、未満は zts。逆を書くと ZTS でない php の上に組むことになる。
    (v) => { v.php['8.6'].officialTag = '8.6.0-zts-trixie'; },
    (v) => { v.php['8.5'].officialTag = '8.5.13-cli-trixie'; },
    (v) => { v.php = {}; },
    (v) => { v.platforms = []; },
    (v) => { delete v.baseImages.frankenphp; },
    (v) => { v.baseImages.php['debian:trixie-slim'] = 'trixie'; },
    (v) => { v.baseImages.php.debian = digest('7'); },
    (v) => { v.baseImages.php['debian:trixie-slim@sha256:x'] = digest('7'); },
    (v) => { v.platforms[0].platform = 'linux/arm/v7'; },
  ];
  for (const mutate of cases) {
    const v = base();
    mutate(v);
    assert.throws(() => validateVersions(v), undefined, mutate.toString());
  }
});

test('push: php の pin が変わった版だけ php と frankenphp をビルドする', () => {
  const before = base();
  const after = base();
  after.php['8.6'].officialDigest = digest('3');
  const plan = computePlan({ event: 'push', before, after, changedFiles: ['versions.json'] });
  assert.deepEqual(versionsOf(plan), { php: ['8.6'], frankenphp: ['8.6'] });
  assert.equal(plan.waitFor, '');
});

test('push: FrankenPHP の pin だけが変わったら php は飛ばし frankenphp を全版ビルドする', () => {
  const before = base();
  const after = base();
  after.frankenphp.version = 'v1.14.1';
  after.frankenphp.commit = 'b'.repeat(40);
  const plan = computePlan({ event: 'push', before, after, changedFiles: ['versions.json'] });
  assert.deepEqual(versionsOf(plan), { php: [], frankenphp: ['8.5', '8.6'] });
});

test('push: 新しく足した版は両方ビルドする', () => {
  const before = base();
  delete before.php['8.5'];
  const plan = computePlan({ event: 'push', before, after: base(), changedFiles: ['versions.json'] });
  assert.deepEqual(versionsOf(plan), { php: ['8.5'], frankenphp: ['8.5'] });
});

test('push: versions.json 以外（ワークフローやスクリプト）が変わったら全部ビルドする', () => {
  const plan = computePlan({ event: 'push', before: base(), after: base(), changedFiles: ['scripts/lib/plan.mjs'] });
  assert.deepEqual(versionsOf(plan), { php: ['8.5', '8.6'], frankenphp: ['8.5', '8.6'] });
});

test('push: ビルドに関わらないファイル（README など）だけの変更では何もビルドしない', () => {
  const plan = computePlan({ event: 'push', before: base(), after: base(), changedFiles: ['README.md', 'renovate.json5', '.github/workflows/ci.yml', 'scripts/test/plan.test.mjs'] });
  assert.deepEqual(versionsOf(plan), { php: [], frankenphp: [] });
});

test('push: ビルドの入力（ワークフロー・aqua・テスト定義・スクリプト）が変わったら全部ビルドする', () => {
  for (const f of ['.github/workflows/build.yml', '.github/actions/publish-image/action.yml', '.github/aqua.yaml', '.github/aqua-checksums.json', 'tests/php/container-structure-test.yaml', 'scripts/plan.mjs', 'scripts/lib/tags.mjs', '.node-version']) {
    const plan = computePlan({ event: 'push', before: base(), after: base(), changedFiles: ['versions.json', f] });
    assert.deepEqual(versionsOf(plan), { php: ['8.5', '8.6'], frankenphp: ['8.5', '8.6'] }, f);
  }
});

test('push: platforms が変わったら全部ビルドする', () => {
  const after = base();
  after.platforms = after.platforms.slice(0, 1);
  const plan = computePlan({ event: 'push', before: base(), after, changedFiles: ['versions.json'] });
  assert.deepEqual(versionsOf(plan), { php: ['8.5', '8.6'], frankenphp: ['8.5', '8.6'] });
});

test('push: php の親イメージの pin が変わったら php と frankenphp を全版ビルドする', () => {
  const after = base();
  after.baseImages.php['debian:trixie-slim'] = digest('6');
  const plan = computePlan({ event: 'push', before: base(), after, changedFiles: ['versions.json'] });
  assert.deepEqual(versionsOf(plan), { php: ['8.5', '8.6'], frankenphp: ['8.5', '8.6'] });
});

test('push: FrankenPHP の親イメージの pin だけが変わったら frankenphp だけ全版ビルドする', () => {
  const after = base();
  after.baseImages.frankenphp['golang:1.27-trixie'] = digest('6');
  const plan = computePlan({ event: 'push', before: base(), after, changedFiles: ['versions.json'] });
  assert.deepEqual(versionsOf(plan), { php: [], frankenphp: ['8.5', '8.6'] });
});

test('push: 変更前の設定が無い（初回 push・履歴が読めない）なら全部ビルドする', () => {
  const plan = computePlan({ event: 'push', before: null, after: base(), changedFiles: null });
  assert.deepEqual(versionsOf(plan), { php: ['8.5', '8.6'], frankenphp: ['8.5', '8.6'] });
});

test('push: 何も変わっていなければ何もビルドしない', () => {
  const plan = computePlan({ event: 'push', before: base(), after: base(), changedFiles: ['versions.json'] });
  assert.deepEqual(versionsOf(plan), { php: [], frankenphp: [] });
  assert.deepEqual(plan.phpBuilds, []);
});

test('workflow_dispatch（版の指定なし）は全部ビルドする', () => {
  const plan = computePlan({ event: 'workflow_dispatch', after: base(), phpVersion: '' });
  assert.deepEqual(versionsOf(plan), { php: ['8.5', '8.6'], frankenphp: ['8.5', '8.6'] });
  assert.equal(plan.waitFor, '');
});

// 夜のジョブは自分では公開しない。公開を待って versions.json を上げる PR を作り、普段の push の経路に乗せる。
test('workflow_dispatch（版の指定あり）はビルドせず、その版を待つだけ', () => {
  const plan = computePlan({ event: 'workflow_dispatch', after: base(), phpVersion: '8.6.1' });
  assert.deepEqual(versionsOf(plan), { php: [], frankenphp: [] });
  assert.equal(plan.waitFor, '8.6.1');
});

test('workflow_dispatch の版は x.y.z で、設定にある minor に限る', () => {
  assert.throws(() => computePlan({ event: 'workflow_dispatch', after: base(), phpVersion: '8.7.0' }), /8\.7/);
  assert.throws(() => computePlan({ event: 'workflow_dispatch', after: base(), phpVersion: '8.6' }), /版/);
  assert.throws(() => computePlan({ event: 'workflow_dispatch', after: base(), phpVersion: ' 8.6.1' }), /版/);
});

test('想定外のイベントは例外にする', () => {
  assert.throws(() => computePlan({ event: 'schedule', after: base() }), /schedule/);
});

test('ビルド行列は版 × プラットフォームで、ジョブが要る値を持つ', () => {
  const after = base();
  delete after.php['8.5'];
  const plan = computePlan({ event: 'workflow_dispatch', after, phpVersion: '' });
  const pin = { version: '8.6', phpVersion: '8.6.0', os: 'trixie', variant: 'cli', officialTag: '8.6.0-cli-trixie', movingTag: '8.6-cli-trixie' };
  assert.deepEqual(plan.phpBuilds, [
    { ...pin, platform: 'linux/amd64', runner: 'ubuntu-24.04', slug: '8.6-linux-amd64' },
    { ...pin, platform: 'linux/arm64', runner: 'ubuntu-24.04-arm', slug: '8.6-linux-arm64' },
  ]);
  assert.deepEqual(plan.frankenphpBuilds, plan.phpBuilds);
  assert.deepEqual(plan.phpPublishes, [pin]);
});

test('validateVersions は、夜のジョブが版だけを上げた（officialDigest が null）設定を通す', () => {
  const v = base();
  v.php['8.6'].officialTag = '8.6.1-cli-trixie';
  v.php['8.6'].officialDigest = null;
  assert.doesNotThrow(() => validateVersions(v));
});

test('validateVersions は officialTag のパッチ版の形を検査する', () => {
  for (const tag of ['8.6-cli-trixie', '8.6.01-cli-trixie', '8.6.x-cli-trixie', '8.7.0-cli-trixie']) {
    const v = base();
    v.php['8.6'].officialTag = tag;
    assert.throws(() => validateVersions(v), /officialTag/, tag);
  }
  const v = base();
  v.php['8.6'].officialDigest = '';
  assert.throws(() => validateVersions(v), /officialDigest/);
});

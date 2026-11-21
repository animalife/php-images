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
  php: {
    '8.6': { os: 'trixie', officialTag: '8.6-cli-trixie', officialDigest: digest('1') },
    '8.5': { os: 'trixie', officialTag: '8.5-zts-trixie', officialDigest: digest('2') },
  },
});

const versionsOf = (plan) => ({ php: plan.phpVersions, frankenphp: plan.frankenphpVersions });

test('validateVersions は正しい設定を通す', () => {
  assert.doesNotThrow(() => validateVersions(base()));
});

test('validateVersions は追うタグと minor / os の食い違いを弾く', () => {
  const v = base();
  v.php['8.6'].officialTag = '8.5-cli-trixie';
  assert.throws(() => validateVersions(v), /officialTag/);
  const w = base();
  w.php['8.6'].officialTag = '8.6-cli-bookworm';
  assert.throws(() => validateVersions(w), /officialTag/);
});

test('validateVersions は形式の崩れた値を弾く', () => {
  const cases = [
    (v) => { v.php['8.6'].officialDigest = 'sha256:abc'; },
    (v) => { v.frankenphp.version = '1.14.0'; },
    (v) => { v.frankenphp.commit = 'main'; },
    (v) => { v.php['8.x'] = v.php['8.6']; },
    (v) => { v.php['8.6'].officialTag = '8.6-fpm-trixie'; },
    // 上流の php_base_variant: 8.6 以上は cli、未満は zts。逆を書くと ZTS でない php の上に組むことになる。
    (v) => { v.php['8.6'].officialTag = '8.6-zts-trixie'; },
    (v) => { v.php['8.5'].officialTag = '8.5-cli-trixie'; },
    (v) => { v.php = {}; },
    (v) => { v.platforms = []; },
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

test('workflow_dispatch（版の指定あり）はその minor だけを待ってビルドする', () => {
  const plan = computePlan({ event: 'workflow_dispatch', after: base(), phpVersion: '8.6.1' });
  assert.deepEqual(versionsOf(plan), { php: ['8.6'], frankenphp: ['8.6'] });
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
  const plan = computePlan({ event: 'workflow_dispatch', after: base(), phpVersion: '8.6.1' });
  assert.deepEqual(plan.phpBuilds, [
    { version: '8.6', os: 'trixie', officialTag: '8.6-cli-trixie', platform: 'linux/amd64', runner: 'ubuntu-24.04', slug: '8.6-linux-amd64' },
    { version: '8.6', os: 'trixie', officialTag: '8.6-cli-trixie', platform: 'linux/arm64', runner: 'ubuntu-24.04-arm', slug: '8.6-linux-arm64' },
  ]);
  assert.deepEqual(plan.frankenphpBuilds, plan.phpBuilds);
  assert.deepEqual(plan.phpPublishes, [{ version: '8.6', os: 'trixie', officialTag: '8.6-cli-trixie' }]);
});

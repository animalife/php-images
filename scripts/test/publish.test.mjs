import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinsStale, decidePublish, tagsToApply, planFrankenphp, assessPr, needsMainCheck } from '../lib/publish.mjs';

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

// 事件: officialDigest を比べていなかったので、古い run の再実行が、digest の更新で組み直した新しい run の中身を
// 古いアーカイブで上書きできた。
test('officialDigest の更新でも古くなる（null から埋まる場合を含む）', () => {
  const run = versions();
  run.php['8.6'].officialDigest = null;
  assert.equal(pinsStale(run, versions(), 'php', '8.6'), true);
  assert.equal(pinsStale(run, versions(), 'frankenphp', '8.6'), true);
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
const pub = (version) => ({ version, phpVersion: `${version}.1`, os: 'trixie', variant: 'cli', officialTag: `${version}.1-cli-trixie`, movingTag: `${version}-cli-trixie` });

test('planFrankenphp: php を作らなかった版は移動タグの php、作った版はその digest の上に組む', () => {
  const out = planFrankenphp({ publishes: [pub('8.5'), pub('8.6')], phpVersions: ['8.6'], records: { '8.6': record('move') } });
  assert.deepEqual(out.map((o) => [o.version, o.base.source]), [['8.5', 'moving'], ['8.6', 'own']]);
  assert.equal(out[1].base.digest, digest('a'));
});

// php を skip した版は main が先へ進んでいるので、FrankenPHP もその版は必ず古い。失敗にせず外す。
test('planFrankenphp: php が skip になった版は FrankenPHP も外す（失敗にしない）', () => {
  const out = planFrankenphp({ publishes: [pub('8.6')], phpVersions: ['8.6'], records: { '8.6': record('skip') } });
  assert.deepEqual(out, []);
});

test('planFrankenphp: この run で php を作るはずだった版に公開の結果が無ければ失敗', () => {
  assert.throws(() => planFrankenphp({ publishes: [pub('8.6')], phpVersions: ['8.6'], records: {} }), /公開の結果/);
});

const pr = (o) => ({ state: 'OPEN', mergeable: 'MERGEABLE', autoMergeRequest: {}, rollup: 'PENDING', ...o });

test('assessPr: マージされれば merged、チェック中・キュー待ちは pending', () => {
  assert.equal(assessPr(pr({ state: 'MERGED' })), 'merged');
  assert.equal(assessPr(pr({})), 'pending');
  assert.equal(assessPr(pr({ rollup: 'SUCCESS' })), 'pending');
  assert.equal(assessPr(pr({ mergeable: 'UNKNOWN', rollup: null })), 'pending');
});

// 夜の PR が CI やキューで落ちても、App にしか通知が行かず誰も気付けなかったため、run を失敗させて人に届ける。
test('assessPr: 閉じられた・conflict・チェックの失敗・auto-merge が外れたなら例外', () => {
  assert.throws(() => assessPr(pr({ state: 'CLOSED' })), /閉じられた/);
  assert.throws(() => assessPr(pr({ mergeable: 'CONFLICTING' })), /conflict/);
  assert.throws(() => assessPr(pr({ rollup: 'FAILURE' })), /チェック/);
  assert.throws(() => assessPr(pr({ rollup: 'ERROR' })), /チェック/);
  assert.throws(() => assessPr(pr({ autoMergeRequest: null })), /auto-merge/);
});

// auto-merge 経由でマージキューに入ると autoMergeRequest が消えうる（未確定）。どちらでも誤報にならないよう、
// キューに入っている間は pending にする。
test('assessPr: マージキューに入っている間は auto-merge が無くても pending', () => {
  assert.equal(assessPr(pr({ autoMergeRequest: null, isInMergeQueue: true })), 'pending');
  assert.equal(assessPr(pr({ isInMergeQueue: true })), 'pending');
});

// official が追いついて Renovate の patch PR が先にマージされると、夜の PR は conflict か閉じられる。main がすでに
// その版なら目的は果たしているので失敗にしない。
test('assessPr: conflict・閉じられたでも、main がすでにその版以上なら superseded', () => {
  assert.equal(assessPr(pr({ mergeable: 'CONFLICTING' }), { mainCovers: true }), 'superseded');
  assert.equal(assessPr(pr({ state: 'CLOSED' }), { mainCovers: true }), 'superseded');
  assert.throws(() => assessPr(pr({ mergeable: 'CONFLICTING' }), { mainCovers: false }), /conflict/);
});

test('assessPr: main がその版以上かを確かめる必要があるのは、閉じられた・conflict のときだけ', () => {
  assert.equal(needsMainCheck(pr({ state: 'CLOSED' })), true);
  assert.equal(needsMainCheck(pr({ mergeable: 'CONFLICTING' })), true);
  assert.equal(needsMainCheck(pr({ state: 'MERGED' })), false);
  assert.equal(needsMainCheck(pr({})), false);
});

// 再実行（Re-run failed jobs）は最大 3 日前のアーカイブを使うので、pin とビルドの入力が同じでも、
// main の先端の commit の run でなければ公開しない（Debian のパッケージが後退しうる）。
test('decidePublish: 再実行した run は、main の先端の commit でなければ失敗', () => {
  assert.throws(() => decidePublish({ stale: false, runAttempt: '2', atMainHead: false }), /先端/);
  assert.equal(decidePublish({ stale: false, runAttempt: '2', atMainHead: true }), 'move');
  assert.equal(decidePublish({ stale: false, runAttempt: '1', atMainHead: false }), 'move');
});

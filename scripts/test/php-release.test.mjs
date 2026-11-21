import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRelease, releaseUrl } from '../lib/php-release.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('公開済みの版ならリリース情報を返す', () => {
  const r = parseRelease(fixture('php-release-8.6.0.json'), '8.6.0');
  assert.equal(r.version, '8.6.0');
  assert.ok(r.source.some((s) => s.filename === 'php-8.6.0.tar.xz'));
});

// php.net は未知の版でも HTTP 200 で {"error":"Unknown version"} を返す（2026-11-21、
// curl -sS -w "%{http_code}" "https://www.php.net/releases/index.php?json&version=8.6.1" で確認）。fixture はその本文。
test('未公開の版（error を返す）は null', () => {
  assert.equal(parseRelease(fixture('php-release-unknown.json'), '8.6.1'), null);
});

test('応答の version が求めた版と違えば null', () => {
  assert.equal(parseRelease(fixture('php-release-8.6.0.json'), '8.6.1'), null);
});

test('source が配列でなければ例外にする（形式の変化を未公開と取り違えない）', () => {
  assert.throws(() => parseRelease({ version: '8.6.0' }, '8.6.0'), /source/);
});

test('問い合わせ URL は版を指定した JSON', () => {
  assert.equal(releaseUrl('8.6.1'), 'https://www.php.net/releases/index.php?json&version=8.6.1');
  assert.throws(() => releaseUrl('8.6'), /版/);
  assert.throws(() => releaseUrl('8.6.1&x=1'), /版/);
});

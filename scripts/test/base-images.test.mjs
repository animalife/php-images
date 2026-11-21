import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dockerfileRefs, pinBaseImages } from '../lib/base-images.mjs';

const read = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const d = (c) => `sha256:${c.repeat(64)}`;

test('docker-library/php の Dockerfile から親イメージを読む', () => {
  assert.deepEqual(dockerfileRefs(read('php-8.6-trixie-cli.Dockerfile')), {
    syntax: null, stages: [], refs: ['debian:trixie-slim'],
  });
});

// fixture は php/frankenphp v1.14.0 の Dockerfile（FROM php-base / common、COPY --from=golang-base / builder、# syntax=）。
test('FrankenPHP の Dockerfile からステージ名・--from・syntax を読む', () => {
  assert.deepEqual(dockerfileRefs(read('frankenphp-v1.14.0.Dockerfile')), {
    syntax: 'docker/dockerfile:1',
    stages: ['common', 'builder', 'runner'],
    refs: ['php-base', 'common', 'golang-base', 'builder'],
  });
});

test('FROM のフラグと AS を読み飛ばし、変数入りの参照は検査できないので例外にする', () => {
  const r = dockerfileRefs('FROM --platform=linux/amd64 alpine:3.21 AS a\nFROM a\n');
  assert.deepEqual(r.refs, ['alpine:3.21', 'a']);
  assert.throws(() => dockerfileRefs('ARG BASE=debian\nFROM ${BASE}:trixie\n'), /変数/);
});

test('php: pin した親イメージを名前付きコンテキストで差し替える', () => {
  const out = pinBaseImages({
    dockerfile: read('php-8.6-trixie-cli.Dockerfile'),
    pins: { 'debian:trixie-slim': d('1') },
  });
  assert.deepEqual(out, {
    contexts: { 'debian:trixie-slim': `docker-image://debian:trixie-slim@${d('1')}` },
    syntax: null,
  });
});

test('pin していない親イメージを参照していたら例外にする（上流が親を変えたら止める）', () => {
  const df = read('php-8.6-trixie-cli.Dockerfile').replace('FROM debian:trixie-slim', 'FROM debian:forky-slim');
  assert.throws(() => pinBaseImages({ dockerfile: df, pins: { 'debian:trixie-slim': d('1') } }), /debian:forky-slim/);
});

test('FrankenPHP: bake の docker-image コンテキストと syntax を pin で差し替え、php-base は除く', () => {
  const out = pinBaseImages({
    dockerfile: read('frankenphp-v1.14.0.Dockerfile'),
    contexts: { 'php-base': 'docker-image://php:8.6-cli-trixie', 'golang-base': 'docker-image://golang:1.27-trixie' },
    exempt: ['php-base'],
    pins: { 'golang:1.27-trixie': d('2'), 'docker/dockerfile:1': d('3') },
  });
  assert.deepEqual(out, {
    contexts: { 'golang-base': `docker-image://golang:1.27-trixie@${d('2')}` },
    syntax: `docker/dockerfile:1@${d('3')}`,
  });
});

test('FrankenPHP: 上流が GO_VERSION を上げて pin と合わなくなったら例外にする', () => {
  assert.throws(() => pinBaseImages({
    dockerfile: read('frankenphp-v1.14.0.Dockerfile'),
    contexts: { 'php-base': 'docker-image://php:8.6-cli-trixie', 'golang-base': 'docker-image://golang:1.28-trixie' },
    exempt: ['php-base'],
    pins: { 'golang:1.27-trixie': d('2'), 'docker/dockerfile:1': d('3') },
  }), /golang:1\.28-trixie/);
});

test('syntax を pin していなければ例外にする', () => {
  assert.throws(() => pinBaseImages({
    dockerfile: read('frankenphp-v1.14.0.Dockerfile'),
    contexts: { 'php-base': 'x', 'golang-base': 'docker-image://golang:1.27-trixie' },
    exempt: ['php-base'],
    pins: { 'golang:1.27-trixie': d('2') },
  }), /docker\/dockerfile:1/);
});

test('bake のコンテキストが docker-image 以外（ローカルのディレクトリなど）なら例外にする', () => {
  assert.throws(() => pinBaseImages({
    dockerfile: 'FROM x\n',
    contexts: { x: 'target:other' },
    pins: {},
  }), /target:other/);
});

test('すでに digest で固定された参照はそのまま通す', () => {
  const out = pinBaseImages({ dockerfile: `FROM debian@${d('4')}\n`, pins: {} });
  assert.deepEqual(out, { contexts: {}, syntax: null });
});

// BuildKit はパーサディレクティブ以外のコメントを読んだ時点でディレクティブを探すのをやめる。
// 普通のコメントの後ろの # syntax= を拾うと、上流が使っていないフロントエンドを強制してしまう。
test('普通のコメントの後ろの # syntax= はディレクティブとして扱わない', () => {
  assert.equal(dockerfileRefs('# hello\n# syntax=docker/dockerfile:1.4\nFROM scratch\n').syntax, null);
  assert.equal(dockerfileRefs('# check=error=true\n# syntax=docker/dockerfile:1\nFROM scratch\n').syntax, 'docker/dockerfile:1');
});

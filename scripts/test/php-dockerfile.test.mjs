import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPhpEnv, setPhpVersion } from '../lib/php-dockerfile.mjs';

const dockerfile = readFileSync(new URL('./fixtures/php-8.6-trixie-cli.Dockerfile', import.meta.url), 'utf8');

const sha = (c) => c.repeat(64);
const release861 = {
  version: '8.6.1',
  source: [
    { filename: 'php-8.6.1.tar.gz', sha256: sha('a') },
    { filename: 'php-8.6.1.tar.xz', sha256: sha('b') },
  ],
};

test('上流の Dockerfile から PHP の ENV を読む', () => {
  assert.deepEqual(readPhpEnv(dockerfile), {
    version: '8.6.0',
    url: 'https://www.php.net/distributions/php-8.6.0.tar.xz',
    ascUrl: 'https://www.php.net/distributions/php-8.6.0.tar.xz.asc',
    sha256: '5f84beaa3d763aee1e4feed99bf54ec692c383b322e25626807b589238c3a087',
  });
});

test('新しい版なら PHP_VERSION / URL / SHA256 だけを差し替える', () => {
  const { text, overridden } = setPhpVersion(dockerfile, release861);
  assert.equal(overridden, true);
  assert.deepEqual(readPhpEnv(text), {
    version: '8.6.1',
    url: 'https://www.php.net/distributions/php-8.6.1.tar.xz',
    ascUrl: 'https://www.php.net/distributions/php-8.6.1.tar.xz.asc',
    sha256: sha('b'),
  });
  // 差し替える 3 行以外（GPG_KEYS や署名検証の RUN）は 1 文字も変えない。
  const changed = text.split('\n').filter((line, i) => line !== dockerfile.split('\n')[i]);
  assert.equal(changed.length, 3);
  assert.match(text, /^ENV GPG_KEYS D95C03BC702BE9515344AE3374E44BC9067701A5 /m);
  assert.match(text, /gpg --batch --verify php\.tar\.xz\.asc php\.tar\.xz/);
});

// tar.gz の sha256 を tar.xz の URL に組み合わせると、ビルドの sha256sum -c で落ちる。
test('SHA256 は URL と同じファイル名のものを選ぶ', () => {
  const { text } = setPhpVersion(dockerfile, release861);
  assert.notEqual(readPhpEnv(text).sha256, sha('a'));
});

test('上流の Dockerfile がすでに pin の版なら何も変えない', () => {
  const same = { version: '8.6.0', source: [{ filename: 'php-8.6.0.tar.xz', sha256: sha('d') }] };
  assert.deepEqual(setPhpVersion(dockerfile, same), { text: dockerfile, overridden: false });
});

// official が先へ進んでパッチ付きのタグが消えると、移動タグの Dockerfile は pin より新しい。pin の版へ下げる。
test('上流の方が新しければ pin の版へ下げて差し替える', () => {
  const read = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  const release8512 = JSON.parse(read('php-release-8.5.12.json'));
  const { text, overridden } = setPhpVersion(read('php-8.5.13-trixie-zts.Dockerfile'), release8512);
  assert.equal(overridden, true);
  assert.equal(text, read('php-8.5.12-trixie-zts.Dockerfile'));
});

test('別の minor 系列の版は差し替えない', () => {
  const r870 = { version: '8.7.0', source: [{ filename: 'php-8.7.0.tar.xz', sha256: sha('e') }] };
  assert.throws(() => setPhpVersion(dockerfile, r870), /系列/);
});

test('リリース情報に URL と同じファイル名の tarball が無ければ例外にする', () => {
  const noXz = { version: '8.6.1', source: [{ filename: 'php-8.6.1.tar.gz', sha256: sha('a') }] };
  assert.throws(() => setPhpVersion(dockerfile, noXz), /php-8\.6\.1\.tar\.xz/);
});

test('SHA256 が 64 桁の 16 進でなければ例外にする', () => {
  const bad = { version: '8.6.1', source: [{ filename: 'php-8.6.1.tar.xz', sha256: 'zz' }] };
  assert.throws(() => setPhpVersion(dockerfile, bad), /sha256/);
});

test('版は x.y.z だけを受け付ける（RC などは差し替えない）', () => {
  assert.throws(() => setPhpVersion(dockerfile, { ...release861, version: '8.6.1RC1' }), /版/);
});

// 上流が ENV の書き方を変えたときに、差し替え漏れのまま古い URL でビルドしないための検査。
test('差し替える行がちょうど 1 行ずつ無ければ例外にする', () => {
  const noSha = dockerfile.replace(/^ENV PHP_SHA256=.*\n/m, '');
  assert.throws(() => readPhpEnv(noSha), /PHP_SHA256/);
  const twoVersions = dockerfile.replace(/^(ENV PHP_VERSION .*\n)/m, '$1$1');
  assert.throws(() => readPhpEnv(twoVersions), /PHP_VERSION/);
});

test('ENV PHP_VERSION=x.y.z の形でも読める', () => {
  const eq = dockerfile.replace('ENV PHP_VERSION 8.6.0', 'ENV PHP_VERSION=8.6.0');
  assert.equal(readPhpEnv(eq).version, '8.6.0');
  const { text } = setPhpVersion(eq, release861);
  assert.match(text, /^ENV PHP_VERSION=8\.6\.1$/m);
});

test('URL に元の版が入っていなければ例外にする', () => {
  const odd = dockerfile.replace('php-8.6.0.tar.xz"', 'php-latest.tar.xz"');
  assert.throws(() => setPhpVersion(odd, release861), /PHP_URL/);
});

test('差し替え後に元の版の文字列が残っていれば例外にする', () => {
  const extra = dockerfile.replace('ENV PHP_INI_DIR', 'LABEL x=8.6.0\nENV PHP_INI_DIR');
  assert.throws(() => setPhpVersion(extra, release861), /8\.6\.0/);
});

// fixture は docker-library/php の実物: f6048b5（8.5.12）と、その次の更新 8f7cce4（8.5.13）の
// 8.5/trixie/zts/Dockerfile、および php.net の 8.5.13 のリリース情報。上流の更新を待たずに差し替えた結果が、
// 上流が後から出した Dockerfile と 1 バイトも違わないこと。
test('8.5.12 の Dockerfile を 8.5.13 に差し替えると上流の 8.5.13 と一致する', () => {
  const read = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  const release = JSON.parse(read('php-release-8.5.13.json'));
  const { text, overridden } = setPhpVersion(read('php-8.5.12-trixie-zts.Dockerfile'), release);
  assert.equal(overridden, true);
  assert.equal(text, read('php-8.5.13-trixie-zts.Dockerfile'));
});

// 残存チェックが部分一致だと、新しい版 8.6.10 の中の「8.6.1」に当たって必ず落ちる。
test('新しい版が旧版を接頭辞に含んでも差し替えられる', () => {
  const at861 = dockerfile.replaceAll('8.6.0', '8.6.1');
  const release = { version: '8.6.10', source: [{ filename: 'php-8.6.10.tar.xz', sha256: sha('c') }] };
  const { text, overridden } = setPhpVersion(at861, release);
  assert.equal(overridden, true);
  assert.equal(readPhpEnv(text).version, '8.6.10');
});

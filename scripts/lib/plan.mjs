import { assertStableVersion } from './php-release.mjs';
import { minorOf } from './tags.mjs';

// platform 名は artifact 名や slug に使うので、ネイティブランナーのある 2 つに限る。
const PLATFORMS = new Set(['linux/amd64', 'linux/arm64']);

function fail(msg) {
  throw new Error(`versions.json: ${msg}`);
}

export function validateVersions(v) {
  if (!Array.isArray(v?.platforms) || v.platforms.length === 0) fail('platforms が空');
  for (const p of v.platforms) {
    if (!PLATFORMS.has(p.platform)) fail(`platform は ${[...PLATFORMS].join(' / ')} のどれか: ${p.platform}`);
    if (typeof p.runner !== 'string' || p.runner === '') fail(`${p.platform} の runner が空`);
  }
  const fp = v.frankenphp ?? {};
  if (fp.repository !== 'php/frankenphp') fail(`frankenphp.repository が php/frankenphp ではない: ${fp.repository}`);
  if (!/^v\d+\.\d+\.\d+$/.test(fp.version ?? '')) fail(`frankenphp.version が vX.Y.Z ではない: ${fp.version}`);
  if (!/^[0-9a-f]{40}$/.test(fp.commit ?? '')) fail(`frankenphp.commit が 40 桁の 16 進ではない: ${fp.commit}`);
  for (const group of ['php', 'frankenphp']) {
    const pins = v.baseImages?.[group];
    if (pins === null || typeof pins !== 'object') fail(`baseImages.${group} が無い`);
    for (const [ref, digest] of Object.entries(pins)) {
      if (!/^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9._-]+$/.test(ref)) fail(`baseImages.${group} のキーは <イメージ>:<タグ>: ${ref}`);
      if (!/^sha256:[0-9a-f]{64}$/.test(digest ?? '')) fail(`baseImages.${group}.${ref} の digest が不正: ${digest}`);
    }
  }
  const minors = Object.keys(v.php ?? {});
  if (minors.length === 0) fail('php が空');
  for (const minor of minors) {
    if (!/^\d+\.\d+$/.test(minor)) fail(`php のキーが <major>.<minor> ではない: ${minor}`);
    phpPin(v, minor);
  }
}

// 上流 docker-bake.hcl の php_base_variant に合わせる。
function variantOf(minor) {
  const [major, min] = minor.split('.').map(Number);
  return major * 100 + min >= 806 ? 'cli' : 'zts';
}

// versions.json の php.<minor> から、ビルドする版と公式イメージのタグを読む。
// officialDigest は、夜のジョブが版だけを上げて公式イメージがまだ無いあいだは null。
export function phpPin(v, minor) {
  const e = v.php?.[minor];
  if (!e) fail(`php.${minor} が無い`);
  if (!/^[a-z]+$/.test(e.os ?? '')) fail(`php.${minor}.os が不正: ${e.os}`);
  const variant = variantOf(minor);
  const m = new RegExp(`^${minor.replace('.', '\\.')}\\.(0|[1-9]\\d*)-${variant}-${e.os}$`).exec(e.officialTag ?? '');
  if (!m) fail(`php.${minor}.officialTag は ${minor}.<patch>-${variant}-${e.os} であるべき: ${e.officialTag}`);
  if (e.officialDigest !== null && !/^sha256:[0-9a-f]{64}$/.test(e.officialDigest ?? '')) {
    fail(`php.${minor}.officialDigest が不正（sha256:… か null）: ${e.officialDigest}`);
  }
  return {
    phpVersion: `${minor}.${m[1]}`,
    os: e.os,
    variant,
    officialTag: e.officialTag,
    movingTag: `${minor}-${variant}-${e.os}`,
  };
}

const BUILD_INPUTS = [
  /^\.github\/workflows\/build\.yml$/,
  /^\.github\/actions\//,
  /^\.github\/aqua(-checksums\.json|\.yaml)$/,
  /^\.node-version$/,
  /^scripts\/[^/]+\.mjs$/,
  /^scripts\/lib\//,
  /^tests\//,
];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const byVersion = (a, b) => a.localeCompare(b, 'en', { numeric: true });

function matrix(after, minors) {
  const versions = [...minors].sort(byVersion);
  const publishes = versions.map((version) => ({ version, ...phpPin(after, version) }));
  const builds = publishes.flatMap((p) => after.platforms.map(({ platform, runner }) => ({
    ...p, platform, runner, slug: `${p.version}-${platform.replace('/', '-')}`,
  })));
  return { versions, publishes, builds };
}

export function computePlan({ event, before = null, after, changedFiles = null, phpVersion = '' }) {
  validateVersions(after);
  const all = Object.keys(after.php);
  let php = [];
  let frankenphp = [];
  let waitFor = '';

  if (event === 'workflow_dispatch') {
    if (phpVersion === '') {
      php = all;
      frankenphp = all;
    } else {
      // 版を指定した dispatch（夜のジョブ）はビルドしない。公開を待って versions.json を上げる PR を作るだけ。
      assertStableVersion(phpVersion);
      const minor = minorOf(phpVersion);
      if (!all.includes(minor)) throw new Error(`PHP ${minor} は versions.json に無い`);
      waitFor = phpVersion;
    }
  } else if (event === 'push') {
    const inputsChanged = changedFiles === null || changedFiles.some((f) => BUILD_INPUTS.some((re) => re.test(f)));
    if (before === null || inputsChanged || !same(before.platforms, after.platforms)) {
      php = all;
      frankenphp = all;
    } else {
      const phpBase = same(before.baseImages?.php, after.baseImages.php);
      const fpBase = same(before.baseImages?.frankenphp, after.baseImages.frankenphp);
      php = phpBase ? all.filter((m) => !same(before.php?.[m], after.php[m])) : all;
      frankenphp = same(before.frankenphp, after.frankenphp) && fpBase ? php : all;
    }
  } else {
    throw new Error(`想定外のイベント: ${event}`);
  }

  const p = matrix(after, php);
  const f = matrix(after, frankenphp);
  return {
    phpVersions: p.versions,
    phpBuilds: p.builds,
    phpPublishes: p.publishes,
    frankenphpVersions: f.versions,
    frankenphpBuilds: f.builds,
    frankenphpPublishes: f.publishes,
    waitFor,
  };
}

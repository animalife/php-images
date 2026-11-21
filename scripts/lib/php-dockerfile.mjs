import { assertStableVersion } from './php-release.mjs';
import { compareVersions, minorOf } from './tags.mjs';

const LINES = {
  PHP_VERSION: /^ENV PHP_VERSION([ =])(\S+)$/,
  PHP_URL: /^ENV PHP_URL="([^"]+)" PHP_ASC_URL="([^"]+)"$/,
  PHP_SHA256: /^ENV PHP_SHA256="([^"]*)"$/,
};

function locate(lines) {
  const found = {};
  for (const [key, re] of Object.entries(LINES)) {
    const idx = lines.flatMap((line, i) => (re.test(line) ? [i] : []));
    if (idx.length !== 1) throw new Error(`${key} の ENV 行がちょうど 1 行ではない（${idx.length} 行）。上流の Dockerfile の形式が変わった可能性がある`);
    [found[key]] = idx;
  }
  return found;
}

export function readPhpEnv(text) {
  const lines = text.split('\n');
  const at = locate(lines);
  const v = LINES.PHP_VERSION.exec(lines[at.PHP_VERSION]);
  const u = LINES.PHP_URL.exec(lines[at.PHP_URL]);
  const s = LINES.PHP_SHA256.exec(lines[at.PHP_SHA256]);
  return { version: v[2], url: u[1], ascUrl: u[2], sha256: s[1] };
}

function bumpUrl(url, from, to, key) {
  const needle = `/php-${from}.`;
  if (url.split(needle).length !== 2) throw new Error(`${key} に /php-${from}. がちょうど 1 回現れない: ${url}`);
  return url.replace(needle, `/php-${to}.`);
}

export function rewritePhpEnv(text, release) {
  assertStableVersion(release.version);
  const current = readPhpEnv(text);
  if (minorOf(current.version) !== minorOf(release.version)) {
    throw new Error(`PHP ${release.version} は上流の Dockerfile（${current.version}）と別の minor 系列`);
  }
  if (compareVersions(current.version, release.version) >= 0) return { text, overridden: false };

  const url = bumpUrl(current.url, current.version, release.version, 'PHP_URL');
  const ascUrl = bumpUrl(current.ascUrl, current.version, release.version, 'PHP_ASC_URL');
  const filename = url.slice(url.lastIndexOf('/') + 1);
  const entry = release.source.find((s) => s.filename === filename);
  if (!entry) throw new Error(`php.net のリリース情報に ${filename} が無い`);
  if (!/^[0-9a-f]{64}$/.test(entry.sha256 ?? '')) throw new Error(`${filename} の sha256 が 64 桁の 16 進ではない: ${entry.sha256}`);

  const lines = text.split('\n');
  const at = locate(lines);
  const sep = LINES.PHP_VERSION.exec(lines[at.PHP_VERSION])[1];
  lines[at.PHP_VERSION] = `ENV PHP_VERSION${sep}${release.version}`;
  lines[at.PHP_URL] = `ENV PHP_URL="${url}" PHP_ASC_URL="${ascUrl}"`;
  lines[at.PHP_SHA256] = `ENV PHP_SHA256="${entry.sha256}"`;
  const out = lines.join('\n');
  const leftover = new RegExp(`(?<![\\d.])${current.version.replaceAll('.', '\\.')}(?![\\d])`);
  if (leftover.test(out)) {
    throw new Error(`差し替え後も ${current.version} が残っている。差し替え対象の 3 行以外に版が書かれている`);
  }
  return { text: out, overridden: true };
}

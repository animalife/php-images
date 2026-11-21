import { readFileSync, writeFileSync } from 'node:fs';
import { readPhpEnv, setPhpVersion } from './lib/php-dockerfile.mjs';
import { parseRelease, releaseUrl } from './lib/php-release.mjs';
import { env, main, setOutput } from './lib/gha.mjs';

async function fetchRelease(version) {
  const res = await fetch(releaseUrl(version), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`php.net: HTTP ${res.status}`);
  const release = parseRelease(await res.json(), version);
  if (release === null) throw new Error(`php.net に PHP ${version} のリリース情報が無い`);
  return release;
}

main(async () => {
  const path = env('DOCKERFILE');
  const pinned = env('PHP_VERSION');
  const original = readFileSync(path, 'utf8');
  const upstream = readPhpEnv(original).version;
  let text = original;
  let overridden = false;
  if (upstream !== pinned) {
    ({ text, overridden } = setPhpVersion(original, await fetchRelease(pinned)));
    writeFileSync(path, text);
  }
  const { version } = readPhpEnv(text);
  if (version !== pinned) throw new Error(`Dockerfile の PHP_VERSION（${version}）が pin（${pinned}）と一致しない`);
  console.log(overridden ? `PHP ${upstream} → ${version} に差し替えた` : `差し替えなし（PHP ${version}）`);
  setOutput('phpVersion', version);
  setOutput('overridden', String(overridden));
});

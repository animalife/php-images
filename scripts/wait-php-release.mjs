import { setTimeout as delay } from 'node:timers/promises';
import { finishWait, waitForRelease } from './lib/php-release.mjs';
import { env, main } from './lib/gha.mjs';

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function reachable(url) {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  return res.ok;
}

main(async () => {
  const version = env('PHP_VERSION');
  const started = Date.now();
  const result = await waitForRelease({
    version,
    interval: Number(env('INTERVAL_SECONDS')),
    deadline: Number(env('DEADLINE_SECONDS')),
    now: () => (Date.now() - started) / 1000,
    sleep: (s) => delay(s * 1000),
    fetchJson,
    assetsReady: async () => {
      const base = `https://www.php.net/distributions/php-${version}.tar.xz`;
      return (await reachable(base)) && reachable(`${base}.asc`);
    },
    log: (m) => console.log(`${new Date().toISOString()} ${m}`),
  });
  finishWait(result, version);
  console.log(`PHP ${version} が公開された`);
});

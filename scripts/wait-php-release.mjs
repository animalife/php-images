// php.net で版が公開されるのを待つ。公開されたら RELEASE_FILE にリリース情報を書く。
// 入力（環境変数）: PHP_VERSION, RELEASE_FILE, INTERVAL_SECONDS, DEADLINE_SECONDS
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { waitForRelease } from './lib/php-release.mjs';
import { env, main, setOutput } from './lib/gha.mjs';

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
  if (result.status === 'error') throw new Error(`期限までに php.net を確認できなかった: ${result.message}`);
  if (result.status === 'timeout') {
    console.log(`::notice::PHP ${version} は期限までに公開されなかった。ビルドせずに終える`);
    setOutput('found', 'false');
    return;
  }
  writeFileSync(env('RELEASE_FILE'), JSON.stringify(result.release));
  console.log(`PHP ${version} が公開された`);
  setOutput('found', 'true');
});

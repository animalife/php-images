const STABLE_RE = /^\d+\.\d+\.\d+$/;

export function assertStableVersion(version) {
  if (!STABLE_RE.test(version ?? '')) throw new Error(`版が x.y.z の形ではない: '${version}'`);
}

export function releaseUrl(version) {
  assertStableVersion(version);
  return `https://www.php.net/releases/index.php?json&version=${version}`;
}

// 未公開なら null。
export function parseRelease(json, version) {
  if (json === null || typeof json !== 'object') throw new Error('php.net の応答が JSON オブジェクトではない');
  if ('error' in json) return null;
  if (json.version !== version) return null;
  if (!Array.isArray(json.source)) throw new Error('php.net の応答に source の配列が無い');
  return { version: json.version, source: json.source };
}

// 公開を待つ。deadline と interval は秒、now は経過秒を返す。assetsReady は tarball と署名が取れるかを確かめる。
// 戻り値の status: found（release 付き）/ timeout（期限まで未公開）/ error（最後の試行が失敗のまま期限）。
export async function waitForRelease({
  version, interval, deadline, now, sleep, fetchJson, log, assetsReady = async () => true,
}) {
  let lastError = null;
  for (;;) {
    try {
      const release = parseRelease(await fetchJson(releaseUrl(version)), version);
      lastError = null;
      if (!release) {
        log(`PHP ${version} はまだ公開されていない`);
      } else if (await assetsReady(release)) {
        return { status: 'found', release };
      } else {
        log(`PHP ${version} のリリース情報はあるが tarball / 署名をまだ取得できない`);
      }
    } catch (e) {
      lastError = e;
      log(`php.net の確認に失敗: ${e.message}`);
    }
    const left = deadline - now();
    if (left <= 0) return lastError ? { status: 'error', message: lastError.message } : { status: 'timeout' };
    await sleep(Math.min(interval, left));
  }
}

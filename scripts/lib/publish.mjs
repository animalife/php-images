function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
}

// officialDigest はビルドのきっかけで、Dockerfile はビルド時点の library/php から取るので内容の入力ではない。
function relevantPins(versions, kind, minor) {
  const { officialDigest, ...entry } = versions.php?.[minor] ?? {};
  const php = { phpBase: versions.baseImages?.php ?? null, php: entry };
  if (kind === 'php') return php;
  return { ...php, frankenphpBase: versions.baseImages?.frankenphp ?? null, frankenphp: versions.frankenphp ?? null };
}

export function pinsStale(runVersions, mainVersions, kind, minor) {
  const a = JSON.stringify(stable(relevantPins(runVersions, kind, minor)));
  const b = JSON.stringify(stable(relevantPins(mainVersions, kind, minor)));
  return a !== b;
}

// run は commit 順に直列で走るので、普段は move しかない。main が先へ進んでいれば後続の run が組み直すので、
// この run はタグに触れない。再実行した run にはその前提が成り立たないので失敗にする。
export function decidePublish({ stale, runAttempt }) {
  if (!/^[1-9]\d*$/.test(runAttempt ?? '')) throw new Error(`RUN_ATTEMPT が不正: '${runAttempt}'`);
  if (!stale) return 'move';
  if (runAttempt !== '1') {
    throw new Error('再実行した run の pin は main の先端より古いので公開しない。main の先端で版を指定しない workflow_dispatch を走らせる');
  }
  return 'skip';
}

export function tagsToApply(decision, image, { fixed, moving }) {
  if (decision === 'move') return [`${image}:${fixed}`, `${image}:${moving}`];
  if (decision === 'skip') return [];
  throw new Error(`判定が不正: ${decision}`);
}

// FrankenPHP の php-base: この run で php をビルドした版はその digest、しなかった版は移動タグの php。
export function choosePhpBase({ built, record }) {
  if (!built) return { source: 'moving' };
  if (record === null) throw new Error('この run で php をビルドするはずだったが、公開の結果が無い');
  if (record.decision !== 'move') throw new Error(`この run の php は公開されていない（${record.decision}）`);
  return { source: 'own', digest: record.digest, phpVersion: record.phpVersion };
}

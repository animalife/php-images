function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
}

// officialDigest も比べる。digest の更新で組み直した run の中身を、古い run の再実行が上書きしないように。
function relevantPins(versions, kind, minor) {
  const php = { phpBase: versions.baseImages?.php ?? null, php: versions.php?.[minor] ?? null };
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

// FrankenPHP をどの php の上に組むか、版ごとに決める。この run で php を作った版はその digest、作らなかった版は
// 移動タグの php。php を skip した版は main が先へ進んでいる（FrankenPHP も必ず古い）ので外す。
export function planFrankenphp({ publishes, phpVersions, records }) {
  return publishes.flatMap((p) => {
    if (!phpVersions.includes(p.version)) return [{ ...p, base: { source: 'moving' } }];
    const record = records[p.version] ?? null;
    if (record === null) throw new Error(`この run で php ${p.version} をビルドするはずだったが、公開の結果が無い`);
    if (record.decision === 'skip') return [];
    if (record.decision !== 'move') throw new Error(`php ${p.version} の公開の判定が不正: ${record.decision}`);
    return [{ ...p, base: { source: 'own', digest: record.digest, phpVersion: record.phpVersion } }];
  });
}

// 夜の PR の状態。rollup は statusCheckRollup.state（チェックが無ければ null）。
export function assessPr({ state, mergeable, autoMergeRequest, rollup }) {
  if (state === 'MERGED') return 'merged';
  if (state === 'CLOSED') throw new Error('PR がマージされずに閉じられた');
  if (mergeable === 'CONFLICTING') throw new Error('PR が main と conflict している');
  if (rollup === 'FAILURE' || rollup === 'ERROR') throw new Error('PR のチェックが失敗した');
  if (autoMergeRequest === null) throw new Error('PR の auto-merge が外れた（マージキューから外されたなど）');
  return 'pending';
}

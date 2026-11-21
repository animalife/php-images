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
  // 再実行は古いアーカイブ（最大 3 日前）で、後から公開された同じ版の中身を上書きしうるので、公開しない。
  if (runAttempt !== '1') {
    throw new Error(`再実行した run では公開しない${stale ? '（pin も main の先端より古い）' : ''}。main で版を指定しない workflow_dispatch を走らせて直す`);
  }
  return stale ? 'skip' : 'move';
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

export function needsMainCheck({ state, mergeable }) {
  return state === 'CLOSED' || (state === 'OPEN' && mergeable === 'CONFLICTING');
}

// 夜の PR の状態。rollup は statusCheckRollup.state（チェックが無ければ null）。mainCovers は main の versions.json が
// すでにその版以上か（閉じられた・conflict のときだけ要る）。
// 戻り値: merged / superseded（main がすでにその版以上）/ conflict（main がまだその版未満）/ pending /
// suspect（キュー外で auto-merge が無い。キューに入る瞬間やマージ完了の瞬間にも一瞬見えるので、続いたときだけ失敗）。
export function assessPr({ state, mergeable, autoMergeRequest, rollup, isInMergeQueue = false }, { mainCovers = false } = {}) {
  if (state === 'MERGED') return 'merged';
  if (needsMainCheck({ state, mergeable }) && mainCovers) return 'superseded';
  if (state === 'CLOSED') throw new Error('PR がマージされずに閉じられた');
  if (mergeable === 'CONFLICTING') return 'conflict';
  if (isInMergeQueue) return 'pending';
  if (rollup === 'FAILURE' || rollup === 'ERROR') throw new Error('PR のチェックが失敗した');
  if (autoMergeRequest === null) return 'suspect';
  return 'pending';
}

const SUSPECT_LIMIT = 3;

export function nextSuspectCount(prev, result) {
  if (result !== 'suspect') return 0;
  if (prev + 1 >= SUSPECT_LIMIT) throw new Error(`PR の auto-merge が外れたまま（${SUSPECT_LIMIT} 回続けて確認）。マージキューから外されたなど`);
  return prev + 1;
}

export const MAX_REDISPATCH = 3;

export function canRedispatch(count) {
  if (!/^\d+$/.test(count ?? '')) throw new Error(`立て直しの回数が不正: '${count}'`);
  return Number(count) < MAX_REDISPATCH;
}

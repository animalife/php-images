import { phpPin, validateVersions } from './plan.mjs';
import { assertStableVersion } from './php-release.mjs';
import { compareVersions, minorOf } from './tags.mjs';

// 夜のジョブが main の versions.json に当てる変更。版を上げるときは公式イメージがまだ無いので digest は null にする
// （Renovate が公式イメージの公開後に pinDigest で埋める）。上げる必要が無ければ null を返す。
export function bumpVersions(versions, version) {
  assertStableVersion(version);
  const minor = minorOf(version);
  const pin = phpPin(versions, minor);
  if (compareVersions(version, pin.phpVersion) <= 0) return null;
  const next = structuredClone(versions);
  next.php[minor].officialTag = `${version}-${pin.variant}-${pin.os}`;
  next.php[minor].officialDigest = null;
  validateVersions(next);
  return next;
}

export function formatVersions(versions) {
  return `${JSON.stringify(versions, null, 2)}\n`;
}

export function bumpBranch(version) {
  assertStableVersion(version);
  return `php-version/${version}`;
}

// 夜のジョブが main と開いている PR を見て、次にすることを決める。openPr.state は open の一覧で見つけた後に読み直した値で、
// その間にマージ・クローズされていることがある（マージ済みは mergeable が UNKNOWN、autoMergeRequest が null のまま）。
export function bumpAction({ needed, openPr }) {
  if (openPr && openPr.state === 'MERGED') return { kind: 'watch', pr: openPr.number, enableAutoMerge: false };
  if (openPr && openPr.state === 'CLOSED') return needed ? { kind: 'create' } : { kind: 'none' };
  if (!needed) return openPr ? { kind: 'close', pr: openPr.number } : { kind: 'none' };
  if (openPr?.mergeable === 'CONFLICTING') return { kind: 'recreate', pr: openPr.number };
  // UNKNOWN は GitHub が mergeable を計算中。確定するまで待って読み直す（settleBumpAction）。
  if (openPr?.mergeable === 'UNKNOWN') return { kind: 'wait-mergeable', pr: openPr.number };
  if (openPr) {
    // マージキューに入っている PR に auto-merge を投げ直さない（キューに入ると autoMergeRequest が消えうる）。
    return { kind: 'watch', pr: openPr.number, enableAutoMerge: openPr.autoMergeRequest === null && !openPr.isInMergeQueue };
  }
  return { kind: 'create' };
}

// mergeable が UNKNOWN の間は polls 回まで読み直す。確定しなければ auto-merge を投げずに見届けに進む
// （PR の状態が分からないまま auto-merge を有効にすると、マージ済みなどで失敗しうる。conflict は見届けが判定する）。
export async function settleBumpAction({ needed, readPr, polls, wait }) {
  let action = bumpAction({ needed, openPr: await readPr() });
  for (let i = 0; action.kind === 'wait-mergeable' && i < polls; i += 1) {
    await wait();
    action = bumpAction({ needed, openPr: await readPr() });
  }
  return action.kind === 'wait-mergeable' ? { kind: 'watch', pr: action.pr, enableAutoMerge: false } : action;
}

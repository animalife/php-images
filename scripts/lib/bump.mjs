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

// 夜のジョブが main と開いている PR を見て、次にすることを決める。
export function bumpAction({ needed, openPr }) {
  if (!needed) return openPr ? { kind: 'close', pr: openPr.number } : { kind: 'none' };
  if (openPr?.mergeable === 'CONFLICTING') return { kind: 'recreate', pr: openPr.number };
  // UNKNOWN は GitHub が mergeable を計算中。確定するまで待って読み直す（呼び出し側で回数の上限を持つ）。
  if (openPr?.mergeable === 'UNKNOWN') return { kind: 'wait-mergeable', pr: openPr.number };
  if (openPr) {
    // マージキューに入っている PR に auto-merge を投げ直さない（キューに入ると autoMergeRequest が消えうる）。
    return { kind: 'watch', pr: openPr.number, enableAutoMerge: openPr.autoMergeRequest === null && !openPr.isInMergeQueue };
  }
  return { kind: 'create' };
}

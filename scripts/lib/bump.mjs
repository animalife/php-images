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

// mergeable が UNKNOWN の間は polls 回まで読み直す。確定しなければ見届けに進む（conflict は見届けが判定する）。
// そのとき最後に読んだ PR がキュー外で auto-merge が外れていれば有効にし直す（外れたままだと見届けが失敗する）。
// マージ済みの PR は state の判定で先に拾われるので、残るのは有効化の直前にマージされる競合だけ（enableAutoMergeOrMerged）。
export async function settleBumpAction({ needed, readPr, polls, wait }) {
  let pr = await readPr();
  let action = bumpAction({ needed, openPr: pr });
  for (let i = 0; action.kind === 'wait-mergeable' && i < polls; i += 1) {
    await wait();
    pr = await readPr();
    action = bumpAction({ needed, openPr: pr });
  }
  if (action.kind !== 'wait-mergeable') return action;
  return { kind: 'watch', pr: action.pr, enableAutoMerge: pr.autoMergeRequest === null && !pr.isInMergeQueue };
}

// auto-merge を有効にする。失敗しても、読み直した PR がマージ済みならそれでよい（有効化の直前にマージされた）。
export async function enableAutoMergeOrMerged({ enable, readPr }) {
  try {
    await enable();
    return 'enabled';
  } catch (e) {
    if ((await readPr())?.state === 'MERGED') return 'merged';
    throw e;
  }
}

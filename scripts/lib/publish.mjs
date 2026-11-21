import { canMoveTag, compareVersions, minorOf } from './tags.mjs';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
}

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

export function decidePublish({ current, candidate, mustLand, stale, commits = null }) {
  if (stale) {
    if (mustLand) throw new Error('この run がビルドに使った pin は main の先端より古いので、移動タグに載せられない。同じ版を指定して dispatch し直す');
    return 'skip';
  }
  const sameVersions = current !== null && Object.keys(candidate).every((k) => candidate[k] === current[k]);
  if (sameVersions && commits && commits.candidate !== commits.latest && commits.current === commits.latest) {
    return 'skip';
  }
  const decision = canMoveTag(current, candidate);
  if (decision === 'conflict') {
    throw new Error(`現行（${JSON.stringify(current)}）と今回（${JSON.stringify(candidate)}）で、版の一方が上がり一方が下がる。新しい方の PHP の版を指定して dispatch する`);
  }
  return decision;
}

export function tagsToApply(decision, image, { fixed, moving }) {
  if (decision === 'move') return [`${image}:${fixed}`, `${image}:${moving}`];
  if (decision === 'keep') return [`${image}:${fixed}`];
  if (decision === 'skip') return [];
  throw new Error(`判定が不正: ${decision}`);
}

export function choosePhpBase({ built, record, mustLand }) {
  if (!built) {
    if (mustLand) throw new Error('待機 run なのに、この版の php をビルドしていない');
    return { source: 'moving' };
  }
  if (record === null) throw new Error('この run で php をビルドするはずだったが、公開の結果が無い');
  if (mustLand || record.decision === 'move') return { source: 'own', digest: record.digest, phpVersion: record.phpVersion };
  return { source: 'moving' };
}

export function runVersions(dispatch, main) {
  return { ...dispatch, baseImages: main.baseImages, frankenphp: main.frankenphp };
}

export function pushTargetVersion(officialVersion, movingVersion) {
  if (movingVersion === null) return null;
  if (minorOf(officialVersion) !== minorOf(movingVersion)) {
    throw new Error(`移動タグの PHP ${movingVersion} が上流の Dockerfile（${officialVersion}）と別の minor`);
  }
  return compareVersions(movingVersion, officialVersion) > 0 ? movingVersion : null;
}

const UPSTREAM_COMMIT_LABEL = 'dev.animalife.php-images.upstream-commit';

export function upstreamCommitOf(image) {
  if (image === null || typeof image !== 'object') return null;
  const configs = image.config ? [image] : Object.values(image);
  const values = [...new Set(configs.map((c) => c?.config?.Labels?.[UPSTREAM_COMMIT_LABEL] ?? null))];
  return values.length === 1 ? values[0] : null;
}

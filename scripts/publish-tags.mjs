import { readFileSync } from 'node:fs';
import { findTag } from './lib/official-images.mjs';
import { canRedispatch, decidePublish, mustLandFor, pinsStale, tagsToApply, upstreamCommitOf } from './lib/publish.mjs';
import { inspectImage } from './lib/registry.mjs';
import { currentFromImage, frankenphpTags, phpTags } from './lib/tags.mjs';
import { env, main, setOutput } from './lib/gha.mjs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function read(ref, keys) {
  const image = inspectImage(ref, '{{json .Image}}');
  return image === null ? null : { versions: currentFromImage(image, keys), commit: upstreamCommitOf(image) };
}

main(async () => {
  const kind = env('KIND');
  const os = env('OS');
  const minor = env('MINOR');
  let keys;
  if (kind === 'php') keys = ['php'];
  else if (kind === 'frankenphp') keys = ['php', 'frankenphp'];
  else throw new Error(`KIND が php / frankenphp ではない: ${kind}`);
  const runKind = env('RUN_KIND');
  if (!['wait', 'push'].includes(runKind)) throw new Error(`RUN_KIND が wait / push ではない: ${runKind}`);

  const image = env('IMAGE');
  const digest = env('INDEX_DIGEST');
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error(`INDEX_DIGEST が不正: ${digest}`);
  const built = read(`${image}@${digest}`, keys);
  if (built === null) throw new Error(`${image}@${digest} が無い`);
  const candidate = built.versions;
  let tags;
  if (kind === 'php') {
    tags = phpTags({ phpVersion: candidate.php, officialTag: env('OFFICIAL_TAG'), os });
  } else {
    const pinned = env('FRANKENPHP_VERSION');
    if (candidate.frankenphp !== pinned) throw new Error(`イメージの FrankenPHP の版（${candidate.frankenphp}）が pin（${pinned}）と違う`);
    tags = frankenphpTags({ frankenphpVersion: pinned, phpVersion: candidate.php, os });
  }

  const now = read(`${image}:${tags.moving}`, keys);
  const current = now?.versions ?? null;
  // 同じ版どうしでは、ビルドした時点の上流の Dockerfile（docker-library/php の commit）が新しい方を残す。
  const latest = findTag(readFileSync(env('LIBRARY_FILE'), 'utf8'), env('OFFICIAL_TAG')).gitCommit;
  const commits = { candidate: built.commit, current: now?.commit ?? null, latest };
  const stale = pinsStale(readJson(env('RUN_VERSIONS_FILE')), readJson(env('MAIN_VERSIONS_FILE')), kind, minor);
  const decision = decidePublish({
    current,
    candidate,
    mustLand: mustLandFor(runKind, env('RUN_ATTEMPT')),
    stale,
    commits,
    redispatch: canRedispatch(runKind, env('REDISPATCH_COUNT')),
  });
  const detail = `現行 ${JSON.stringify(current)}、今回 ${JSON.stringify(candidate)}`;
  if (decision === 'skip') console.log(`::warning::タグを付けない（pin が main の先端より古い、または同じ版を新しい上流の Dockerfile で組んだものが移動タグにある）。${detail} ${JSON.stringify(commits)}`);
  if (decision === 'redispatch') console.log(`::warning::この run の pin は main の先端より古いので、タグを付けずに同じ版で dispatch し直す。${detail}`);
  if (decision === 'keep') console.log(`::warning::移動タグ ${tags.moving} は現行の方が新しいので動かさない（${detail}）`);
  const refs = tagsToApply(decision, image, tags);
  console.log(JSON.stringify({ decision, refs, candidate, current, stale }));
  setOutput('decision', decision);
  setOutput('tags', refs);
  setOutput('phpVersion', candidate.php);
});

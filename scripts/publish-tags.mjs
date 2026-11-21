import { readFileSync } from 'node:fs';
import { decidePublish, pinsStale, tagsToApply } from './lib/publish.mjs';
import { inspectImage } from './lib/registry.mjs';
import { currentFromImage, frankenphpTags, phpTags } from './lib/tags.mjs';
import { env, main, setOutput } from './lib/gha.mjs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function versionsOf(ref, keys) {
  const image = inspectImage(ref, '{{json .Image}}');
  return image === null ? null : currentFromImage(image, keys);
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
  const candidate = versionsOf(`${image}@${digest}`, keys);
  if (candidate === null) throw new Error(`${image}@${digest} が無い`);
  let tags;
  if (kind === 'php') {
    tags = phpTags({ phpVersion: candidate.php, officialTag: env('OFFICIAL_TAG'), os });
  } else {
    const pinned = env('FRANKENPHP_VERSION');
    if (candidate.frankenphp !== pinned) throw new Error(`イメージの FrankenPHP の版（${candidate.frankenphp}）が pin（${pinned}）と違う`);
    tags = frankenphpTags({ frankenphpVersion: pinned, phpVersion: candidate.php, os });
  }

  const current = versionsOf(`${image}:${tags.moving}`, keys);
  const stale = pinsStale(readJson(env('RUN_VERSIONS_FILE')), readJson(env('MAIN_VERSIONS_FILE')), kind, minor);
  const decision = decidePublish({ current, candidate, mustLand: runKind === 'wait', stale });
  const detail = `現行 ${JSON.stringify(current)}、今回 ${JSON.stringify(candidate)}`;
  if (decision === 'skip') console.log(`::warning::この run の pin は main の先端より古いのでタグを付けない（後続の run が組み直す）。${detail}`);
  if (decision === 'keep') console.log(`::warning::移動タグ ${tags.moving} は現行の方が新しいので動かさない（${detail}）`);
  const refs = tagsToApply(decision, image, tags);
  console.log(JSON.stringify({ decision, refs, candidate, current, stale }));
  setOutput('decision', decision);
  setOutput('tags', refs);
  setOutput('phpVersion', candidate.php);
});

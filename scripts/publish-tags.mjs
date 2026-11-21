import { readFileSync } from 'node:fs';
import { phpPin } from './lib/plan.mjs';
import { decidePublish, pinsStale, tagsToApply } from './lib/publish.mjs';
import { inspectImage } from './lib/registry.mjs';
import { currentFromImage, frankenphpTags, phpTags } from './lib/tags.mjs';
import { env, main, setOutput } from './lib/gha.mjs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

main(async () => {
  const kind = env('KIND');
  const minor = env('MINOR');
  if (!['php', 'frankenphp'].includes(kind)) throw new Error(`KIND が php / frankenphp ではない: ${kind}`);
  const runVersions = readJson(env('RUN_VERSIONS_FILE'));
  const pin = phpPin(runVersions, minor);

  const image = env('IMAGE');
  const digest = env('INDEX_DIGEST');
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error(`INDEX_DIGEST が不正: ${digest}`);
  const config = inspectImage(`${image}@${digest}`, '{{json .Image}}');
  if (config === null) throw new Error(`${image}@${digest} が無い`);
  const built = currentFromImage(config, kind === 'php' ? ['php'] : ['php', 'frankenphp']);
  if (built.php !== pin.phpVersion) throw new Error(`イメージの PHP（${built.php}）が pin（${pin.phpVersion}）と違う`);

  let tags;
  if (kind === 'php') {
    tags = phpTags({ phpVersion: pin.phpVersion, variant: pin.variant, os: pin.os });
  } else {
    const pinned = runVersions.frankenphp.version;
    if (built.frankenphp !== pinned) throw new Error(`イメージの FrankenPHP（${built.frankenphp}）が pin（${pinned}）と違う`);
    tags = frankenphpTags({ frankenphpVersion: pinned, phpVersion: pin.phpVersion, os: pin.os });
  }

  const stale = pinsStale(runVersions, readJson(env('MAIN_VERSIONS_FILE')), kind, minor);
  const decision = decidePublish({ stale, runAttempt: env('RUN_ATTEMPT') });
  if (decision === 'skip') console.log('::warning::この run の pin は main の先端より古いのでタグを付けない（main への push の run が組み直す）');
  const refs = tagsToApply(decision, image, tags);
  console.log(JSON.stringify({ decision, refs, built }));
  setOutput('decision', decision);
  setOutput('tags', refs);
  setOutput('phpVersion', built.php);
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pinBaseImages } from './lib/base-images.mjs';
import { validateVersions } from './lib/plan.mjs';
import { env, main, setOutput } from './lib/gha.mjs';

main(async () => {
  const versions = JSON.parse(readFileSync(env('VERSIONS_FILE', { optional: true }) || 'versions.json', 'utf8'));
  validateVersions(versions);
  const kind = env('KIND');
  const args = [];
  if (kind === 'php') {
    const { contexts, syntax } = pinBaseImages({
      dockerfile: readFileSync(env('DOCKERFILE'), 'utf8'),
      pins: versions.baseImages.php,
    });
    for (const [name, value] of Object.entries(contexts)) args.push('--build-context', `${name}=${value}`);
    if (syntax) args.push('--build-arg', `BUILDKIT_SYNTAX=${syntax}`);
  } else if (kind === 'frankenphp') {
    const target = env('TARGET');
    const def = JSON.parse(readFileSync(env('BAKE_FILE'), 'utf8')).target?.[target];
    if (!def) throw new Error(`bake の定義にターゲット ${target} が無い`);
    const expected = env('EXPECTED_PHP_BASE');
    if (def.contexts?.['php-base'] !== expected) {
      throw new Error(`上流の docker-bake.hcl の php-base は ${def.contexts?.['php-base']} で、versions.json から決まる ${expected} と違う`);
    }
    const { contexts, syntax } = pinBaseImages({
      dockerfile: readFileSync(join(def.context ?? '.', def.dockerfile ?? 'Dockerfile'), 'utf8'),
      contexts: def.contexts,
      exempt: ['php-base'],
      pins: versions.baseImages.frankenphp,
    });
    for (const [name, value] of Object.entries(contexts)) args.push('--set', `${target}.contexts.${name}=${value}`);
    if (syntax) args.push('--set', `${target}.args.BUILDKIT_SYNTAX=${syntax}`);
  } else {
    throw new Error(`KIND が php / frankenphp ではない: ${kind}`);
  }
  console.log(JSON.stringify(args, null, 2));
  setOutput('args', args);
});

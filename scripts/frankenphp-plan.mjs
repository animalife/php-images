import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planFrankenphp } from './lib/publish.mjs';
import { inspectImage } from './lib/registry.mjs';
import { currentFromImage } from './lib/tags.mjs';
import { env, main, setOutput } from './lib/gha.mjs';

function movingBase(phpImage, movingTag) {
  const ref = `${phpImage}:${movingTag}`;
  const manifest = inspectImage(ref, '{{json .Manifest}}');
  if (manifest === null) throw new Error(`${ref} が無い`);
  const config = inspectImage(`${phpImage}@${manifest.digest}`, '{{json .Image}}');
  return { digest: manifest.digest, phpVersion: currentFromImage(config, ['php']).php };
}

main(async () => {
  const publishes = JSON.parse(env('FP_PUBLISHES'));
  const builds = JSON.parse(env('FP_BUILDS'));
  const phpVersions = JSON.parse(env('PHP_VERSIONS'));
  const recordDir = env('RECORD_DIR');
  const records = Object.fromEntries(phpVersions.flatMap((v) => {
    const f = join(recordDir, `${v}.json`);
    return existsSync(f) ? [[v, JSON.parse(readFileSync(f, 'utf8'))]] : [];
  }));
  const outDir = env('OUT_DIR');
  mkdirSync(outDir, { recursive: true });

  const planned = planFrankenphp({ publishes, phpVersions, records });
  for (const p of planned) {
    const base = p.base.source === 'own' ? { digest: p.base.digest, phpVersion: p.base.phpVersion } : movingBase(env('PHP_IMAGE'), p.movingTag);
    if (!/^sha256:[0-9a-f]{64}$/.test(base.digest ?? '')) throw new Error(`php ${p.version} の digest が不正: ${base.digest}`);
    if (base.phpVersion !== p.phpVersion) throw new Error(`php-base の PHP（${base.phpVersion}）が pin（${p.phpVersion}）と違う`);
    console.log(`php ${p.version}: ${p.base.source === 'own' ? 'この run でビルドした' : '移動タグの'} php の上に組む（${base.digest}、PHP ${base.phpVersion}）`);
    writeFileSync(join(outDir, `${p.version}.json`), JSON.stringify(base));
  }
  const kept = new Set(planned.map((p) => p.version));
  for (const p of publishes) {
    if (!kept.has(p.version)) console.log(`::notice::php ${p.version} はタグを付けなかった（main が先へ進んでいる）ので、FrankenPHP もこの版は組まない`);
  }
  setOutput('publishes', publishes.filter((p) => kept.has(p.version)));
  setOutput('builds', builds.filter((b) => kept.has(b.version)));
});

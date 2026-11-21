import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { choosePhpBase } from './lib/publish.mjs';
import { inspectImage } from './lib/registry.mjs';
import { currentFromImage } from './lib/tags.mjs';
import { env, main, setOutput } from './lib/gha.mjs';

main(async () => {
  const minor = env('MINOR');
  const built = JSON.parse(env('PHP_VERSIONS')).includes(minor);
  const recordFile = env('RECORD_FILE');
  const record = existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, 'utf8')) : null;
  const choice = choosePhpBase({ built, record, mustLand: env('RUN_KIND') === 'wait' });

  let base;
  if (choice.source === 'own') {
    base = { digest: choice.digest, phpVersion: choice.phpVersion };
    console.log(`この run でビルドした php を使う: ${base.digest}（PHP ${base.phpVersion}）`);
  } else {
    const ref = `${env('PHP_IMAGE')}:${env('OFFICIAL_TAG')}`;
    const manifest = inspectImage(ref, '{{json .Manifest}}');
    if (manifest === null) throw new Error(`${ref} が無い`);
    base = { digest: manifest.digest, phpVersion: currentFromImage(inspectImage(`${env('PHP_IMAGE')}@${manifest.digest}`, '{{json .Image}}'), ['php']).php };
    console.log(`現行の ${ref} を使う: ${base.digest}（PHP ${base.phpVersion}）`);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(base.digest ?? '')) throw new Error(`php の digest が不正: ${base.digest}`);
  writeFileSync(env('OUT_FILE'), JSON.stringify(base));
  setOutput('digest', base.digest);
  setOutput('phpVersion', base.phpVersion);
});

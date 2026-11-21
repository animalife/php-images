import { readFileSync, writeFileSync } from 'node:fs';
import { readPhpEnv, rewritePhpEnv } from './lib/php-dockerfile.mjs';
import { env, main, setOutput } from './lib/gha.mjs';

main(async () => {
  const path = env('DOCKERFILE');
  const releaseFile = env('RELEASE_FILE', { optional: true });
  const original = readFileSync(path, 'utf8');
  let text = original;
  let overridden = false;
  if (releaseFile !== '') {
    ({ text, overridden } = rewritePhpEnv(original, JSON.parse(readFileSync(releaseFile, 'utf8'))));
    if (overridden) writeFileSync(path, text);
  }
  const { version } = readPhpEnv(text);
  console.log(overridden ? `PHP ${readPhpEnv(original).version} → ${version} に差し替えた` : `差し替えなし（PHP ${version}）`);
  setOutput('phpVersion', version);
  setOutput('overridden', String(overridden));
});

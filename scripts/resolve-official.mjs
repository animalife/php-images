import { readFileSync } from 'node:fs';
import { resolveSource } from './lib/source.mjs';
import { env, main, setOutput } from './lib/gha.mjs';

main(async () => {
  const officialTag = env('OFFICIAL_TAG');
  const found = resolveSource(readFileSync(env('LIBRARY_FILE'), 'utf8'), officialTag, env('MOVING_TAG'));
  // 取得元は docker-library/php に固定している（actions/checkout の repository）。
  if (found.gitRepo !== 'https://github.com/docker-library/php.git') {
    throw new Error(`${officialTag} の GitRepo が docker-library/php ではない: ${found.gitRepo}`);
  }
  console.log(`${found.viaMoving ? `${officialTag} は library/php に無いので移動タグから取る: ` : `${officialTag}: `}${found.gitCommit} ${found.directory}`);
  setOutput('gitCommit', found.gitCommit);
  setOutput('directory', found.directory);
  setOutput('viaMoving', String(found.viaMoving));
});

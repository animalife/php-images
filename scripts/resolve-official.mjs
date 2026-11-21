import { readFileSync } from 'node:fs';
import { findTag } from './lib/official-images.mjs';
import { env, main, setOutput } from './lib/gha.mjs';

main(async () => {
  const tag = env('OFFICIAL_TAG');
  const found = findTag(readFileSync(env('LIBRARY_FILE'), 'utf8'), tag);
  // 取得元は docker-library/php に固定している（actions/checkout の repository）。
  if (found.gitRepo !== 'https://github.com/docker-library/php.git') {
    throw new Error(`${tag} の GitRepo が docker-library/php ではない: ${found.gitRepo}`);
  }
  console.log(`${tag}: ${found.gitCommit} ${found.directory}`);
  setOutput('gitCommit', found.gitCommit);
  setOutput('directory', found.directory);
});

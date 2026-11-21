import { readFileSync, writeFileSync } from 'node:fs';
import { runVersions } from './lib/publish.mjs';
import { validateVersions } from './lib/plan.mjs';
import { env, main } from './lib/gha.mjs';

main(async () => {
  const read = (name) => JSON.parse(readFileSync(env(name), 'utf8'));
  const used = runVersions(read('DISPATCH_VERSIONS_FILE'), read('MAIN_VERSIONS_FILE'));
  validateVersions(used);
  writeFileSync(env('OUT_FILE'), `${JSON.stringify(used, null, 2)}\n`);
});

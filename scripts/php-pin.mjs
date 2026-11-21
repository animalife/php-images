import { readFileSync } from 'node:fs';
import { phpPin, validateVersions } from './lib/plan.mjs';
import { env, main, setOutput } from './lib/gha.mjs';

main(async () => {
  const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
  validateVersions(versions);
  const pin = phpPin(versions, env('MINOR'));
  for (const [k, v] of Object.entries(pin)) setOutput(k, v);
});

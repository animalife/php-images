import { dirtyChecksums, regenerateChecksums, stageChecksums } from './lib/aqua-checksums.mjs';
import { env, main } from './lib/gha.mjs';

main(async () => {
  const cwd = process.cwd();
  regenerateChecksums({ cwd });
  const outDir = env('OUT_DIR', { optional: true });
  if (outDir !== '') stageChecksums({ cwd, outDir });
  if (env('CHECK', { optional: true }) === '1') {
    const dirty = dirtyChecksums({ cwd });
    if (dirty !== '') {
      console.log(dirty);
      throw new Error('aqua-checksums.json が作り直した結果と一致しない。node scripts/regenerate-aqua-checksums.mjs で作り直す');
    }
  }
});

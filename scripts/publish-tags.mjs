import { execFileSync } from 'node:child_process';
import { canMoveTag, currentFromImage, frankenphpTags, phpTags } from './lib/tags.mjs';
import { env, main, setOutput } from './lib/gha.mjs';

function inspect(ref, keys) {
  let out;
  try {
    out = execFileSync('docker', ['buildx', 'imagetools', 'inspect', ref, '--format', '{{json .Image}}'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    if (/: not found\s*$/m.test(String(e.stderr))) return null;
    throw new Error(`${ref} を読めない: ${e.stderr}`);
  }
  return currentFromImage(JSON.parse(out), keys);
}

main(async () => {
  const kind = env('KIND');
  const os = env('OS');
  let keys;
  if (kind === 'php') keys = ['php'];
  else if (kind === 'frankenphp') keys = ['php', 'frankenphp'];
  else throw new Error(`KIND が php / frankenphp ではない: ${kind}`);

  const image = env('IMAGE');
  const digest = env('INDEX_DIGEST');
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error(`INDEX_DIGEST が不正: ${digest}`);
  const candidate = inspect(`${image}@${digest}`, keys);
  if (candidate === null) throw new Error(`${image}@${digest} が無い`);
  let tags;
  if (kind === 'php') {
    tags = phpTags({ phpVersion: candidate.php, officialTag: env('OFFICIAL_TAG'), os });
  } else {
    const pinned = env('FRANKENPHP_VERSION');
    if (candidate.frankenphp !== pinned) throw new Error(`イメージの FrankenPHP の版（${candidate.frankenphp}）が pin（${pinned}）と違う`);
    tags = frankenphpTags({ frankenphpVersion: pinned, phpVersion: candidate.php, os });
  }

  const current = inspect(`${image}:${tags.moving}`, keys);
  const decision = canMoveTag(current, candidate);
  const detail = `現行 ${JSON.stringify(current)}、今回 ${JSON.stringify(candidate)}`;
  if (decision === 'conflict') {
    console.log(`::error::移動タグ ${tags.moving} の現行と今回で、版の一方が上がり一方が下がる（${detail}）。固定タグだけ付けて失敗にする。新しい方の PHP の版を指定した workflow_dispatch で揃える`);
  } else if (decision === 'keep') {
    console.log(`::warning::移動タグ ${tags.moving} は現行の方が新しいので動かさない（${detail}）`);
  }
  console.log(JSON.stringify({ ...tags, decision, candidate, current }));
  setOutput('fixed', tags.fixed);
  setOutput('moving', tags.moving);
  setOutput('decision', decision);
  setOutput('phpVersion', candidate.php);
});

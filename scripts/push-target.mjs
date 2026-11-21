import { readFileSync, writeFileSync } from 'node:fs';
import { readPhpEnv } from './lib/php-dockerfile.mjs';
import { parseRelease, releaseUrl } from './lib/php-release.mjs';
import { pushTargetVersion } from './lib/publish.mjs';
import { inspectImage } from './lib/registry.mjs';
import { currentFromImage } from './lib/tags.mjs';
import { env, main, setOutput } from './lib/gha.mjs';

// push run は、移動タグがすでに official より新しい版（待機 run が php.net から組んだもの）を指していれば、
// その版で組む。official の版のまま組むと keep になり、親イメージの更新が移動タグに届かない。
main(async () => {
  const official = readPhpEnv(readFileSync(env('DOCKERFILE'), 'utf8')).version;
  const image = inspectImage(`${env('PHP_IMAGE')}:${env('OFFICIAL_TAG')}`, '{{json .Image}}');
  const moving = image === null ? null : currentFromImage(image, ['php']).php;
  const target = pushTargetVersion(official, moving);
  if (target === null) {
    console.log(`上流の Dockerfile の版（${official}）で組む（移動タグ: ${moving ?? 'なし'}）`);
    setOutput('releaseFile', '');
    return;
  }
  const res = await fetch(releaseUrl(target), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`php.net: HTTP ${res.status}`);
  const release = parseRelease(await res.json(), target);
  if (release === null) throw new Error(`php.net に PHP ${target} のリリース情報が無い`);
  const out = env('OUT_FILE');
  writeFileSync(out, JSON.stringify(release));
  console.log(`移動タグの版（${target}）が上流の Dockerfile（${official}）より新しいので、${target} に差し替えて組む`);
  setOutput('releaseFile', out);
});

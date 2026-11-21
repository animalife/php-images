import { checkWaitTarget } from './lib/php-release.mjs';
import { inspectImage } from './lib/registry.mjs';
import { currentFromImage } from './lib/tags.mjs';
import { env, main } from './lib/gha.mjs';

main(async () => {
  const target = env('PHP_VERSION');
  const ref = `${env('PHP_IMAGE')}:${env('OFFICIAL_TAG')}`;
  const image = inspectImage(ref, '{{json .Image}}');
  const moving = image === null ? null : currentFromImage(image, ['php']).php;
  checkWaitTarget(target, moving);
  console.log(moving === null ? `${ref} がまだ無いので版の検査はしない` : `PHP ${target} を待つ（移動タグ ${ref} は ${moving}）`);
});

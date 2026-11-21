import { findTag } from './official-images.mjs';

// ビルドする Dockerfile の取得元。パッチ付きのタグが library/php にあればそれを使う。無ければ（official がまだ
// 追いついていない、またはすでに先へ進んでパッチ付きのタグが消えた）移動タグを使い、版は後で pin へ差し替える。
export function resolveSource(libraryText, officialTag, movingTag) {
  try {
    return { ...findTag(libraryText, officialTag), viaMoving: false };
  } catch (e) {
    if (!/見つからない/.test(e.message)) throw e;
  }
  return { ...findTag(libraryText, movingTag), viaMoving: true };
}

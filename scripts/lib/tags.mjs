const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

function parts(v) {
  const m = VERSION_RE.exec(v ?? '');
  if (!m) throw new Error(`版が x.y.z の形ではない: '${v}'`);
  return m.slice(1).map(Number);
}

export function compareVersions(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

export function minorOf(version) {
  const [major, minor] = parts(version);
  return `${major}.${minor}`;
}

export function phpTags({ phpVersion, variant, os }) {
  return { fixed: `${phpVersion}-${variant}-${os}`, moving: `${minorOf(phpVersion)}-${variant}-${os}` };
}

export function frankenphpTags({ frankenphpVersion, phpVersion, os }) {
  const fp = parts(frankenphpVersion).join('.');
  return { fixed: `${fp}-php${phpVersion}-${os}`, moving: `php${minorOf(phpVersion)}-${os}` };
}

function readOne(image, keys) {
  const config = image?.config ?? {};
  const env = Object.fromEntries((config.Env ?? []).map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]));
  const values = { php: env.PHP_VERSION, frankenphp: config.Labels?.['org.opencontainers.image.version'] };
  return Object.fromEntries(keys.map((k) => {
    if (!values[k]) throw new Error(`現行イメージから ${k} の版を読めない`);
    return [k, values[k]];
  }));
}

// json は docker buildx imagetools inspect --format '{{json .Image}}' の出力。
export function currentFromImage(json, keys) {
  const images = json?.config ? [json] : Object.values(json ?? {});
  if (images.length === 0) throw new Error('現行イメージの設定が空');
  const found = images.map((img) => readOne(img, keys));
  if (found.some((f) => JSON.stringify(f) !== JSON.stringify(found[0]))) {
    throw new Error(`現行イメージの版がプラットフォーム間で食い違う: ${JSON.stringify(found)}`);
  }
  return found[0];
}

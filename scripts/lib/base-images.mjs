// 上流の Dockerfile は書き換えず、名前付きコンテキスト（--build-context / bake の contexts）で FROM を置き換える。

const DIRECTIVE_RE = /^#\s*([A-Za-z]+)\s*=\s*(\S+)\s*$/;
const DIGEST_RE = /@sha256:[0-9a-f]{64}$/;

export function dockerfileRefs(text) {
  let syntax = null;
  const stages = [];
  const refs = [];
  const add = (ref) => {
    if (ref.includes('$')) throw new Error(`変数を含む参照は pin を検査できない: ${ref}`);
    if (!refs.includes(ref)) refs.push(ref);
  };
  const lines = text.split('\n');
  for (const line of lines) {
    const d = DIRECTIVE_RE.exec(line);
    if (!d) break;
    if (d[1].toLowerCase() === 'syntax') syntax = d[2];
  }
  for (const line of lines) {
    const from = /^FROM\s+(.*)$/i.exec(line.trim());
    if (from) {
      const words = from[1].split(/\s+/).filter((w) => !w.startsWith('--'));
      add(words[0]);
      if (words[1]?.toLowerCase() === 'as' && words[2]) stages.push(words[2]);
    }
    for (const m of line.matchAll(/--from=([^\s,]+)/g)) add(m[1]);
    for (const m of line.matchAll(/--mount=\S*?\bfrom=([^\s,]+)/g)) add(m[1]);
  }
  return { syntax, stages, refs };
}

function pinned(ref, pins) {
  if (DIGEST_RE.test(ref)) return null;
  const digest = pins[ref];
  if (!digest) throw new Error(`親イメージ ${ref} が pin されていない（versions.json の baseImages に足す）`);
  return `${ref}@${digest}`;
}

export function pinBaseImages({ dockerfile, contexts = {}, exempt = [], pins }) {
  const { syntax, stages, refs } = dockerfileRefs(dockerfile);
  const out = {};
  for (const [name, value] of Object.entries(contexts)) {
    if (exempt.includes(name)) continue;
    if (!value.startsWith('docker-image://')) throw new Error(`コンテキスト ${name} が docker-image ではない: ${value}`);
    const ref = pinned(value.slice('docker-image://'.length), pins);
    if (ref) out[name] = `docker-image://${ref}`;
  }
  for (const ref of refs) {
    if (stages.includes(ref) || /^\d+$/.test(ref) || ref in contexts || ref === 'scratch') continue;
    const p = pinned(ref, pins);
    if (p) out[ref] = `docker-image://${p}`;
  }
  return { contexts: out, syntax: syntax === null ? null : (pinned(syntax, pins) ?? syntax) };
}

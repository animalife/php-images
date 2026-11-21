// docker-library/official-images の library/<name>（RFC 2822 風の stanza 列）を読む。
// 先頭の stanza はヘッダで、GitRepo などの既定値を持つ。

function parseStanzas(text) {
  const stanzas = [];
  for (const block of text.split(/\n\s*\n/)) {
    const fields = {};
    let last = null;
    for (const line of block.split('\n')) {
      if (line.startsWith('#') || line.trim() === '') continue;
      if (/^\s/.test(line) && last) {
        fields[last] += ` ${line.trim()}`;
        continue;
      }
      const m = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line);
      if (!m) throw new Error(`library ファイルの行を解釈できない: ${line}`);
      [, last] = m;
      fields[last] = m[2].trim();
    }
    if (Object.keys(fields).length > 0) stanzas.push(fields);
  }
  return stanzas;
}

export function findTag(text, tag) {
  const [header, ...entries] = parseStanzas(text);
  const hits = entries.filter((e) => (e.Tags ?? '').split(',').map((t) => t.trim()).includes(tag));
  if (hits.length === 0) throw new Error(`タグ ${tag} が library ファイルに見つからない`);
  if (hits.length > 1) throw new Error(`タグ ${tag} が library ファイルの複数の stanza にある`);
  const [entry] = hits;
  const gitRepo = entry.GitRepo ?? header?.GitRepo;
  const gitCommit = entry.GitCommit ?? '';
  const directory = entry.Directory ?? '';
  if (!/^[0-9a-f]{40}$/.test(gitCommit)) throw new Error(`タグ ${tag} の GitCommit が 40 桁の 16 進ではない: ${gitCommit}`);
  if (directory === '' || directory.startsWith('/') || directory.split('/').includes('..')) {
    throw new Error(`タグ ${tag} の Directory が不正: ${directory}`);
  }
  if (!gitRepo) throw new Error(`タグ ${tag} の GitRepo が無い`);
  return { gitRepo, gitCommit, directory };
}

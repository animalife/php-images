import { createHash } from 'node:crypto';
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const CHECKSUM_FILES = [
  { artifactPath: 'aqua-checksums.json', repoPath: '.github/aqua-checksums.json' },
  { artifactPath: 'aqua-ci/aqua-checksums.json', repoPath: '.github/aqua-ci/aqua-checksums.json' },
];

export const MAX_CHECKSUM_FILE_BYTES = 1024 * 1024;

const ARTIFACT_DIRECTORIES = new Set(['aqua-ci']);

export function listArtifactEntries(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((dirent) => {
    const path = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`;
    const stat = lstatSync(join(root, path));
    const kind = stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other';
    const entry = { path, kind, size: stat.size };
    return kind === 'directory' ? [entry, ...listArtifactEntries(root, path)] : [entry];
  });
}

export function checkArtifactEntries(entries) {
  const expected = new Set(CHECKSUM_FILES.map((f) => f.artifactPath));
  const seen = new Set();
  for (const { path, kind, size } of entries) {
    if (kind === 'directory' && ARTIFACT_DIRECTORIES.has(path)) continue;
    if (kind !== 'file') throw new Error(`artifact の ${path} が通常のファイルではない（${kind}）`);
    if (!expected.has(path)) throw new Error(`artifact に想定外のファイル ${path} がある`);
    if (size > MAX_CHECKSUM_FILE_BYTES) throw new Error(`artifact の ${path} が上限 ${MAX_CHECKSUM_FILE_BYTES} バイトを超える（${size}）`);
    seen.add(path);
  }
  for (const path of expected) {
    if (!seen.has(path)) throw new Error(`artifact に ${path} が無い`);
  }
}

const ENTRY_KEYS = ['algorithm', 'checksum', 'id'];

export function parseChecksumsFile(content) {
  const data = JSON.parse(content.toString('utf8'));
  if (data === null || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).join() !== 'checksums' || !Array.isArray(data.checksums)) {
    throw new Error('aqua-checksums.json は checksums の配列だけを持つオブジェクトでなければならない');
  }
  for (const entry of data.checksums) {
    const ok = entry !== null && typeof entry === 'object'
      && Object.keys(entry).sort().join() === ENTRY_KEYS.join()
      && ENTRY_KEYS.every((k) => typeof entry[k] === 'string')
      && /^[0-9A-Fa-f]+$/.test(entry.checksum);
    if (!ok) throw new Error(`aqua-checksums.json の要素の形が違う: ${JSON.stringify(entry)}`);
  }
  return data;
}

export function gitBlobSha(content) {
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
}

// contents API は symlink の先が通常のファイルだと、その先の中身を type: file で返して symlink であることを隠す。
// mode を見るため、親ディレクトリの tree の entries を読む。
export const HEAD_TREES_QUERY = `query($owner: String!, $name: String!, $github: String!, $aquaCi: String!) {
  repository(owner: $owner, name: $name) {
    github: object(expression: $github) { __typename ... on Tree { entries { name mode oid } } }
    aquaCi: object(expression: $aquaCi) { __typename ... on Tree { entries { name mode oid } } }
  }
}`;

export function headTreesVariables({ owner, name, headSha }) {
  return { owner, name, github: `${headSha}:.github`, aquaCi: `${headSha}:.github/aqua-ci` };
}

const MODE_TYPES = new Map([
  [0o100644, 'file'],
  [0o100755, 'file'],
  [0o120000, 'symlink'],
  [0o160000, 'submodule'],
  [0o040000, 'dir'],
]);

const TREE_ALIASES = { '.github': 'github', '.github/aqua-ci': 'aquaCi' };

export function headEntriesFromTrees(repository) {
  const entries = {};
  for (const { repoPath } of CHECKSUM_FILES) {
    const slash = repoPath.lastIndexOf('/');
    const dir = repoPath.slice(0, slash);
    const tree = repository[TREE_ALIASES[dir]];
    if (tree?.__typename !== 'Tree') throw new Error(`head の ${dir} がディレクトリではない`);
    const entry = tree.entries.find((e) => e.name === repoPath.slice(slash + 1));
    entries[repoPath] = entry === undefined ? null : { type: MODE_TYPES.get(entry.mode) ?? `mode ${entry.mode.toString(8)}`, sha: entry.oid };
  }
  return entries;
}

export function planAdditions(files, headEntries) {
  const additions = [];
  for (const { repoPath, content } of files) {
    const head = headEntries[repoPath] ?? null;
    if (head !== null && head.type !== 'file') throw new Error(`head の ${repoPath} が通常のファイルではない（${head.type}）`);
    if (head !== null && head.sha === gitBlobSha(content)) continue;
    additions.push({ path: repoPath, contents: content.toString('base64') });
  }
  return additions;
}

export function buildCommitInput({ repo, branch, headline, expectedHeadOid, additions }) {
  if (!/^[0-9a-f]{40}$/.test(expectedHeadOid)) throw new Error(`expectedHeadOid が SHA ではない: '${expectedHeadOid}'`);
  return {
    branch: { repositoryNameWithOwner: repo, branchName: branch },
    message: { headline },
    expectedHeadOid,
    fileChanges: { additions },
  };
}

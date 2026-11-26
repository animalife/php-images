import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCommitInput,
  checkArtifactEntries,
  CHECKSUM_FILES,
  gitBlobSha,
  headEntriesFromTrees,
  headTreesVariables,
  MAX_CHECKSUM_FILE_BYTES,
  parseChecksumsFile,
  planAdditions,
} from '../lib/aqua-checksums.mjs';

const VALID = Buffer.from(`${JSON.stringify({
  checksums: [
    { id: 'github_release/github.com/jdx/jactionlint/v2.6.0/jactionlint_2.6.0_linux_amd64.tar.gz', checksum: 'AA89C49AD5C9530F2308F18333166050F97F14D420F478A8225D043BEF1E2CAB', algorithm: 'sha256' },
  ],
}, null, 2)}\n`);

const OID = '0123456789abcdef0123456789abcdef01234567';

const goodEntries = () => [
  { path: 'aqua-checksums.json', kind: 'file', size: 100 },
  { path: 'aqua-ci', kind: 'directory', size: 0 },
  { path: 'aqua-ci/aqua-checksums.json', kind: 'file', size: 100 },
];

test('artifact の中身は 2 つの checksum ファイルとそのディレクトリだけを受け付ける', () => {
  assert.doesNotThrow(() => checkArtifactEntries(goodEntries()));
});

// 捕まえる変異: 想定外のファイルを黙って無視し、検査していないものが残る（あるいは足りないのに進む）。
test('ファイルが足りない・余計なファイルがあるなら例外にする', () => {
  assert.throws(() => checkArtifactEntries(goodEntries().slice(0, 2)), /aqua-ci\/aqua-checksums\.json/);
  assert.throws(() => checkArtifactEntries([...goodEntries(), { path: 'evil.json', kind: 'file', size: 1 }]), /evil\.json/);
  assert.throws(() => checkArtifactEntries([...goodEntries(), { path: 'other', kind: 'directory', size: 0 }]), /other/);
});

test('symlink や通常でないファイルは例外にする', () => {
  const entries = goodEntries();
  entries[0] = { path: 'aqua-checksums.json', kind: 'symlink', size: 10 };
  assert.throws(() => checkArtifactEntries(entries), /symlink/);
});

test('サイズの上限を超えるファイルは例外にする（上限ちょうどは通す）', () => {
  const entries = goodEntries();
  entries[0].size = MAX_CHECKSUM_FILE_BYTES;
  assert.doesNotThrow(() => checkArtifactEntries(entries));
  entries[0].size = MAX_CHECKSUM_FILE_BYTES + 1;
  assert.throws(() => checkArtifactEntries(entries), /上限/);
});

test('aqua-checksums.json の形をした JSON だけを受け付ける', () => {
  assert.doesNotThrow(() => parseChecksumsFile(VALID));
  assert.doesNotThrow(() => parseChecksumsFile(Buffer.from('{"checksums":[]}')));
  for (const bad of [
    'not json',
    '[]',
    '{}',
    '{"checksums":[],"extra":1}',
    '{"checksums":[{"id":"a","checksum":"AB"}]}',
    '{"checksums":[{"id":"a","checksum":"AB","algorithm":"sha256","x":1}]}',
    '{"checksums":[{"id":"a","checksum":"not hex","algorithm":"sha256"}]}',
    '{"checksums":[{"id":1,"checksum":"AB","algorithm":"sha256"}]}',
  ]) {
    assert.throws(() => parseChecksumsFile(Buffer.from(bad)), undefined, bad);
  }
});

test('git の blob の SHA を計算する', () => {
  // `printf 'hello\n' | git hash-object --stdin` の値。
  assert.equal(gitBlobSha(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
});

test('git の blob の SHA は実際の git と一致する', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aqua-checksums-test-'));
  try {
    const file = join(dir, 'a.json');
    writeFileSync(file, VALID);
    assert.equal(gitBlobSha(VALID), execFileSync('git', ['hash-object', file], { encoding: 'utf8' }).trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('head と同じ中身のファイルはコミットしない', () => {
  const files = CHECKSUM_FILES.map(({ repoPath }) => ({ repoPath, content: VALID }));
  const head = Object.fromEntries(CHECKSUM_FILES.map(({ repoPath }) => [repoPath, { type: 'file', sha: gitBlobSha(VALID) }]));
  assert.deepEqual(planAdditions(files, head), []);
});

test('中身が変わったファイルと head に無いファイルだけを base64 で追加する', () => {
  const changed = Buffer.from('{"checksums":[]}\n');
  const files = [
    { repoPath: '.github/aqua-checksums.json', content: changed },
    { repoPath: '.github/aqua-ci/aqua-checksums.json', content: VALID },
  ];
  assert.deepEqual(planAdditions(files, {
    '.github/aqua-checksums.json': { type: 'file', sha: gitBlobSha(VALID) },
    '.github/aqua-ci/aqua-checksums.json': { type: 'file', sha: gitBlobSha(VALID) },
  }), [{ path: '.github/aqua-checksums.json', contents: changed.toString('base64') }]);
  assert.deepEqual(planAdditions(files.slice(1), { '.github/aqua-ci/aqua-checksums.json': null }), [
    { path: '.github/aqua-ci/aqua-checksums.json', contents: VALID.toString('base64') },
  ]);
});

// 捕まえる変異: head の symlink やサブモジュールを通常ファイルで黙って置き換える。
test('head 側が通常のファイルでなければ例外にする', () => {
  const files = [{ repoPath: '.github/aqua-checksums.json', content: VALID }];
  for (const type of ['symlink', 'submodule', 'dir']) {
    assert.throws(() => planAdditions(files, { '.github/aqua-checksums.json': { type, sha: 'x' } }), new RegExp(type));
  }
});

test('createCommitOnBranch の入力は head の SHA を expectedHeadOid にし、削除を含めない', () => {
  const additions = [{ path: '.github/aqua-checksums.json', contents: 'e30=' }];
  assert.deepEqual(buildCommitInput({ repo: 'o/r', branch: 'renovate/aqua', headline: 'm', expectedHeadOid: OID, additions }), {
    branch: { repositoryNameWithOwner: 'o/r', branchName: 'renovate/aqua' },
    message: { headline: 'm' },
    expectedHeadOid: OID,
    fileChanges: { additions },
  });
});

test('expectedHeadOid が 40 桁の SHA でなければ例外にする', () => {
  for (const bad of ['', 'main', OID.slice(1), OID.toUpperCase()]) {
    assert.throws(() => buildCommitInput({ repo: 'o/r', branch: 'b', headline: 'm', expectedHeadOid: bad, additions: [] }), /expectedHeadOid/);
  }
});

// fixture は GraphQL の object(expression: "<sha>:.github") が返す形（mode は 10 進の整数）。
const tree = (entries) => ({ __typename: 'Tree', entries });

test('head の tree の entries から、通常のファイルの blob の SHA を取る', () => {
  assert.deepEqual(headEntriesFromTrees({
    github: tree([{ name: 'aqua-checksums.json', mode: 33188, oid: 'a' }, { name: 'aqua-ci', mode: 16384, oid: 't' }]),
    aquaCi: tree([{ name: 'aqua-checksums.json', mode: 33261, oid: 'b' }]),
  }), {
    '.github/aqua-checksums.json': { type: 'file', sha: 'a' },
    '.github/aqua-ci/aqua-checksums.json': { type: 'file', sha: 'b' },
  });
});

test('head に無いファイルは null、symlink とサブモジュールは種類で返す', () => {
  assert.deepEqual(headEntriesFromTrees({
    github: tree([{ name: 'aqua-checksums.json', mode: 40960, oid: 'a' }]),
    aquaCi: tree([{ name: 'aqua-checksums.json', mode: 57344, oid: 'b' }]),
  }), {
    '.github/aqua-checksums.json': { type: 'symlink', sha: 'a' },
    '.github/aqua-ci/aqua-checksums.json': { type: 'submodule', sha: 'b' },
  });
  assert.deepEqual(headEntriesFromTrees({ github: tree([]), aquaCi: tree([]) }), {
    '.github/aqua-checksums.json': null,
    '.github/aqua-ci/aqua-checksums.json': null,
  });
});

test('親ディレクトリが tree でなければ例外にする', () => {
  assert.throws(() => headEntriesFromTrees({ github: tree([]), aquaCi: null }), /\.github\/aqua-ci/);
  assert.throws(() => headEntriesFromTrees({ github: { __typename: 'Blob' }, aquaCi: tree([]) }), /\.github/);
});

test('tree を引く式は head の SHA に固定する', () => {
  assert.deepEqual(headTreesVariables({ owner: 'o', name: 'r', headSha: OID }), {
    owner: 'o', name: 'r', github: `${OID}:.github`, aquaCi: `${OID}:.github/aqua-ci`,
  });
});

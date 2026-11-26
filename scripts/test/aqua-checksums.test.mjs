import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCommitInput,
  checkArtifactEntries,
  CHECKSUM_FILES,
  commitChecksums,
  dirtyChecksums,
  gitBlobSha,
  headEntriesFromTrees,
  headTreesVariables,
  listArtifactEntries,
  MAX_CHECKSUM_FILE_BYTES,
  parseChecksumsFile,
  planAdditions,
  regenerateChecksums,
  stageChecksums,
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

// 捕まえる変異: lstat を stat に変え、symlink を辿って通常のファイルやディレクトリとして扱う。
test('artifact のディレクトリを symlink を辿らずに列挙する', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aqua-checksums-list-'));
  try {
    const root = join(dir, 'artifact');
    mkdirSync(join(root, 'aqua-ci'), { recursive: true });
    writeFileSync(join(root, 'aqua-checksums.json'), 'abc');
    writeFileSync(join(root, 'aqua-ci', 'aqua-checksums.json'), 'de');
    mkdirSync(join(dir, 'outside'));
    writeFileSync(join(dir, 'outside', 'secret.json'), 'x');
    symlinkSync(join(dir, 'outside', 'secret.json'), join(root, 'link.json'));
    symlinkSync(join(dir, 'outside'), join(root, 'linkdir'));
    const entries = listArtifactEntries(root).sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(entries.map(({ path, kind }) => ({ path, kind })), [
      { path: 'aqua-checksums.json', kind: 'file' },
      { path: 'aqua-ci', kind: 'directory' },
      { path: 'aqua-ci/aqua-checksums.json', kind: 'file' },
      { path: 'link.json', kind: 'symlink' },
      { path: 'linkdir', kind: 'symlink' },
    ]);
    assert.equal(entries.find((e) => e.path === 'aqua-checksums.json').size, 3);
    assert.throws(() => checkArtifactEntries(entries), /symlink/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'aqua-checksums-run-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function withTmpAsync(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'aqua-checksums-run-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeArtifact(dir, contents = {}) {
  mkdirSync(join(dir, 'aqua-ci'), { recursive: true });
  for (const { artifactPath } of CHECKSUM_FILES) writeFileSync(join(dir, artifactPath), contents[artifactPath] ?? VALID);
}

// fake の graphql: tree の問い合わせには headBlob の中身を持つ tree を返し、mutation は記録して URL を返す。
function fakeGraphql(headBlob) {
  const calls = [];
  const graphql = async (query, variables) => {
    calls.push({ query, variables });
    if (query.includes('createCommitOnBranch')) return { createCommitOnBranch: { commit: { oid: OID, url: 'https://example.test/c' } } };
    const entries = [{ name: 'aqua-checksums.json', mode: 33188, oid: gitBlobSha(headBlob) }];
    return { repository: { github: tree(entries), aquaCi: tree(entries) } };
  };
  return { graphql, calls, mutations: () => calls.filter((c) => c.query.includes('createCommitOnBranch')) };
}

const commitArgs = (artifactDir, graphql) => ({ artifactDir, repo: 'o/r', branch: 'renovate/aqua', headSha: OID, graphql });

test('commitChecksums: head と同じ中身なら mutation を呼ばない', async () => {
  await withTmpAsync(async (dir) => {
    writeArtifact(dir);
    const fake = fakeGraphql(VALID);
    assert.deepEqual(await commitChecksums(commitArgs(dir, fake.graphql)), { committed: false });
    assert.equal(fake.mutations().length, 0);
  });
});

test('commitChecksums: 変わったファイルだけを head の SHA を expectedHeadOid にして積む', async () => {
  await withTmpAsync(async (dir) => {
    const changed = Buffer.from('{"checksums":[]}\n');
    writeArtifact(dir, { 'aqua-checksums.json': changed });
    const fake = fakeGraphql(VALID);
    assert.deepEqual(await commitChecksums(commitArgs(dir, fake.graphql)), {
      committed: true, url: 'https://example.test/c', paths: ['.github/aqua-checksums.json'],
    });
    const [mutation] = fake.mutations();
    assert.equal(mutation.variables.input.expectedHeadOid, OID);
    assert.equal(mutation.variables.input.branch.branchName, 'renovate/aqua');
    assert.deepEqual(mutation.variables.input.fileChanges.additions, [{ path: '.github/aqua-checksums.json', contents: changed.toString('base64') }]);
    assert.equal(fake.calls[0].variables.github, `${OID}:.github`);
  });
});

// 捕まえる変異: 入口から artifact の検査（checkArtifactEntries / parseChecksumsFile）の呼び出しが抜ける。
test('commitChecksums: artifact が不正なら API を呼ばずに例外にする', async () => {
  for (const [label, prepare] of [
    ['余計なファイル', (dir) => writeFileSync(join(dir, 'evil.json'), '{}')],
    ['形の違う JSON', (dir) => writeFileSync(join(dir, 'aqua-checksums.json'), '{"checksums":[],"x":1}')],
  ]) {
    await withTmpAsync(async (dir) => {
      writeArtifact(dir);
      prepare(dir);
      const fake = fakeGraphql(Buffer.from('other'));
      await assert.rejects(commitChecksums(commitArgs(dir, fake.graphql)), undefined, label);
      assert.equal(fake.calls.length, 0, label);
    });
  }
});

test('regenerateChecksums: 両方の checksum を消してから、設定ごとに update-checksum --prune を実行する', () => {
  withTmp((dir) => {
    mkdirSync(join(dir, '.github', 'aqua-ci'), { recursive: true });
    for (const { repoPath } of CHECKSUM_FILES) writeFileSync(join(dir, repoPath), 'stale');
    const calls = [];
    regenerateChecksums({
      cwd: dir,
      exec: (cmd, args, opts) => {
        calls.push({ cmd, args, config: opts.env.AQUA_CONFIG, cwd: opts.cwd, existing: CHECKSUM_FILES.filter(({ repoPath }) => existsSync(join(dir, repoPath))).length });
      },
    });
    assert.deepEqual(calls, [
      { cmd: 'aqua', args: ['update-checksum', '--prune'], config: '.github/aqua.yaml', cwd: dir, existing: 0 },
      { cmd: 'aqua', args: ['update-checksum', '--prune'], config: '.github/aqua-ci/aqua.yaml', cwd: dir, existing: 0 },
    ]);
  });
});

test('stageChecksums: 作り直した 2 つのファイルを artifact の配置で写す', () => {
  withTmp((dir) => {
    mkdirSync(join(dir, 'ws', '.github', 'aqua-ci'), { recursive: true });
    writeFileSync(join(dir, 'ws', '.github', 'aqua-checksums.json'), 'a');
    writeFileSync(join(dir, 'ws', '.github', 'aqua-ci', 'aqua-checksums.json'), 'b');
    stageChecksums({ cwd: join(dir, 'ws'), outDir: join(dir, 'out') });
    assert.equal(readFileSync(join(dir, 'out', 'aqua-checksums.json'), 'utf8'), 'a');
    assert.equal(readFileSync(join(dir, 'out', 'aqua-ci', 'aqua-checksums.json'), 'utf8'), 'b');
  });
});

// 捕まえる変異: symlink を辿って、その先の中身を artifact に載せる。
test('stageChecksums: symlink なら例外にする', () => {
  withTmp((dir) => {
    mkdirSync(join(dir, 'ws', '.github', 'aqua-ci'), { recursive: true });
    writeFileSync(join(dir, 'secret'), 's');
    symlinkSync(join(dir, 'secret'), join(dir, 'ws', '.github', 'aqua-checksums.json'));
    writeFileSync(join(dir, 'ws', '.github', 'aqua-ci', 'aqua-checksums.json'), 'b');
    assert.throws(() => stageChecksums({ cwd: join(dir, 'ws'), outDir: join(dir, 'out') }), /通常のファイル/);
  });
});

test('dirtyChecksums: コミット済みと違う・index に無いファイルを拾い、同じなら空を返す', () => {
  withTmp((dir) => {
    const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    git('init', '-q');
    mkdirSync(join(dir, '.github', 'aqua-ci'), { recursive: true });
    for (const { repoPath } of CHECKSUM_FILES) writeFileSync(join(dir, repoPath), 'v1');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
    assert.equal(dirtyChecksums({ cwd: dir }), '');
    writeFileSync(join(dir, '.github', 'aqua-checksums.json'), 'v2');
    assert.match(dirtyChecksums({ cwd: dir }), /aqua-checksums\.json/);
    git('checkout', '-q', '--', '.github/aqua-checksums.json');
    // git diff --exit-code では拾えない形（index から消えて untracked として作り直された）。
    git('rm', '-q', '--cached', '.github/aqua-ci/aqua-checksums.json');
    assert.match(dirtyChecksums({ cwd: dir }), /\?\? \.github\/aqua-ci\/aqua-checksums\.json/);
  });
});

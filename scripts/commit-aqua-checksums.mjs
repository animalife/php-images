import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCommitInput,
  checkArtifactEntries,
  CHECKSUM_FILES,
  HEAD_TREES_QUERY,
  headEntriesFromTrees,
  headTreesVariables,
  parseChecksumsFile,
  planAdditions,
} from './lib/aqua-checksums.mjs';
import { client } from './lib/github.mjs';
import { appendSummary, env, main } from './lib/gha.mjs';

function listEntries(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((dirent) => {
    const path = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`;
    const stat = lstatSync(join(root, path));
    const kind = stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other';
    const entry = { path, kind, size: stat.size };
    return kind === 'directory' ? [entry, ...listEntries(root, path)] : [entry];
  });
}

main(async () => {
  const repo = env('GITHUB_REPOSITORY');
  const branch = env('TARGET_BRANCH');
  const headSha = env('HEAD_SHA');
  const artifactDir = env('ARTIFACT_DIR');
  const { graphql } = client(env('GH_TOKEN'));

  checkArtifactEntries(listEntries(artifactDir));
  const files = CHECKSUM_FILES.map(({ artifactPath, repoPath }) => {
    const content = readFileSync(join(artifactDir, artifactPath));
    parseChecksumsFile(content);
    return { repoPath, content };
  });

  const [owner, name] = repo.split('/');
  const trees = await graphql(HEAD_TREES_QUERY, headTreesVariables({ owner, name, headSha }));
  const additions = planAdditions(files, headEntriesFromTrees(trees.repository));
  if (additions.length === 0) {
    appendSummary('aqua-checksums.json は最新なので、コミットしなかった。');
    return;
  }

  const data = await graphql(
    `mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid url } } }`,
    { input: buildCommitInput({ repo, branch, headline: 'chore(deps): aqua-checksums.json を作り直す', expectedHeadOid: headSha, additions }) },
  );
  const { url } = data.createCommitOnBranch.commit;
  appendSummary([
    `${branch} に aqua-checksums.json を作り直したコミットを積んだ: ${url}`,
    '',
    ...additions.map(({ path }) => `- \`${path}\``),
  ].join('\n'));
});

// `git diff --cached --name-status -z` の出力を、createCommitOnBranch の追加パスと削除パスに振り分ける。
export function parseNameStatusZ(raw) {
  const tokens = raw === '' ? [] : raw.split('\0');
  // -z の出力は各レコードが NUL 終端なので、末尾に空文字列が残る。
  if (tokens.at(-1) === '') tokens.pop();

  const addPaths = [];
  const delPaths = [];
  let i = 0;
  while (i < tokens.length) {
    const code = tokens[i++][0];
    if (code === 'R' || code === 'C') {
      // リネームとコピーは旧パスと新パスの 2 つを持つ。
      const oldPath = tokens[i++];
      const newPath = tokens[i++];
      if (code === 'R') delPaths.push(oldPath);
      addPaths.push(newPath);
    } else if (code === 'D') {
      delPaths.push(tokens[i++]);
    } else {
      addPaths.push(tokens[i++]);
    }
  }
  return { addPaths, delPaths };
}

// `git add -A` は選べないようにしている。作業ツリーには信頼版スクリプトを展開したディレクトリ（.base-trusted）が
// あり、それをコミットに巻き込むため。
export function buildAddArgs(commitPaths) {
  const paths = (commitPaths ?? '').split(/\s+/).filter(Boolean);
  if (paths.length === 0) throw new Error('COMMIT_PATHS にコミットするパスが無い');
  return ['add', '--', ...paths];
}

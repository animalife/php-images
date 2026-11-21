// git ls-remote の出力から、タグが指す commit を返す（無ければ null）。
export function tagCommit(output, tag) {
  const refs = new Map(output.split('\n').filter(Boolean).map((line) => {
    const [sha, ref] = line.split('\t');
    return [ref, sha];
  }));
  return refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`) ?? null;
}

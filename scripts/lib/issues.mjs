const PUSH_TITLE = 'build ワークフローが main で失敗している';
const NIGHT_RE = /^夜のジョブが PHP ((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)) を上げられていない$/;

export function issueTitle({ phpVersion }) {
  return phpVersion === '' ? PUSH_TITLE : `夜のジョブが PHP ${phpVersion} を上げられていない`;
}

export function nightIssueVersion(title) {
  return NIGHT_RE.exec(title)?.[1] ?? null;
}

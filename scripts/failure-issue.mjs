import { readFileSync } from 'node:fs';
import { bumpVersions } from './lib/bump.mjs';
import { client } from './lib/github.mjs';
import { issueTitle, nightIssueVersion } from './lib/issues.mjs';
import { env, main } from './lib/gha.mjs';

// main の run の失敗を Issue に残し、直ったら閉じる。push・復旧と夜のジョブ（版ごと）でタイトルを分ける。
// - 失敗: その run の種類の Issue を作る（開いていればコメント）
// - push か版を指定しない dispatch の成功: push 側の Issue と、その版が main に入った夜の Issue を閉じる
main(async () => {
  const repo = env('GITHUB_REPOSITORY');
  const { rest } = client(env('GH_TOKEN'));
  const phpVersion = env('PHP_VERSION_INPUT', { optional: true });
  const results = JSON.parse(env('RESULTS'));
  const runUrl = env('RUN_URL');
  const failed = Object.entries(results).filter(([, v]) => v.result === 'failure' || v.result === 'cancelled');

  const open = await rest('GET', `/repos/${repo}/issues?state=open&per_page=100`);
  const byTitle = (title) => open.find((i) => !i.pull_request && i.title === title) ?? null;

  if (failed.length > 0) {
    const title = issueTitle({ phpVersion });
    const body = [
      'build ワークフローの run が失敗した。README の「失敗したとき」を参照。',
      '',
      `- run: ${runUrl}`,
      `- event: ${env('EVENT_NAME')}${phpVersion ? `（PHP ${phpVersion} を待機）` : ''}`,
      '',
      ...failed.map(([job, v]) => `- ${job}: ${v.result}`),
    ].join('\n');
    const existing = byTitle(title);
    if (existing) await rest('POST', `/repos/${repo}/issues/${existing.number}/comments`, { body });
    else await rest('POST', `/repos/${repo}/issues`, { title, body });
    return;
  }
  if (phpVersion !== '') return;

  const close = async (issue, reason) => {
    await rest('POST', `/repos/${repo}/issues/${issue.number}/comments`, { body: `${reason}: ${runUrl}` });
    await rest('PATCH', `/repos/${repo}/issues/${issue.number}`, { state: 'closed' });
  };
  const pushIssue = byTitle(issueTitle({ phpVersion: '' }));
  if (pushIssue) await close(pushIssue, 'main の run が成功したので閉じる');
  const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
  for (const issue of open) {
    const v = issue.pull_request ? null : nightIssueVersion(issue.title);
    let covered = false;
    try {
      covered = v !== null && bumpVersions(versions, v) === null;
    } catch (e) {
      console.log(`::warning::${issue.title} の版を versions.json と比べられない: ${e.message}`);
    }
    if (covered) await close(issue, `main の versions.json が PHP ${v} 以上になり、公開の run が成功したので閉じる`);
  }
});

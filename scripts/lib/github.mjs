const API = 'https://api.github.com';

// 恒久的なエラー（権限不足・存在しないなど）は再試行しても直らないので、すぐ失敗させる。
// GitHub は secondary rate limit を 403 で返すので、rate limit を示す 403 は一時的なエラーとして扱う。
export function isPermanentHttpStatus(status, { body = '', headers = {} } = {}) {
  if (status === 403) {
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    if (/rate limit/i.test(body) || 'retry-after' in h || h['x-ratelimit-remaining'] === '0') return false;
  }
  return status >= 400 && status < 500 && status !== 429;
}

export function isPermanentGraphqlError(errors) {
  return errors.some((e) => ['FORBIDDEN', 'NOT_FOUND'].includes(e.type) || /Resource not accessible/i.test(e.message ?? ''));
}

export class ApiError extends Error {
  constructor(message, permanent) {
    super(message);
    this.permanent = permanent;
  }
}

export function client(token) {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  async function rest(method, path, body, { allow404 = false } = {}) {
    const res = await fetch(`${API}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
    if (allow404 && res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      const permanent = isPermanentHttpStatus(res.status, { body: text, headers: Object.fromEntries(res.headers) });
      throw new ApiError(`${method} ${path}: HTTP ${res.status} ${text}`, permanent);
    }
    return res.status === 204 ? null : res.json();
  }
  async function graphql(query, variables) {
    const out = await rest('POST', '/graphql', { query, variables });
    if (out.errors) throw new ApiError(`GraphQL: ${JSON.stringify(out.errors)}`, isPermanentGraphqlError(out.errors));
    return out.data;
  }
  return { rest, graphql };
}

// bump（App のトークン）用。App には Checks / Commit statuses の権限が無いので、statusCheckRollup を読まない。
export const PR_BUMP_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { id state mergeable url isInMergeQueue autoMergeRequest { enabledAt } }
  }
}`;

// watch-bump（GITHUB_TOKEN、checks / statuses の読み取り付き）用。GITHUB_TOKEN には merge queue の権限項目が無く
// mergeQueueEntry は FORBIDDEN になりうるので読まない（キューの判定は isInMergeQueue だけで行う）。
export const PR_STATE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id state mergeable url isInMergeQueue
      autoMergeRequest { enabledAt }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    }
  }
}`;

export function prState(data) {
  const pr = data.repository.pullRequest;
  return {
    id: pr.id,
    url: pr.url,
    state: pr.state,
    mergeable: pr.mergeable,
    autoMergeRequest: pr.autoMergeRequest,
    isInMergeQueue: pr.isInMergeQueue === true,
    rollup: pr.commits?.nodes[0]?.commit.statusCheckRollup?.state ?? null,
  };
}

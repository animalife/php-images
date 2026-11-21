const API = 'https://api.github.com';

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
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }
  async function graphql(query, variables) {
    const out = await rest('POST', '/graphql', { query, variables });
    if (out.errors) throw new Error(`GraphQL: ${JSON.stringify(out.errors)}`);
    return out.data;
  }
  return { rest, graphql };
}

export const PR_STATE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id state mergeable url
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
    rollup: pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
  };
}

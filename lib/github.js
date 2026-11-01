// Repo status for the Dev card: CI on the default branch, latest commit, open PRs.
const TTL = 5 * 60 * 1000;

async function gh(token, path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: 'no-store'
  });
  if (!res.ok) {
    const e = new Error(`GitHub ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

async function one(token, full) {
  const repo = await gh(token, `/repos/${full}`);
  const branch = repo.default_branch;
  const [commits, runs, pulls] = await Promise.all([
    gh(token, `/repos/${full}/commits?sha=${encodeURIComponent(branch)}&per_page=1`),
    gh(token, `/repos/${full}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=1`).catch(() => ({ workflow_runs: [] })),
    gh(token, `/repos/${full}/pulls?state=open&per_page=100`).catch(() => [])
  ]);
  const c = commits[0];
  const run = runs.workflow_runs?.[0];
  let ci = 'none';
  if (run) ci = run.status !== 'completed' ? 'running' : run.conclusion === 'success' ? 'success' : ['cancelled', 'skipped', 'neutral'].includes(run.conclusion) ? 'neutral' : 'failure';
  return {
    full: repo.full_name,
    name: repo.name,
    url: repo.html_url,
    private: repo.private,
    branch,
    ci,
    ciUrl: run?.html_url || `${repo.html_url}/actions`,
    ciName: run?.name || '',
    commit: c ? { msg: c.commit.message.split('\n')[0], at: c.commit.committer?.date || c.commit.author?.date, url: c.html_url, sha: c.sha.slice(0, 7) } : null,
    prs: Array.isArray(pulls) ? pulls.length : 0
  };
}

export async function repoStatuses(token, repos, { force = false } = {}) {
  const { ghCache } = await chrome.storage.local.get('ghCache');
  const sig = repos.join(',') + '|' + (token ? 't' : '');
  if (!force && ghCache?.sig === sig && Date.now() - ghCache.at < TTL) return ghCache.items;
  const items = await Promise.all(repos.map(async (full) => {
    try { return await one(token, full); } catch (e) {
      const msg = e.status === 404
        ? (token ? 'Not found — private repos need a token with repo access (Options → Dev card).' : 'Not found — private? Add a token in Options → Dev card.')
        : e.status === 401 ? 'Token rejected' : e.status === 403 ? 'Rate-limited by GitHub — add a token' : 'Couldn’t reach GitHub';
      return { full, name: full.split('/')[1], url: `https://github.com/${full}`, error: msg };
    }
  }));
  await chrome.storage.local.set({ ghCache: { sig, at: Date.now(), items } });
  return items;
}

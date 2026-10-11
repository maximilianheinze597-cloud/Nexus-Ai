const API = 'https://api.github.com';
const headers = () => ({
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
});

async function gh(path, opts = {}) {
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN fehlt in .env');
  const r = await fetch(API + path, { ...opts, headers: headers() });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : r.json();
}

export const repos = async () =>
  (await gh('/user/repos?per_page=100&sort=updated')).map((x) => ({
    full_name: x.full_name, private: x.private, description: x.description,
  }));

export async function tree(repo) {
  const base = (await gh(`/repos/${repo}`)).default_branch;
  const t = await gh(`/repos/${repo}/git/trees/${base}?recursive=1`);
  return t.tree.filter((x) => x.type === 'blob').map((x) => x.path).slice(0, 500);
}

export async function readFile(repo, path) {
  const j = await gh(`/repos/${repo}/contents/${path}`);
  if (!j.content) throw new Error('Keine Datei');
  return Buffer.from(j.content, 'base64').toString('utf8').slice(0, 20000);
}

export async function search(repo, q) {
  const r = await gh(`/search/code?q=${encodeURIComponent(`${q} repo:${repo}`)}&per_page=10`);
  return r.items.map((i) => i.path);
}

// Schreibzugriff: nie direkt auf den Default-Branch, immer eigener Branch + Pull Request.
export async function createPR(repo, { branch, title, body, message, files }) {
  const base = (await gh(`/repos/${repo}`)).default_branch;
  const ref = await gh(`/repos/${repo}/git/ref/heads/${base}`);
  await gh(`/repos/${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }) });
  for (const f of files) {
    let sha;
    try { sha = (await gh(`/repos/${repo}/contents/${f.path}?ref=${branch}`)).sha; } catch {}
    await gh(`/repos/${repo}/contents/${f.path}`, {
      method: 'PUT',
      body: JSON.stringify({ message: message || title, content: Buffer.from(f.content).toString('base64'), branch, sha }),
    });
  }
  const pr = await gh(`/repos/${repo}/pulls`, { method: 'POST', body: JSON.stringify({ title, body, head: branch, base }) });
  return pr.html_url;
}

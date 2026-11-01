// Self-update from a (private) GitHub repo.
//
// Chrome can't install an extension from outside the Web Store by itself, but an unpacked
// extension runs straight from its folder. So: you give Nightshift access to that folder once
// (File System Access API), and an update just rewrites the changed files and reloads. The
// extension id is tied to the folder path, so all your data (screen time, to-dos, settings)
// stays exactly where it is.
//
// Checking for updates runs in the service worker (alarm). Writing files needs a page, because
// folder access is granted to pages; the new tab does it silently once access is permanent,
// and Options → Updates does it on a click.
import { load, save } from './common.js';

const DB = 'nightshift-fs';
const API = 'https://api.github.com';
const SKIP = /(^|\/)(\.git|\.github|\.DS_Store|node_modules)(\/|$)|^_(?!locales\/)|^server\//;

/* ---------- config ---------- */
export async function updaterState() {
  const { updater, github, sync } = await load(['updater', 'github', 'sync']);
  return { ...updater, token: github?.token || sync?.token || '' };
}
export const currentVersion = () => chrome.runtime.getManifest().version;
export function newer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function gh(token, path, accept = 'application/vnd.github+json') {
  const res = await fetch(`${API}${path}`, {
    headers: { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: 'no-store'
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error(token ? 'Repo not found. Check the name, and that the token can read it (repo scope, or Contents: read).' : 'Repo not found. It’s private, so add a GitHub token with repo access.');
    if (res.status === 401) throw new Error('GitHub rejected the token. Paste a fresh one.');
    if (res.status === 403) throw new Error('GitHub refused (rate limit or missing permission). Try again later.');
    throw new Error(`GitHub ${res.status}`);
  }
  return res;
}
const b64bytes = (b64) => Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0));
const prefixed = (dir, p) => (dir ? `${dir.replace(/\/+$/, '')}/${p}` : p);

/* ---------- check (service worker or page) ---------- */
export async function checkForUpdate({ force = false } = {}) {
  const st = await updaterState();
  if (!st.repo) return st;
  if (!force && Date.now() - (st.lastCheck || 0) < 30 * 60 * 1000) return st;
  const patch = { lastCheck: Date.now(), lastError: '' };
  try {
    const commit = await (await gh(st.token, `/repos/${st.repo}/commits/${encodeURIComponent(st.branch || 'main')}`)).json();
    const sha = commit.sha;
    let latest = st.latest?.sha === sha ? st.latest : null;
    if (!latest) {
      const file = await (await gh(st.token, `/repos/${st.repo}/contents/${prefixed(st.dir, 'manifest.json')}?ref=${sha}`)).json();
      const manifest = JSON.parse(new TextDecoder().decode(b64bytes(file.content)));
      latest = { sha, version: manifest.version, message: (commit.commit?.message || '').split('\n')[0].slice(0, 140), at: commit.commit?.committer?.date || '' };
    }
    patch.latest = latest;
  } catch (e) {
    patch.lastError = e.message || String(e);
  }
  const updater = { ...(await load(['updater'])).updater, ...patch };
  await save({ updater });
  return { ...st, ...updater };
}

// Is there something to install? A higher version, or (once we've installed from the repo)
// the same version at a different commit.
export function hasUpdate(st) {
  const l = st?.latest;
  if (!l?.version) return false;
  const cur = currentVersion();
  if (newer(l.version, cur)) return true;
  return l.version === cur && !!st.installedSha && st.installedSha !== l.sha;
}

/* ---------- folder handle (pages only) ---------- */
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('h');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((res, rej) => { const q = db.transaction('h').objectStore('h').get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); });
}
async function idbSet(key, val) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction('h', 'readwrite'); tx.objectStore('h').put(val, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

export const folderSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;
export const getFolder = () => idbGet('root').catch(() => null);

// Has this handle got the running extension in it? Compares manifest.json byte for byte.
async function isThisExtension(dir) {
  try {
    const f = await (await dir.getFileHandle('manifest.json')).getFile();
    const mine = await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).text();
    return (await f.text()) === mine;
  } catch { return false; }
}

export async function pickFolder() {
  const dir = await window.showDirectoryPicker({ id: 'nightshift', mode: 'readwrite' });
  if (!(await isThisExtension(dir))) throw new Error('That isn’t the folder Nightshift is running from. Pick the folder you loaded in chrome://extensions (the one with manifest.json).');
  await idbSet('root', dir);
  return dir;
}

// 'granted' | 'prompt' | 'denied' | 'none'
export async function folderPermission(dir) {
  dir ||= await getFolder();
  if (!dir) return 'none';
  try { return await dir.queryPermission({ mode: 'readwrite' }); } catch { return 'none'; }
}

/* ---------- apply ---------- */
async function gitSha(bytes) {
  const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head); all.set(bytes, head.length);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-1', all))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function walk(dir, parts, create) {
  let d = dir;
  for (const p of parts) d = await d.getDirectoryHandle(p, { create });
  return d;
}
async function readLocal(dir, path) {
  try {
    const parts = path.split('/');
    const f = await (await walk(dir, parts.slice(0, -1), false)).getFileHandle(parts.at(-1));
    return new Uint8Array(await (await f.getFile()).arrayBuffer());
  } catch { return null; }
}
async function writeLocal(dir, path, bytes) {
  const parts = path.split('/');
  const fh = await (await walk(dir, parts.slice(0, -1), true)).getFileHandle(parts.at(-1), { create: true });
  const w = await fh.createWritable();
  await w.write(bytes);
  await w.close();
}
async function removeLocal(dir, path) {
  try {
    const parts = path.split('/');
    await (await walk(dir, parts.slice(0, -1), false)).removeEntry(parts.at(-1));
  } catch {}
}

// Downloads everything first and only then writes, so a failed download leaves the folder alone.
// `dir` may be passed in (tests use the origin-private file system); otherwise the saved folder.
export async function applyUpdate({ interactive = false, dir = null, onProgress = () => {} } = {}) {
  const st = await updaterState();
  if (!st.repo) throw new Error('Set the repository first.');
  dir ||= await getFolder();
  if (!dir) throw new Error('Give Nightshift access to its folder first.');
  let perm = await dir.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted' && interactive) perm = await dir.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') throw Object.assign(new Error('Nightshift needs permission to write to its folder.'), { code: 'permission' });
  if (!dir.__test && !(await isThisExtension(dir))) throw new Error('The saved folder no longer matches this extension. Choose it again.');

  const fresh = await checkForUpdate({ force: true });
  const target = fresh.latest;
  if (!target?.sha) throw new Error(fresh.lastError || 'Couldn’t read the repo.');

  onProgress('Reading the repo…');
  const tree = await (await gh(st.token, `/repos/${st.repo}/git/trees/${target.sha}?recursive=1`)).json();
  const base = st.dir ? st.dir.replace(/\/+$/, '') + '/' : '';
  const files = tree.tree
    .filter((e) => e.type === 'blob' && e.path.startsWith(base))
    .map((e) => ({ path: e.path.slice(base.length), sha: e.sha }))
    .filter((e) => e.path && !SKIP.test(e.path));
  if (!files.some((f) => f.path === 'manifest.json')) throw new Error('No manifest.json in that repo folder.');

  const changed = [];
  for (const f of files) {
    const local = await readLocal(dir, f.path);
    if (!local || (await gitSha(local)) !== f.sha) changed.push(f);
  }
  const downloads = [];
  let n = 0;
  for (const f of changed) {
    onProgress(`Downloading ${++n}/${changed.length}…`);
    const blob = await (await gh(st.token, `/repos/${st.repo}/git/blobs/${f.sha}`)).json();
    const bytes = b64bytes(blob.content);
    if ((await gitSha(bytes)) !== f.sha) throw new Error(`Download of ${f.path} was corrupted. Nothing was changed.`);
    downloads.push({ path: f.path, bytes });
  }

  onProgress('Installing…');
  downloads.sort((a, b) => (a.path === 'manifest.json') - (b.path === 'manifest.json')); // manifest last
  for (const d of downloads) await writeLocal(dir, d.path, d.bytes);
  const keep = new Set(files.map((f) => f.path));
  const removed = (st.files || []).filter((p) => !keep.has(p));
  for (const p of removed) await removeLocal(dir, p);

  const { updater } = await load(['updater']);
  await save({
    updater: { ...updater, installedSha: target.sha, files: [...keep], lastInstall: Date.now(), lastError: '' },
    justUpdated: { from: currentVersion(), to: target.version, message: target.message, at: Date.now(), changed: downloads.length, removed: removed.length }
  });
  return { changed: downloads.length, removed: removed.length, version: target.version };
}

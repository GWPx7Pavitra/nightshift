// Cross-browser sync through one GitHub Gist, end-to-end encrypted.
// - nightshift.meta.json  : salt + an encrypted check value (proves the passphrase is right)
// - shared.enc.json       : prefs, links, notes, one-thing, rules (newest edit wins) + tasks (merged one by one)
// - usage-<id>.enc.json   : one per browser, last 60 days of screen time
// Writes are kept low: shared state uploads only when it actually changed, usage at most every 30 min.
//
// Or, with your own Nightshift sync server (server/server.js), sync is live: the same encrypted
// items, pushed every minute and the moment you switch browsers, and pages get a change stream.
import { load, save, usageKey, daysBack, SHARED_KEYS, syncOn } from './common.js';
export { syncOn };
import { deriveKey, newSalt, seal, unseal, sha256 } from './crypto.js';

const DESC = 'Nightshift sync (end-to-end encrypted)';
const META = 'nightshift.meta.json';
const SHARED = 'shared.enc.json';
const OLD_SHARED = 'nightshift-shared.json';
const USAGE_DAYS = 60;
const USAGE_EVERY = 30 * 60 * 1000;

async function api(token, path, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {})
    },
    cache: 'no-store'
  });
  if (!res.ok) {
    let msg = `GitHub ${res.status}`;
    try { msg += `: ${(await res.json()).message}`; } catch {}
    if (res.status === 401) msg = 'GitHub rejected the token (expired or wrong). Paste a new one in Options → Sync browsers.';
    else if (res.status === 403 || res.status === 404) msg += ' — check the token has the "gist" scope.';
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

async function rawFile(file) {
  if (!file) return null;
  if (file.truncated && file.raw_url) return (await fetch(file.raw_url, { cache: 'no-store' })).text();
  return file.content;
}

async function listGists(token) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const list = await api(token, `/gists?per_page=100&page=${page}`);
    all.push(...list);
    if (list.length < 100) break;
  }
  return all;
}

function mergeTasks(local = [], remote = []) {
  const byId = new Map();
  for (const t of [...local, ...remote]) {
    if (!t?.id) continue;
    const cur = byId.get(t.id);
    if (!cur || (t.updatedAt || 0) > (cur.updatedAt || 0)) byId.set(t.id, t);
  }
  const monthAgo = Date.now() - 30 * 86400000;
  return [...byId.values()].filter((t) => !(t.deleted && (t.updatedAt || 0) < monthAgo));
}

// Merge a remote shared object into local storage. Returns the patch that was saved.
async function applyShared(remoteShared) {
  const st = await load(['tasks', ...SHARED_KEYS, ...SHARED_KEYS.map((k) => `${k}At`)]);
  const patch = {};
  for (const k of SHARED_KEYS) {
    const r = remoteShared?.[k];
    if (r && (r.at || 0) > (st[`${k}At`] || 0)) { patch[k] = r.v; patch[`${k}At`] = r.at; }
  }
  if (remoteShared?.tasks) {
    const fresh = (await load(['tasks'])).tasks; // re-read: an edit may have landed meanwhile
    const tasks = mergeTasks(fresh, remoteShared.tasks);
    if (JSON.stringify(tasks) !== JSON.stringify(fresh)) patch.tasks = tasks;
  }
  if (Object.keys(patch).length) await save(patch);
  return patch;
}

async function sharedSnapshot() {
  const st = await load(['tasks', ...SHARED_KEYS, ...SHARED_KEYS.map((k) => `${k}At`)]);
  const out = { v: 2, tasks: st.tasks };
  for (const k of SHARED_KEYS) out[k] = { v: st[k], at: st[`${k}At`] || 0 };
  return out;
}

async function myUsage(browser) {
  const days = daysBack(USAGE_DAYS);
  const got = await chrome.storage.local.get(days.map(usageKey));
  const out = {};
  for (const d of days) if (got[usageKey(d)]) out[d] = got[usageKey(d)];
  return { label: browser.label, days: out };
}

/* ---------- connect (run from the Options page) ---------- */
export async function connect(token, passphrase) {
  if (passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
  const gists = await listGists(token);
  const existing = gists.find((g) => g.files?.[META]);
  let gistId, key, note = '';

  if (existing) {
    const g = await api(token, `/gists/${existing.id}`);
    const meta = JSON.parse(await rawFile(g.files[META]));
    key = await deriveKey(passphrase, meta.salt);
    try {
      if ((await unseal(key, meta.check)) !== 'nightshift') throw new Error();
    } catch {
      throw new Error('Wrong passphrase. Use the same one you set in your other browser.');
    }
    gistId = existing.id;
  } else {
    const salt = newSalt();
    key = await deriveKey(passphrase, salt);
    const created = await api(token, '/gists', {
      method: 'POST',
      body: JSON.stringify({ description: DESC, public: false, files: { [META]: { content: JSON.stringify({ v: 2, salt, check: await seal(key, 'nightshift') }) } } })
    });
    gistId = created.id;
  }

  // Move anything from the old unencrypted gist (Nightshift 2.0) into the encrypted one, then delete it,
  // so no plaintext copy (or its revision history) stays on GitHub.
  const old = gists.filter((g) => g.files?.[OLD_SHARED] && !g.files?.[META]);
  for (const o of old) {
    try {
      const g = await api(token, `/gists/${o.id}`);
      const files = {};
      const shared = JSON.parse((await rawFile(g.files[OLD_SHARED])) || '{}');
      await applyShared(shared);
      const { browser } = await load(['browser']);
      for (const [name, file] of Object.entries(g.files)) {
        const m = name.match(/^usage-(.+)\.json$/);
        if (!m || m[1] === browser.id) continue;
        const data = JSON.parse(await rawFile(file));
        if (data?.days) files[`usage-${m[1]}.enc.json`] = { content: await seal(key, { label: data.label, updatedAt: data.updatedAt, days: data.days }) };
      }
      if (Object.keys(files).length) await api(token, `/gists/${gistId}`, { method: 'PATCH', body: JSON.stringify({ files }) });
      await api(token, `/gists/${o.id}`, { method: 'DELETE' });
      note = 'Moved your data from the old unencrypted gist and deleted it.';
    } catch (e) {
      note = `Couldn’t remove the old unencrypted gist (${e.message}). You can delete it on gist.github.com.`;
    }
  }

  const { sync } = await load(['sync']);
  await save({ sync: { ...sync, token, gistId, key, hashes: {}, lastUsagePush: 0, lastError: '', note } });
  return { gistId, joined: !!existing, note };
}

/* ---------- regular sync (background worker) ---------- */
let running = null;
export function syncNow(force = false) {
  if (!running) running = load(['sync']).then(({ sync }) => (sync.mode === 'server' ? doServerSync(force) : doSync(force))).finally(() => (running = null));
  return running;
}

async function doSync(force) {
  const { sync, browser } = await load(['sync', 'browser']);
  if (!sync.token) return { ok: false, reason: 'off' };
  if (!sync.key || !sync.gistId) {
    const msg = 'Sync is now end-to-end encrypted: reconnect in Options → Sync browsers and set a passphrase.';
    if (sync.lastError !== msg) await save({ sync: { ...sync, lastError: msg } });
    return { ok: false, reason: msg };
  }
  try {
    const gist = await api(sync.token, `/gists/${sync.gistId}`);
    const meta = JSON.parse((await rawFile(gist.files?.[META])) || '{}');
    try {
      if ((await unseal(sync.key, meta.check)) !== 'nightshift') throw new Error();
    } catch {
      throw new Error('The passphrase changed in another browser. Reconnect here with the new one.');
    }

    // Pull
    const sharedText = await rawFile(gist.files?.[SHARED]);
    let remoteShared = null;
    if (sharedText) { remoteShared = await unseal(sync.key, sharedText); await applyShared(remoteShared); }
    const remote = {};
    for (const [name, file] of Object.entries(gist.files || {})) {
      const m = name.match(/^usage-(.+)\.enc\.json$/);
      if (!m || m[1] === browser.id) continue;
      try {
        const data = await unseal(sync.key, await rawFile(file));
        if (data?.days) remote[m[1]] = { label: data.label, updatedAt: data.updatedAt, days: data.days };
      } catch {}
    }
    await save({ remote });

    // Push only what changed
    const hashes = { ...(sync.hashes || {}) };
    const files = {};
    const snap = await sharedSnapshot();
    const snapStr = JSON.stringify(snap);
    const sharedHash = await sha256(snapStr);
    // Identical to what's already on GitHub (e.g. we just pulled it): nothing to upload.
    if (remoteShared && JSON.stringify(remoteShared) === snapStr) hashes.shared = sharedHash;
    if (sharedHash !== hashes.shared) { files[SHARED] = { content: await seal(sync.key, snap) }; hashes.shared = sharedHash; }

    const usage = await myUsage(browser);
    const usageStr = JSON.stringify(usage.days);
    const usageHash = await sha256(usageStr);
    const due = force || Date.now() - (sync.lastUsagePush || 0) >= USAGE_EVERY || !gist.files?.[`usage-${browser.id}.enc.json`];
    let lastUsagePush = sync.lastUsagePush || 0;
    if (usageHash !== hashes.usage && due) {
      files[`usage-${browser.id}.enc.json`] = { content: await seal(sync.key, { ...usage, updatedAt: Date.now() }) };
      hashes.usage = usageHash;
      lastUsagePush = Date.now();
    }
    if (Object.keys(files).length) await api(sync.token, `/gists/${sync.gistId}`, { method: 'PATCH', body: JSON.stringify({ files }) });

    const fresh = (await load(['sync'])).sync;
    await save({ sync: { ...fresh, hashes, lastUsagePush, lastSync: Date.now(), lastError: '' } });
    return { ok: true, browsers: 1 + Object.keys(remote).length, pushed: Object.keys(files).length };
  } catch (e) {
    const fresh = (await load(['sync'])).sync;
    await save({ sync: { ...fresh, lastError: String(e.message || e) } });
    return { ok: false, reason: String(e.message || e) };
  }
}

/* =====================================================================
   Own server (live)
   Items: meta, shared, hist.<browserId> (older days), live.<browserId> (today + yesterday).
   ===================================================================== */
const LIVE_DAYS = 2;

export function normalizeServerUrl(u) {
  let s = String(u || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { const x = new URL(s); return x.origin + x.pathname.replace(/\/+$/, ''); } catch { return ''; }
}

async function srv(sync, path, opts = {}) {
  let res;
  try {
    res = await fetch(`${sync.url}${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${sync.secret}`, 'X-Client': sync.client || '', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      cache: 'no-store'
    });
  } catch {
    throw new Error(`Can’t reach your sync server at ${sync.url}. Is it running?`);
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error('The sync server rejected the token. Paste the one it printed on start.');
    if (res.status === 429) throw new Error('The sync server is blocking this browser for a few minutes after wrong tokens.');
    throw new Error(`Sync server error ${res.status}`);
  }
  return res.json();
}
const putItem = (sync, name, data) => srv(sync, `/v1/items/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify({ data: typeof data === 'string' ? data : JSON.stringify(data) }) });

function splitUsage(days) {
  const live = new Set(daysBack(LIVE_DAYS));
  const hist = {}, liv = {};
  for (const [d, rec] of Object.entries(days)) (live.has(d) ? liv : hist)[d] = rec;
  return { hist, live: liv };
}

// Run from Options. Joins the server's existing encrypted space, or creates it.
export async function connectServer(url, secret, passphrase) {
  if (passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
  url = normalizeServerUrl(url);
  if (!url) throw new Error('That server address doesn’t look right.');
  const { browser, sync: prev, remote: oldRemote } = await load(['browser', 'sync', 'remote']);
  const cfg = { url, secret, client: browser.id };
  const all = await srv(cfg, '/v1/items?since=0');
  let key, joined = false;
  if (all.items.meta) {
    const meta = JSON.parse(all.items.meta.data);
    key = await deriveKey(passphrase, meta.salt);
    try { if ((await unseal(key, meta.check)) !== 'nightshift') throw new Error(); } catch { throw new Error('Wrong passphrase. Use the same one as your other browser.'); }
    joined = true;
  } else {
    const salt = newSalt();
    key = await deriveKey(passphrase, salt);
    await putItem(cfg, 'meta', { v: 3, salt, check: await seal(key, 'nightshift') });
  }
  // Bring along other browsers' history we already have from the gist, so nothing is lost.
  for (const [id, r] of Object.entries(oldRemote || {})) {
    if (id === browser.id || all.items[`hist.${id}`] || !r?.days) continue;
    await putItem(cfg, `hist.${id}`, await seal(key, { label: r.label, updatedAt: r.updatedAt, days: r.days }));
  }
  await save({ sync: { ...prev, mode: 'server', url, secret, client: browser.id, key, rev: 0, hashes: {}, lastUsagePush: 0, lastError: '', note: '' } });
  return { joined };
}

async function doServerSync(force) {
  const { sync, browser } = await load(['sync', 'browser']);
  if (!sync.url || !sync.secret) return { ok: false, reason: 'off' };
  if (!sync.key) {
    const msg = 'Set your passphrase in Options → Sync browsers.';
    if (sync.lastError !== msg) await save({ sync: { ...sync, lastError: msg } });
    return { ok: false, reason: msg };
  }
  const cfg = { ...sync, client: browser.id };
  try {
    const since = force ? 0 : sync.rev || 0;
    const got = await srv(cfg, `/v1/items?since=${since}`);
    if (got.rev < since) return doServerSync(true); // server was reset: start over
    const items = got.items || {};

    if (items.meta) {
      const meta = JSON.parse(items.meta.data);
      try { if ((await unseal(sync.key, meta.check)) !== 'nightshift') throw new Error(); } catch { throw new Error('The passphrase changed in another browser. Reconnect here with the new one.'); }
    }
    let remoteShared = null;
    if (items.shared) { remoteShared = await unseal(sync.key, items.shared.data); await applyShared(remoteShared); }

    // other browsers: hist + live parts, merged into remote[id].days
    const { remote: cur } = await load(['remote']);
    const remote = got.full ? {} : { ...(cur || {}) };
    for (const [name, it] of Object.entries(items)) {
      const m = name.match(/^(hist|live)\.(.+)$/);
      if (!m || m[2] === browser.id) continue;
      try {
        const data = await unseal(sync.key, it.data);
        const r = (remote[m[2]] ||= { label: '', updatedAt: 0, hist: {}, live: {}, days: {} });
        r[m[1]] = data.days || {};
        if (data.label) r.label = data.label;
        r.updatedAt = Math.max(r.updatedAt || 0, data.updatedAt || it.at || 0);
      } catch {}
    }
    for (const name of got.deleted || []) {
      const m = name.match(/^(hist|live)\.(.+)$/);
      if (m && remote[m[2]]) { remote[m[2]][m[1]] = {}; if (!Object.keys(remote[m[2]].hist || {}).length && !Object.keys(remote[m[2]].live || {}).length) delete remote[m[2]]; }
    }
    for (const r of Object.values(remote)) r.days = { ...(r.hist || {}), ...(r.live || {}) };
    await save({ remote });

    // push what changed
    let rev = got.rev;
    let writes = 0;
    const hashes = { ...(sync.hashes || {}) };
    const snap = await sharedSnapshot();
    const snapStr = JSON.stringify(snap);
    const sharedHash = await sha256(snapStr);
    if (remoteShared && JSON.stringify(remoteShared) === snapStr) hashes.shared = sharedHash;
    if (sharedHash !== hashes.shared || (got.full && !items.shared)) { rev = Math.max(rev, (await putItem(cfg, 'shared', await seal(sync.key, snap))).rev); writes++; hashes.shared = sharedHash; }

    const usage = await myUsage(browser);
    const parts = splitUsage(usage.days);
    for (const part of ['live', 'hist']) {
      const h = await sha256(JSON.stringify([browser.label, parts[part]]));
      const missing = got.full && !items[`${part}.${browser.id}`];
      if (h !== hashes[part] || missing) {
        rev = Math.max(rev, (await putItem(cfg, `${part}.${browser.id}`, await seal(sync.key, { label: browser.label, updatedAt: Date.now(), days: parts[part] }))).rev);
        writes++;
        hashes[part] = h;
      }
    }
    // Our own writes bump the revision; skip past them only if nobody else wrote in between.
    const fresh = (await load(['sync'])).sync;
    await save({ sync: { ...fresh, hashes, rev: rev - got.rev === writes ? rev : got.rev, lastSync: Date.now(), lastUsagePush: Date.now(), lastError: '' } });
    return { ok: true, browsers: 1 + Object.keys(remote).length };
  } catch (e) {
    const fresh = (await load(['sync'])).sync;
    await save({ sync: { ...fresh, lastError: String(e.message || e) } });
    return { ok: false, reason: String(e.message || e) };
  }
}

// Remove a browser you don't use any more (an old install, a reset profile...).
export async function forgetBrowser(id) {
  const { sync, remote } = await load(['sync', 'remote']);
  if (sync.mode === 'server') {
    for (const part of ['hist', 'live']) await srv(sync, `/v1/items/${encodeURIComponent(`${part}.${id}`)}`, { method: 'DELETE' });
  } else if (sync.token && sync.gistId) {
    await api(sync.token, `/gists/${sync.gistId}`, { method: 'PATCH', body: JSON.stringify({ files: { [`usage-${id}.enc.json`]: null } }) });
  }
  const r = { ...(remote || {}) };
  delete r[id];
  await save({ remote: r });
}

// Live change stream for pages (new tab, Screen Time). Calls onChange for other browsers' writes.
// Returns a stop function. Uses fetch streaming so the token stays in a header.
export function watchServer(sync, myId, onChange) {
  if (sync?.mode !== 'server' || !sync.url || !sync.secret) return () => {};
  let stopped = false;
  let ctrl = null;
  let delay = 1000;
  (async function loop() {
    while (!stopped) {
      try {
        ctrl = new AbortController();
        const res = await fetch(`${sync.url}/v1/events`, { headers: { Authorization: `Bearer ${sync.secret}` }, signal: ctrl.signal, cache: 'no-store' });
        if (!res.ok || !res.body) throw new Error(String(res.status));
        delay = 1000;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            const ev = /^event: (.+)$/m.exec(block)?.[1];
            const data = /^data: (.+)$/m.exec(block)?.[1];
            if (ev === 'change' && data) { try { const d = JSON.parse(data); if (d.client !== myId) onChange(d); } catch {} }
          }
        }
      } catch {}
      if (stopped) break;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(30000, delay * 2);
    }
  })();
  return () => { stopped = true; ctrl?.abort(); };
}

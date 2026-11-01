// Shared helpers for the background worker and every extension page.

export const DEFAULTS = {
  prefs: {
    name: 'Pavitra',
    engine: 'google',
    accent: 'emerald',
    background: 'aurora',
    clock24: true,
    showSeconds: false,
    badge: true,
    weather: { on: true, city: '', lat: null, lon: null, units: 'c' },
    repos: ['GWPx7Pavitra/RAVEN', 'GWPx7Pavitra/cre8ivize'],
    accentHex: '#34d399',
    look: {}
  },
  prefsAt: 0,
  links: [
    { id: 'l1', title: 'GitHub', url: 'https://github.com/GWPx7Pavitra' },
    { id: 'l2', title: 'Raven', url: 'https://raven.cre8ivize.com' },
    { id: 'l3', title: 'Panel', url: 'https://panel.cre8ivize.com' },
    { id: 'l4', title: 'Cre8ivize', url: 'https://cre8ivize.com' },
    { id: 'l5', title: 'Discord Dev', url: 'https://discord.com/developers/applications' },
    { id: 'l6', title: 'Claude', url: 'https://claude.ai' },
    { id: 'l7', title: 'Gmail', url: 'https://mail.google.com' },
    { id: 'l8', title: 'YouTube', url: 'https://www.youtube.com' }
  ],
  linksAt: 0,
  tasks: [],
  notes: '',
  notesAt: 0,
  one: { text: '', day: '', done: false },
  oneAt: 0,
  rules: { categories: {}, limits: { 'youtube.com': 60, 'instagram.com': 30 } },
  rulesAt: 0,
  monitors: [
    { name: 'Raven dashboard', url: 'https://raven.cre8ivize.com/healthz' },
    { name: 'Cre8ivize', url: 'https://cre8ivize.com' },
    { name: 'Pelican panel', url: 'https://panel.cre8ivize.com' }
  ],
  tracking: { enabled: true, idleSec: 60, countAudible: true, excluded: [] },
  sync: { token: '', gistId: '', key: '', lastSync: 0, lastUsagePush: 0, hashes: {}, lastError: '', note: '' },
  github: { token: '' },
  // Self-update from a private GitHub repo (per device, never synced).
  updater: { repo: 'GWPx7Pavitra/nightshift', branch: 'main', dir: '', auto: true, lastCheck: 0, latest: null, installedSha: '', files: [], lastError: '' },
  browser: { id: '', label: '', labelAuto: true },
  remote: {}
};

// Is sync set up? (own server, or GitHub Gist)
export const syncOn = (sync) => (sync?.mode === 'server' ? !!(sync.url && sync.secret) : !!sync?.token);

// Keys that travel between browsers through sync.
export const SHARED_KEYS = ['prefs', 'links', 'notes', 'one', 'rules'];

export async function load(keys = Object.keys(DEFAULTS)) {
  const got = await chrome.storage.local.get(keys);
  const out = {};
  for (const k of keys) {
    const def = DEFAULTS[k];
    const v = got[k];
    if (v === undefined) out[k] = structuredClone(def);
    else if (def && typeof def === 'object' && !Array.isArray(def) && v && typeof v === 'object' && !Array.isArray(v)) out[k] = { ...structuredClone(def), ...v };
    else out[k] = v;
  }
  return out;
}

export const save = (obj) => chrome.storage.local.set(obj);

// Save something that syncs, stamping when it changed so the newest edit wins.
export async function saveShared(key, value) {
  await save({ [key]: value, [`${key}At`]: Date.now() });
  chrome.runtime.sendMessage({ type: 'sync:soon' }).catch(() => {});
}

export async function saveTasks(tasks) {
  await save({ tasks });
  chrome.runtime.sendMessage({ type: 'sync:soon' }).catch(() => {});
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

/* ---------- dates & formatting ---------- */
export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function daysBack(n, from = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(from);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    out.push(dayKey(d));
  }
  return out;
}
export function fmtDur(sec, { short = false } = {}) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return short ? `${sec}s` : `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const hr = Math.floor(m / 60);
  const rm = m % 60;
  return rm && !short ? `${hr}h ${rm}m` : `${hr}h`;
}
export function badgeText(sec) {
  const m = Math.floor(sec / 60);
  if (m < 1) return '';
  if (m < 60) return `${m}m`;
  const hr = m / 60;
  return hr < 10 ? `${hr.toFixed(1).replace(/\.0$/, '')}h` : `${Math.round(hr)}h`;
}

/* ---------- domains ---------- */
export function domainOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}
export function normalizeDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').replace(/:\d+$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) || s === 'localhost' ? s : '';
}
export function isExcluded(domain, excluded) {
  return excluded.some((x) => domain === x || domain.endsWith('.' + x));
}
export function favicon(pageUrl, size = 32) {
  return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`);
}
export function toUrl(s) {
  s = String(s || '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = (/^(localhost|127\.)/.test(s) ? 'http://' : 'https://') + s;
  try { return new URL(s).href; } catch { return ''; }
}

/* ---------- browser identity ---------- */
export async function detectBrowserLabel() {
  try {
    if (navigator.brave && (await navigator.brave.isBrave())) return 'Brave';
  } catch {}
  const brands = (navigator.userAgentData?.brands || []).map((b) => b.brand);
  if (brands.includes('Brave')) return 'Brave';
  if (brands.includes('Microsoft Edge')) return 'Edge';
  if (brands.includes('Opera') || brands.includes('Opera GX')) return 'Opera';
  if (brands.includes('Google Chrome')) return 'Chrome';
  return 'Chromium';
}

export async function ensureBrowserIdentity() {
  const { browser } = await load(['browser']);
  let changed = false;
  if (!browser.id) { browser.id = uid(); changed = true; }
  if (browser.labelAuto !== false) {
    const label = await detectBrowserLabel();
    if (label !== browser.label) { browser.label = label; changed = true; }
  }
  if (changed) await save({ browser });
  return browser;
}

/* ---------- usage data ----------
   Per browser, per day: chrome.storage.local["u:YYYY-MM-DD"] = { d: { domain: seconds }, h: [24 x seconds], p: { 'github.com': { 'owner/repo': s } }, b: { domain: seconds } }
   `b` is the background lane: Background-category tabs playing audio while something else had your attention.
   Other browsers' days arrive through sync into `remote[browserId] = { label, updatedAt, days: { date: {d,h} } }` */
export const usageKey = (day) => `u:${day}`;

export async function localDays(days) {
  const got = await chrome.storage.local.get(days.map(usageKey));
  const out = {};
  for (const d of days) out[d] = got[usageKey(d)] || null;
  return out;
}

// Returns { browsers: [{id,label,mine}], perBrowser: {id: {day: {d,h}}} } for the given days.
export async function usageFor(days) {
  const { browser, remote } = await load(['browser', 'remote']);
  const mine = await localDays(days);
  const perBrowser = { [browser.id]: mine };
  const browsers = [{ id: browser.id, label: browser.label || 'This browser', mine: true }];
  for (const [id, r] of Object.entries(remote || {})) {
    if (id === browser.id || !r?.days) continue;
    const sub = {};
    for (const d of days) sub[d] = r.days[d] || null;
    perBrowser[id] = sub;
    browsers.push({ id, label: r.label || 'Other browser', mine: false, updatedAt: r.updatedAt });
  }
  // Same label twice (e.g. two Chrome profiles)? Number them.
  const seen = {};
  for (const b of browsers) { seen[b.label] = (seen[b.label] || 0) + 1; if (seen[b.label] > 1) b.label += ` ${seen[b.label]}`; }
  return { browsers, perBrowser };
}

// Aggregate usage across a set of browser ids.
export function aggregate(usage, days, ids = Object.keys(usage.perBrowser)) {
  const sites = {};
  const siteByBrowser = {};
  const paths = {};
  const perDay = {};
  const perDayByBrowser = {};
  const hours = new Array(24).fill(0);
  const bgSites = {};
  let total = 0;
  for (const day of days) {
    perDay[day] = 0;
    perDayByBrowser[day] = {};
    for (const id of ids) {
      const rec = usage.perBrowser[id]?.[day];
      if (!rec) continue;
      let dayTotal = 0;
      for (const [dom, s] of Object.entries(rec.d || {})) {
        sites[dom] = (sites[dom] || 0) + s;
        (siteByBrowser[dom] ||= {})[id] = (siteByBrowser[dom]?.[id] || 0) + s;
        dayTotal += s;
      }
      for (const [dom, subs] of Object.entries(rec.p || {})) {
        const t = (paths[dom] ||= {});
        for (const [sub, s] of Object.entries(subs)) t[sub] = (t[sub] || 0) + s;
      }
      for (const [dom, s] of Object.entries(rec.b || {})) bgSites[dom] = (bgSites[dom] || 0) + s;
      (rec.h || []).forEach((s, i) => (hours[i] += s || 0));
      perDay[day] += dayTotal;
      perDayByBrowser[day][id] = dayTotal;
      total += dayTotal;
    }
  }
  const ranked = Object.entries(sites).sort((a, b) => b[1] - a[1]).map(([domain, sec]) => ({ domain, sec, by: siteByBrowser[domain] }));
  const bgRanked = Object.entries(bgSites).sort((a, b) => b[1] - a[1]).map(([domain, sec]) => ({ domain, sec }));
  // `background`: time a Background-category tab (YT Music...) played behind whatever you were doing.
  // It's not part of `total`, which only counts what you were actually looking at.
  return { total, sites: ranked, perDay, perDayByBrowser, hours, paths, background: { total: bgRanked.reduce((a, s) => a + s.sec, 0), sites: bgRanked } };
}

/* ---------- categories ---------- */
// Built-in categories, plus your own (rules.customCats = [{ id, label, color, productive }], synced).
// CATEGORIES / CAT_ORDER / PRODUCTIVE are live: ensureCategories(rules) refreshes them, and
// categoryOf / byCategory call it for you.
const BASE_CATS = {
  build: { label: 'Building', color: 'var(--cat-build)', productive: true, hint: 'coding, docs, AI, your servers' },
  study: { label: 'Study', color: 'var(--cat-study)', productive: true, hint: 'courses, notes, reading, research' },
  bg: { label: 'Background', color: 'var(--cat-bg)', productive: true, hint: 'music and dashboards running while you work' },
  social: { label: 'Social', color: 'var(--cat-social)', productive: false },
  fun: { label: 'Entertainment', color: 'var(--cat-fun)', productive: false },
  other: { label: 'Other', color: 'var(--cat-other)', productive: false }
};
export const BASE_ORDER = ['build', 'study', 'bg', 'social', 'fun', 'other'];
export const CATEGORIES = structuredClone(BASE_CATS);
export const CAT_ORDER = [...BASE_ORDER];
export const PRODUCTIVE = new Set(['build', 'study', 'bg']);
export const CAT_COLORS = ['#22d3ee', '#a3e635', '#f97316', '#e879f9', '#facc15', '#2dd4bf', '#fb7185', '#94a3b8'];
let catSig = '[]';
export function ensureCategories(rules) {
  const list = Array.isArray(rules?.customCats) ? rules.customCats.filter((c) => c?.id && c.label) : [];
  const sig = JSON.stringify(list);
  if (sig === catSig) return;
  catSig = sig;
  for (const k of Object.keys(CATEGORIES)) if (!BASE_CATS[k]) delete CATEGORIES[k];
  Object.assign(CATEGORIES, structuredClone(BASE_CATS));
  CAT_ORDER.length = 0;
  CAT_ORDER.push(...BASE_ORDER.slice(0, -1), ...list.map((c) => c.id), 'other'); // "Other" stays last
  PRODUCTIVE.clear();
  for (const c of list) CATEGORIES[c.id] = { label: c.label, color: /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#94a3b8', productive: !!c.productive, custom: true };
  for (const [k, v] of Object.entries(CATEGORIES)) if (v.productive) PRODUCTIVE.add(k);
}
const BUILT_IN = {
  // Checked first: specific hosts that would otherwise fall under youtube.com / cre8ivize.com.
  bg: ['music.youtube.com', 'raven.cre8ivize.com'],
  study: ['coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org', 'brilliant.org', 'duolingo.com', 'quizlet.com', 'ankiweb.net', 'scholar.google.com',
    'classroom.google.com', 'wikipedia.org', 'wolframalpha.com', 'desmos.com', 'geogebra.org', 'arxiv.org', 'researchgate.net', 'overleaf.com', 'nptel.ac.in',
    'swayam.gov.in', 'ocw.mit.edu', 'mit.edu', 'freecodecamp.org', 'codecademy.com', 'theodinproject.com', 'cs50.harvard.edu', 'notebooklm.google.com',
    'libretexts.org', 'openstax.org', 'britannica.com', 'chegg.com', 'studocu.com', 'scribd.com'],
  build: ['github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com', 'stackexchange.com', 'claude.ai', 'anthropic.com', 'chatgpt.com', 'openai.com', 'gemini.google.com',
    'developer.mozilla.org', 'pypi.org', 'python.org', 'npmjs.com', 'svelte.dev', 'vercel.com', 'netlify.com', 'pycord.dev', 'tailwindcss.com', 'nextjs.org', 'react.dev',
    'cre8ivize.com', 'localhost', '127.0.0.1', 'figma.com', 'notion.so', 'linear.app', 'cloudflare.com', 'supabase.com', 'railway.app', 'render.com', 'docker.com',
    'codepen.io', 'replit.com', 'leetcode.com', 'w3schools.com', 'geeksforgeeks.org', 'lavalink.dev', 'pelican.dev', 'gist.github.com', 'discord.dev'],
  social: ['instagram.com', 'discord.com', 'x.com', 'twitter.com', 'reddit.com', 'facebook.com', 'whatsapp.com', 'snapchat.com', 'linkedin.com', 'threads.net',
    'telegram.org', 'pinterest.com', 'tiktok.com', 'quora.com', 'tumblr.com', 'messenger.com'],
  fun: ['youtube.com', 'netflix.com', 'primevideo.com', 'hotstar.com', 'jiocinema.com', 'twitch.tv', 'spotify.com', 'crunchyroll.com', '9gag.com', 'steampowered.com',
    'epicgames.com', 'chess.com', 'soundcloud.com', 'kick.com', 'disneyplus.com', 'hulu.com', 'zee5.com', 'sonyliv.com']
};
export const matchesDomain = (domain, rule) => domain === rule || domain.endsWith('.' + rule);
export function categoryOf(domain, rules) {
  ensureCategories(rules);
  const over = rules?.categories || {};
  let best = null;
  for (const [d, cat] of Object.entries(over)) if (matchesDomain(domain, d) && (!best || d.length > best[0].length)) best = [d, cat];
  if (best && CATEGORIES[best[1]]) return best[1];
  if (BUILT_IN.bg.some((r) => matchesDomain(domain, r))) return 'bg';
  if (/^(docs|developer|developers|dev|api)\./.test(domain)) return 'build';
  for (const cat of ['study', 'build', 'social', 'fun']) if (BUILT_IN[cat].some((r) => matchesDomain(domain, r))) return cat;
  return 'other';
}
// Totals per category, overall and per day.
export function byCategory(usage, days, ids, rules) {
  ensureCategories(rules);
  const total = Object.fromEntries(CAT_ORDER.map((c) => [c, 0]));
  const perDay = {};
  for (const day of days) {
    perDay[day] = Object.fromEntries(CAT_ORDER.map((c) => [c, 0]));
    for (const id of ids) {
      const rec = usage.perBrowser[id]?.[day];
      for (const [dom, s] of Object.entries(rec?.d || {})) {
        const c = categoryOf(dom, rules);
        total[c] += s;
        perDay[day][c] += s;
      }
    }
  }
  return { total, perDay };
}
// Seconds spent today (all browsers) on sites matching a limit rule.
// A limit on youtube.com shouldn't count YT Music once that's a Background site.
export function limitApplies(domain, rule, rules) {
  if (!matchesDomain(domain, rule)) return false;
  return domain === rule || categoryOf(domain, rules) !== 'bg' || categoryOf(rule, rules) === 'bg';
}
export function limitUsage(todayAgg, rule, rules) {
  return todayAgg.sites.filter((s) => limitApplies(s.domain, rule, rules)).reduce((a, s) => a + s.sec, 0);
}

/* ---------- GitHub repo paths ---------- */
const GH_RESERVED = new Set(['settings', 'notifications', 'orgs', 'marketplace', 'explore', 'topics', 'search', 'login', 'logout', 'sessions', 'pulls', 'issues',
  'codespaces', 'sponsors', 'features', 'about', 'pricing', 'new', 'account', 'apps', 'users', 'organizations', 'dashboard', 'trending', 'collections', 'events',
  'stars', 'watching', 'enterprise', 'team', 'customer-stories', 'security', 'readme', 'copilot', 'signup', 'join', 'contact', 'site', 'git-guides', 'github-copilot']);
export function subPathOf(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host !== 'github.com') return '';
    const [owner, repo] = u.pathname.split('/').filter(Boolean);
    if (!owner || !repo || GH_RESERVED.has(owner.toLowerCase())) return '';
    return `${owner}/${repo}`.toLowerCase();
  } catch { return ''; }
}

/* ---------- site icons with a real fallback ----------
   Chrome's favicon cache hands back a generic globe for sites it has never seen (e.g. ones only
   visited in your other browser). Detect that and show a coloured letter tile instead. */
const iconCache = new Map();
const globeSig = new Map();
async function sig(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const b = new Uint8Array(buf);
  let hsh = 0;
  for (let i = 0; i < b.length; i += 7) hsh = (hsh * 31 + b[i]) | 0;
  return `${b.length}:${hsh}`;
}
async function realIcon(pageUrl, size) {
  const key = `${pageUrl}|${size}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const p = (async () => {
    try {
      if (!globeSig.has(size)) globeSig.set(size, sig(favicon('https://nightshift-no-such-site.invalid/', size)));
      const url = favicon(pageUrl, size);
      return (await sig(url)) === (await globeSig.get(size)) ? null : url;
    } catch { return null; }
  })();
  iconCache.set(key, p);
  return p;
}
export function siteIcon(pageUrl, { size = 32, cls = 'fav', label = '' } = {}) {
  let host = '';
  try { host = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch {}
  const name = label || host || '?';
  let hue = 0;
  for (const ch of host || name) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  const tile = h('span', { class: `${cls} letter-tile`, style: `--hue:${hue}`, 'aria-hidden': 'true' }, name.replace(/^(https?:\/\/)?(www\.)?/, '')[0]?.toUpperCase() || '?');
  realIcon(pageUrl, size).then((url) => {
    if (!url || !tile.parentNode) return;
    tile.replaceWith(h('img', { class: cls, src: url, alt: '' }));
  });
  return tile;
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
export function ago(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
export function weekStart(d = new Date()) {
  const x = new Date(d); x.setHours(12, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
export function dayRange(from, n) {
  const out = [];
  for (let i = 0; i < n; i++) { const d = new Date(from); d.setDate(d.getDate() + i); out.push(dayKey(d)); }
  return out;
}
// This week (Mon..today) against the same weekdays last week.
export async function weeklyRecap(rules) {
  const start = weekStart();
  const n = ((new Date().getDay() + 6) % 7) + 1;
  const thisDays = dayRange(start, n);
  const lastStart = new Date(start); lastStart.setDate(lastStart.getDate() - 7);
  const lastDays = dayRange(lastStart, n);
  const usage = await usageFor([...lastDays, ...thisDays]);
  const ids = Object.keys(usage.perBrowser);
  const now = aggregate(usage, thisDays, ids);
  const prev = aggregate(usage, lastDays, ids);
  const cats = byCategory(usage, thisDays, ids, rules).total;
  const prevBy = Object.fromEntries(prev.sites.map((s) => [s.domain, s.sec]));
  let mover = null;
  for (const s of now.sites) {
    const diff = s.sec - (prevBy[s.domain] || 0);
    if (!mover || Math.abs(diff) > Math.abs(mover.diff)) mover = { domain: s.domain, diff };
  }
  for (const [dom, sec] of Object.entries(prevBy)) if (!now.sites.find((s) => s.domain === dom) && (!mover || sec > Math.abs(mover.diff))) mover = { domain: dom, diff: -sec };
  const busiest = thisDays.reduce((a, d) => (now.perDay[d] > (now.perDay[a] || 0) ? d : a), thisDays[0]);
  return { days: n, total: now.total, prevTotal: prev.total, top: now.sites[0], mover, busiest, busiestSec: now.perDay[busiest] || 0, cats };
}

export const BROWSER_COLORS = ['var(--b1)', 'var(--b2)', 'var(--b3)', 'var(--b4)'];

export function notifyBackground(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra }).catch(() => null);
}

/* ---------- DOM helper for pages ---------- */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
  return el;
}
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------- look (the customiser) ---------- */
export const FONTS = {
  geist: { label: 'Geist', family: '"Geist"' },
  inter: { label: 'Inter', family: '"Inter"' },
  manrope: { label: 'Manrope', family: '"Manrope"' },
  grotesk: { label: 'Space Grotesk', family: '"Space Grotesk"' },
  outfit: { label: 'Outfit', family: '"Outfit"' },
  bricolage: { label: 'Bricolage', family: '"Bricolage Grotesque"' },
  mono: { label: 'Geist Mono', family: '"Geist Mono"' },
  jetbrains: { label: 'JetBrains Mono', family: '"JetBrains Mono"' },
  serif: { label: 'Instrument Serif', family: '"Instrument Serif"', italic: true },
  fraunces: { label: 'Fraunces', family: '"Fraunces"' },
  playfair: { label: 'Playfair', family: '"Playfair Display"' },
  syne: { label: 'Syne', family: '"Syne"' },
  unbounded: { label: 'Unbounded', family: '"Unbounded"' }
};
export const UI_FONTS = ['geist', 'inter', 'manrope', 'grotesk', 'outfit', 'bricolage', 'jetbrains'];
export const CLOCK_FONTS = ['geist', 'inter', 'grotesk', 'outfit', 'bricolage', 'mono', 'jetbrains', 'serif', 'fraunces', 'playfair', 'syne', 'unbounded'];
export const CLOCK_STYLES = {
  roll: 'Rolling', flip: 'Flip', fade: 'Soft fade', stack: 'Stacked', analog: 'Analog', words: 'In words'
};
export const WIDGETS = {
  search: 'Search', pages: 'Important pages', weather: 'Weather', greeting: 'Greeting', status: 'Sync & server chips',
  screen: 'Screen time', one: 'The one thing', todo: 'To-do', dev: 'Dev', week: 'This week', notes: 'Notes'
};
export const LOOK = {
  uiFont: 'geist',
  clockFont: 'geist',
  clockStyle: 'roll',
  clockWeight: 200,
  clockSize: 1,
  clockColor: 'solid',     // solid | accent | gradient | outline | glow
  showDate: true,
  layout: 'dashboard',     // dashboard | focus | zen
  density: 'comfy',        // comfy | compact
  glass: 55,               // card opacity %
  blur: 24,                // card blur px
  radius: 22,              // card corner px
  dim: 0,                  // extra darkening of the background %
  grain: true,
  motion: 'full',          // full | calm | off
  widgets: Object.fromEntries(Object.keys(WIDGETS).map((k) => [k, true]))
};
export function lookOf(prefs) {
  const l = prefs?.look || {};
  return { ...LOOK, ...l, widgets: { ...LOOK.widgets, ...(l.widgets || {}) } };
}

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0, sat = 0;
  const lig = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = lig > 0.5 ? d / (2 - max - min) : d / (max + min);
    hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue *= 60;
  }
  return [Math.round(hue), Math.round(sat * 100), Math.round(lig * 100)];
}

// Applies accent, fonts, glass, radius, motion... to the page. Every page calls this.
export function applyAccent(prefs) {
  const root = document.documentElement;
  const look = lookOf(prefs);
  root.dataset.accent = prefs?.accent || 'emerald';
  const st = root.style;
  if (prefs?.accent === 'custom') {
    const hsl = hexToHsl(prefs.accentHex) || [158, 64, 52];
    const [hu, sa, li] = hsl;
    const L = Math.max(55, Math.min(78, li));
    st.setProperty('--accent', `hsl(${hu} ${sa}% ${L}%)`);
    st.setProperty('--accent-2', `hsl(${(hu + 42) % 360} ${Math.min(90, sa + 6)}% ${Math.min(75, L + 4)}%)`);
    st.setProperty('--accent-ink', `hsl(${hu} ${Math.min(80, sa)}% 10%)`);
    st.setProperty('--accent-soft', `hsl(${hu} ${sa}% ${L}% / .16)`);
  } else for (const k of ['--accent', '--accent-2', '--accent-ink', '--accent-soft']) st.removeProperty(k);
  const ui = FONTS[look.uiFont] || FONTS.geist;
  const ck = FONTS[look.clockFont] || FONTS.geist;
  st.setProperty('--sans', `${ui.family}, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`);
  st.setProperty('--clock-font', `${ck.family}, ui-sans-serif, system-ui, sans-serif`);
  st.setProperty('--clock-style', ck.italic ? 'italic' : 'normal');
  st.setProperty('--clock-weight', String(look.clockWeight));
  st.setProperty('--clock-scale', String(look.clockSize));
  st.setProperty('--glass', String(look.glass / 100));
  st.setProperty('--blur', `${look.blur}px`);
  st.setProperty('--r', `${look.radius}px`);
  st.setProperty('--bg-dim', String(look.dim / 100));
  root.dataset.motion = reducedMotion() ? 'off' : look.motion;
  root.dataset.density = look.density;
  root.dataset.grain = look.grain ? 'on' : 'off';
  return look;
}
export const applyLook = applyAccent;

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Animated number count-up for durations.
export function countUp(el, toSec, { duration = 900, format = (s) => fmtDur(s) } = {}) {
  const from = Number(el.dataset.val || 0);
  el.dataset.val = String(toSec);
  if (reducedMotion() || from === toSec) { el.textContent = format(toSec); return; }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / duration);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = format(from + (toSec - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), 1800);
  setTimeout(() => t.remove(), 2200);
}

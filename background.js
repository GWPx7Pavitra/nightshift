import {
  DEFAULTS, load, save, dayKey, usageKey, domainOf, subPathOf, isExcluded, badgeText, ensureBrowserIdentity, uid, toUrl, saveShared,
  usageFor, aggregate, limitUsage, limitApplies, matchesDomain, weeklyRecap, weekStart, fmtDur, CATEGORIES, categoryOf
} from './lib/common.js';
import { checkForUpdate } from './lib/updater.js';

const UPDATE = 'nightshift-update';
import { syncNow } from './lib/sync.js';
const isLive = async () => (await chrome.storage.local.get('sync')).sync?.mode === 'server';

const TICK = 'nightshift-tick';
const SYNC = 'nightshift-sync';
const MAX_SEGMENT_MS = 2.5 * 60 * 1000; // longer gaps mean the machine slept; don't count them
const KEEP_DAYS = 120;

/* ---------- lifecycle ---------- */
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const cur = await chrome.storage.local.get(null);
  const patch = {};
  for (const [k, v] of Object.entries(DEFAULTS)) if (cur[k] === undefined) patch[k] = v;

  // Upgrade from 1.x: keep name / search / accent / links / notes / tasks, drop the rest.
  if (reason === 'update' && cur.settings) {
    const s = cur.settings;
    patch.prefs = { ...DEFAULTS.prefs, ...(cur.prefs || {}), name: s.name ?? DEFAULTS.prefs.name, engine: s.engine || 'google', accent: s.accent || 'emerald' };
    if (Array.isArray(cur.links)) patch.links = cur.links.map((l) => ({ id: l.id || uid(), title: l.title, url: l.url }));
    if (Array.isArray(cur.tasks)) patch.tasks = cur.tasks.map((t) => ({ id: t.id || uid(), text: t.text, done: !!t.done, createdAt: t.created || Date.now(), updatedAt: Date.now() }));
  }
  if (Object.keys(patch).length) await save(patch);
  await chrome.storage.local.remove(['settings', 'timer', 'stats', 'exams', 'monitorCache']);

  await ensureBrowserIdentity();
  await setup();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'add-link', title: 'Add to Nightshift important pages', contexts: ['page', 'link'] });
    chrome.contextMenus.create({ id: 'open-st', title: 'Open Screen Time', contexts: ['action'] });
  });
  if (reason === 'install') chrome.tabs.create({ url: 'options.html#welcome' });

  // Just updated itself from the repo? Reopen the page the update was started from.
  if (reason === 'update') {
    const { justUpdated } = await chrome.storage.local.get('justUpdated');
    if (justUpdated?.reopen) {
      chrome.tabs.create({ url: justUpdated.reopen });
      await chrome.storage.local.set({ justUpdated: { ...justUpdated, reopen: '' } });
    }
  }
  checkForUpdate({ force: true });
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureBrowserIdentity();
  await setup();
  syncNow();
});

async function setup() {
  const { tracking } = await load(['tracking']);
  chrome.idle.setDetectionInterval(Math.max(15, tracking.idleSec || 60));
  if (!(await chrome.alarms.get(TICK))) chrome.alarms.create(TICK, { periodInMinutes: 1 });
  if (!(await chrome.alarms.get(SYNC))) chrome.alarms.create(SYNC, { periodInMinutes: 10 });
  if (!(await chrome.alarms.get(UPDATE))) chrome.alarms.create(UPDATE, { periodInMinutes: 180, delayInMinutes: 1 });
  queue(() => track('setup'));
}

/* ---------- time tracking ----------
   One "current segment" lives in storage.session: { domain, sub, since }.
   Every event flushes the elapsed time to that domain, then works out what's active now. */
let chain = Promise.resolve();
const queue = (fn) => (chain = chain.then(fn).catch((e) => console.warn('[nightshift]', e)));

// What has your attention right now: { tab, watching } where watching=false means it only
// counts because it's playing audio while you're idle or in another app.
async function currentTab(tracking) {
  if (!tracking.enabled) return null;
  const idle = await chrome.idle.queryState(Math.max(15, tracking.idleSec || 60));
  if (idle === 'locked') return null;
  let tab = null;
  try {
    const win = await chrome.windows.getLastFocused({ populate: false });
    if (win?.focused) [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  } catch {}
  if (tab && idle === 'active') return { tab, watching: true };
  if (tab && tab.audible && tracking.countAudible) return { tab, watching: false };
  if (tracking.countAudible) {
    const [audible] = await chrome.tabs.query({ audible: true });
    if (audible) return { tab: audible, watching: false };
  }
  return null;
}

// A Background-category tab (YT Music, the Raven dashboard...) playing audio that isn't the main tab.
async function backgroundTab(tracking, rules, mainId) {
  if (!tracking.enabled) return null;
  if ((await chrome.idle.queryState(Math.max(15, tracking.idleSec || 60))) === 'locked') return null;
  const tabs = await chrome.tabs.query({ audible: true });
  return tabs.find((t) => {
    if (t.id === mainId) return false;
    const d = domainOf(t.url || '');
    return d && !isExcluded(d, tracking.excluded || []) && categoryOf(d, rules) === 'bg';
  }) || null;
}

async function addTime(domain, sub, from, to, lane = 'd') {
  if (to - from > MAX_SEGMENT_MS) to = from + MAX_SEGMENT_MS;
  const writes = {};
  let t = from;
  const r1 = (n) => Math.round(n * 10) / 10;
  while (t < to) {
    const d = new Date(t);
    const nextHour = new Date(d); nextHour.setMinutes(60, 0, 0);
    const end = Math.min(to, nextHour.getTime());
    const key = usageKey(dayKey(d));
    if (!writes[key]) writes[key] = (await chrome.storage.local.get(key))[key] || { d: {}, h: new Array(24).fill(0) };
    const sec = (end - t) / 1000;
    const rec = writes[key];
    if (lane === 'b') {
      rec.b ||= {};
      rec.b[domain] = r1((rec.b[domain] || 0) + sec);
    } else {
      rec.d[domain] = r1((rec.d[domain] || 0) + sec);
      rec.h[d.getHours()] = r1((rec.h[d.getHours()] || 0) + sec);
      if (sub) {
        rec.p ||= {};
        rec.p[domain] ||= {};
        rec.p[domain][sub] = r1((rec.p[domain][sub] || 0) + sec);
      }
    }
    t = end;
  }
  await chrome.storage.local.set(writes);
}

async function track() {
  const now = Date.now();
  const { tracking, prefs, rules } = await load(['tracking', 'prefs', 'rules']);
  const { cur, bgcur } = await chrome.storage.session.get(['cur', 'bgcur']);
  if (cur?.domain && cur.since && now > cur.since) await addTime(cur.domain, cur.sub || '', cur.since, now);
  if (bgcur?.domain && bgcur.since && now > bgcur.since) await addTime(bgcur.domain, '', bgcur.since, now, 'b');

  const hit = await currentTab(tracking);
  let tab = hit?.tab || null;
  let domain = tab ? domainOf(tab.url || '') : '';
  if (domain && isExcluded(domain, tracking.excluded || [])) domain = '';
  // Music you're not looking at isn't screen time: it goes to the background lane instead.
  if (domain && !hit.watching && categoryOf(domain, rules) === 'bg') { domain = ''; tab = null; }
  const sub = domain ? subPathOf(tab.url || '') : '';
  const bgTab = await backgroundTab(tracking, rules, domain ? tab.id : null);
  const bgDomain = bgTab ? domainOf(bgTab.url || '') : '';
  await chrome.storage.session.set({
    cur: domain ? { domain, sub, since: now } : null,
    bgcur: bgDomain ? { domain: bgDomain, since: now } : null
  });
  await afterTrack(domain, prefs, rules);
}

/* ---------- badge + daily limits ---------- */
async function afterTrack(domain, prefs, rules) {
  if (!domain) { await chrome.action.setBadgeText({ text: '' }); await chrome.action.setTitle({ title: 'Nightshift' }); return; }
  const today = dayKey();
  const agg = aggregate(await usageFor([today]), [today]);
  const sec = agg.sites.find((s) => s.domain === domain)?.sec || 0;

  let over = null;
  for (const [rule, mins] of Object.entries(rules.limits || {})) {
    if (!mins || !limitApplies(domain, rule, rules)) continue;
    const used = limitUsage(agg, rule, rules);
    if (used >= mins * 60) over = { rule, mins, used };
  }

  if (prefs.badge) {
    await chrome.action.setBadgeBackgroundColor({ color: over ? '#dc2626' : '#18181b' });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#fafafa' });
    await chrome.action.setBadgeText({ text: badgeText(over ? over.used : sec) });
  } else await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setTitle({ title: over ? `Nightshift — over your ${fmtDur(over.mins * 60)} limit on ${over.rule}` : `Nightshift — ${domain}: ${Math.floor(sec / 60)} min today` });

  if (over) {
    const { limitNotes } = await chrome.storage.local.get('limitNotes');
    const notes = limitNotes?.day === today ? limitNotes : { day: today, sent: [] };
    if (!notes.sent.includes(over.rule)) {
      notes.sent.push(over.rule);
      await chrome.storage.local.set({ limitNotes: notes });
      notify(`limit:${over.rule}`, `Daily limit reached: ${over.rule}`, `You've spent ${fmtDur(over.used)} here today (limit ${fmtDur(over.mins * 60)}). Nothing's blocked — just a heads-up.`);
    }
  }
}

function notify(id, title, message) {
  chrome.notifications.create(id, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/128.png'), title, message, priority: 1 });
}

/* ---------- weekly recap (Sunday evening) ---------- */
async function maybeRecap() {
  const now = new Date();
  if (now.getDay() !== 0 || now.getHours() < 19) return;
  const wk = dayKey(weekStart(now));
  const { recapSent } = await chrome.storage.local.get('recapSent');
  if (recapSent === wk) return;
  await chrome.storage.local.set({ recapSent: wk });
  const { rules } = await load(['rules']);
  const r = await weeklyRecap(rules);
  if (!r.total) return;
  const pct = r.prevTotal ? Math.round(((r.total - r.prevTotal) / r.prevTotal) * 100) : null;
  const topCat = Object.entries(r.cats).sort((a, b) => b[1] - a[1])[0];
  const lines = [
    `${fmtDur(r.total)} online${pct != null ? ` (${pct > 0 ? '▲' : '▼'}${Math.abs(pct)}% vs last week)` : ''}`,
    r.top ? `Top: ${r.top.domain} · ${fmtDur(r.top.sec)}` : '',
    topCat ? `Mostly ${CATEGORIES[topCat[0]].label.toLowerCase()} (${fmtDur(topCat[1])})` : '',
    r.mover && Math.abs(r.mover.diff) > 900 ? `Biggest change: ${r.mover.domain} ${r.mover.diff > 0 ? '+' : '−'}${fmtDur(Math.abs(r.mover.diff))}` : ''
  ].filter(Boolean);
  notify('recap', 'Your week in the browser', lines.join('\n'));
}

async function prune() {
  const all = await chrome.storage.local.get(null);
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
  const old = Object.keys(all).filter((k) => k.startsWith('u:') && k.slice(2) < dayKey(cutoff));
  if (old.length) await chrome.storage.local.remove(old);
}

const t = () => () => queue(track);
chrome.tabs.onActivated.addListener(t());
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.url || info.audible !== undefined) queue(track);
  if (info.status === 'complete') reloadIfStaged();
});
chrome.tabs.onRemoved.addListener(() => { queue(track); reloadIfStaged(); });
chrome.windows.onFocusChanged.addListener((winId) => {
  queue(track);
  // Leaving this browser (for the other one, or another app): hand the latest numbers over now.
  if (winId === chrome.windows.WINDOW_ID_NONE) { clearTimeout(leaveTimer); leaveTimer = setTimeout(async () => { if (await isLive()) queue(track).then(() => syncNow(false)); }, 1200); }
});
let leaveTimer = null;
chrome.idle.onStateChanged.addListener(t());

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === TICK) {
    queue(track).then(async () => { if (await isLive()) syncNow(false); }); // own server: push/pull every minute
    reloadIfStaged();
    queue(maybeRecap);
    if (new Date().getMinutes() === 7) queue(prune);
  }
  if (a.name === SYNC) queue(track).then(() => syncNow(false));
  if (a.name === UPDATE) checkForUpdate();
});

chrome.notifications.onClicked.addListener((id) => {
  const url = id === 'recap' ? 'insights.html#7' : 'insights.html#1';
  chrome.tabs.create({ url });
  chrome.notifications.clear(id);
});

/* ---------- staged self-update ----------
   The new tab writes an update's files quietly, then asks for a reload. Reloading closes every
   Nightshift page, so wait until none is open (you've moved on to a website). */
async function reloadIfStaged() {
  const { staged } = await chrome.storage.session.get('staged');
  if (!staged) return;
  const open = await chrome.runtime.getContexts({ contextTypes: ['TAB', 'POPUP', 'SIDE_PANEL'] });
  if (open.length) return;
  await queue(track); // flush the running segment first
  await chrome.storage.session.remove('staged');
  chrome.runtime.reload();
}

/* ---------- sync scheduling ---------- */
let soon = null;
async function syncSoon() {
  clearTimeout(soon);
  soon = setTimeout(() => syncNow(false), (await isLive()) ? 700 : 4000);
}

/* ---------- menus, commands, messages ---------- */
async function addLink(url, title) {
  const href = toUrl(url);
  if (!href) return;
  const { links } = await load(['links']);
  if (links.some((l) => l.url === href)) return;
  let name = (title || '').split(/ [-|·–—] /)[0].trim().slice(0, 24);
  if (!name) name = new URL(href).hostname.replace(/^www\./, '');
  await saveShared('links', [...links, { id: uid(), title: name, url: href }]);
  syncSoon();
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'add-link') addLink(info.linkUrl || info.pageUrl, info.linkUrl ? info.selectionText || '' : tab?.title);
  if (info.menuItemId === 'open-st') chrome.tabs.create({ url: 'insights.html' });
});

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'open-screen-time') chrome.tabs.create({ url: 'insights.html' });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.tracking) setup();
  if (changes.prefs || changes.rules) queue(track);
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const handlers = {
    'track:flush': () => queue(track).then(() => chrome.storage.session.get('cur')).then((r) => r.cur),
    'sync:now': () => queue(track).then(() => syncNow(msg.force !== false)),
    'sync:soon': () => syncSoon(),
    'sync:pull': () => syncNow(false),
    'link:add': () => addLink(msg.url, msg.title),
    'update:check': () => checkForUpdate({ force: true }),
    'update:staged': () => chrome.storage.session.set({ staged: true }).then(() => setTimeout(reloadIfStaged, 1500)),
    'update:reload': () => queue(track).then(() => setTimeout(() => chrome.runtime.reload(), 150))
  };
  const fn = handlers[msg?.type];
  if (!fn) return false;
  Promise.resolve(fn()).then((data) => reply({ ok: true, data }), (e) => reply({ ok: false, error: String(e) }));
  return true;
});

import {
  load, save, saveShared, saveTasks, uid, dayKey, daysBack, fmtDur, toUrl, h, $, $$, siteIcon, ago,
  applyAccent, countUp, usageFor, aggregate, byCategory, categoryOf, limitUsage, weeklyRecap,
  CATEGORIES, CAT_ORDER, BROWSER_COLORS, ensureBrowserIdentity, toast, notifyBackground, lookOf, ensureCategories, reducedMotion, syncOn
} from './lib/common.js';
import { icon, hydrateIcons } from './lib/icons.js';
import { createClock } from './lib/clock.js';
import { hasUpdate, folderPermission, applyUpdate, folderSupported } from './lib/updater.js';
import { watchServer } from './lib/sync.js';
import { renderBackdrop } from './lib/backdrop.js';
import { repoStatuses } from './lib/github.js';
import { getWeather } from './lib/weather.js';
import { createPalette } from './lib/palette.js';

const ENGINES = {
  google: 'https://www.google.com/search?q=',
  brave: 'https://search.brave.com/search?q=',
  ddg: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q='
};
const BANGS = {
  gh: ['GitHub', 'https://github.com/search?type=repositories&q='],
  yt: ['YouTube', 'https://www.youtube.com/results?search_query='],
  py: ['PyPI', 'https://pypi.org/search/?q='],
  npm: ['npm', 'https://www.npmjs.com/search?q='],
  mdn: ['MDN', 'https://developer.mozilla.org/en-US/search?q='],
  so: ['Stack Overflow', 'https://stackoverflow.com/search?q='],
  w: ['Wikipedia', 'https://en.wikipedia.org/w/index.php?search='],
  pc: ['Pycord docs', 'https://docs.pycord.dev/en/stable/search.html?q='],
  sv: ['Svelte docs', 'https://svelte.dev/search?q='],
  cl: ['Claude', 'https://claude.ai/new?q='],
  r: ['Reddit', 'https://www.reddit.com/search/?q='],
  img: ['Images', 'https://www.google.com/search?tbm=isch&q=']
};

let S = {};
let palette;
let clock;
let look;
const PREVIEW = new URLSearchParams(location.search).has('preview'); // inside the Options customiser

init();

// Smooth swap for look changes (fonts, layout, widgets) where the browser supports it.
function morph(fn) {
  if (!document.startViewTransition || document.documentElement.dataset.motion === 'off' || document.hidden) { fn(); return; }
  document.startViewTransition(fn);
}

function applyWidgets() {
  const w = look.widgets;
  const root = document.documentElement;
  root.dataset.layout = look.layout;
  for (const el of $$('[data-w]')) el.hidden = w[el.dataset.w] === false;
  $('#searchForm').hidden = !w.search;
  $('.pages-wrap').hidden = !w.pages;
  $('.greet').style.visibility = w.greeting ? '' : 'hidden';
  $$('.status-chip').forEach((el) => (el.style.display = w.status ? '' : 'none'));
  $('#date').hidden = !look.showDate;
  $('#todoCard').hidden = !w.one && !w.todo;
  $('#pair').hidden = !w.dev && !w.week;
  $('#grid').classList.toggle('no-side', $('#todoCard').hidden);
  $('#grid').classList.toggle('no-main', $$('.g-main > [data-w], #pair').every((el) => el.hidden));
  if (S.prefs.weather?.on && w.weather) { if ($('#weather').hidden) renderWeather(); } else $('#weather').hidden = true;
}

async function init() {
  S = await load();
  ensureCategories(S.rules);
  look = applyAccent(S.prefs);
  if (PREVIEW) document.documentElement.classList.add('preview');
  hydrateIcons();
  clock = createClock($('#clock'));
  applyWidgets();
  renderBackdrop($('#backdrop'), S.prefs).then(() => {
    const c = $('#backdrop').dataset.credit;
    if (c) $('#credit').textContent = c;
  });
  tickClock(true);
  scheduleClock();
  renderPages();
  renderOne();
  renderTodos(true);
  $('#notes').value = S.notes;
  renderSync();
  renderMonitors();
  wire();
  ensureBrowserIdentity();
  renderDev();
  showJustUpdated();
  maybeUpdate();

  await notifyBackground('track:flush');
  renderUsage();
  checkMonitors(false);
  if (!PREVIEW && syncOn(S.sync)) {
    const live = S.sync.mode === 'server';
    if (live || Date.now() - (S.sync.lastSync || 0) > 60000) notifyBackground('sync:now', { force: false });
    if (live) startLive();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [k, { newValue }] of Object.entries(changes)) S[k] = newValue;
    if (changes.prefs) {
      S.prefs = { ...S.prefs };
      const o = changes.prefs.oldValue || {};
      const n = changes.prefs.newValue || {};
      const lo = lookOf(o), ln = lookOf(n);
      const big = lo.layout !== ln.layout || JSON.stringify(lo.widgets) !== JSON.stringify(ln.widgets) || lo.clockStyle !== ln.clockStyle || lo.density !== ln.density;
      const apply = () => { look = applyAccent(S.prefs); applyWidgets(); tickClock(lo.clockStyle !== ln.clockStyle); };
      big ? morph(apply) : apply();
      if (o.background !== n.background) renderBackdrop($('#backdrop'), S.prefs);
      if (JSON.stringify(o.weather) !== JSON.stringify(n.weather)) renderWeather(true);
      if (JSON.stringify(o.repos) !== JSON.stringify(n.repos)) renderDev(true);
    }
    if (changes.bgImage) renderBackdrop($('#backdrop'), S.prefs);
    if (changes.links) renderPages();
    if (changes.tasks) renderTodos();
    if (changes.one) renderOne();
    if (changes.github) renderDev(true);
    if (changes.notes && document.activeElement !== $('#notes')) $('#notes').value = S.notes;
    if (changes.sync || changes.remote) renderSync();
    if (changes.sync && !PREVIEW) {
      const a = changes.sync.oldValue || {}, b = changes.sync.newValue || {};
      if (a.mode !== b.mode || a.url !== b.url || a.secret !== b.secret) { if (b.mode === 'server' && b.url && b.secret) startLive(); else stopLive?.(); }
    }
    if (changes.updater) renderUpdate();
    if (changes.rules) ensureCategories(S.rules);
    if (changes.remote || changes.rules || changes[`u:${dayKey()}`]) renderUsage();
    if (changes.monitors || changes.monitorCache) renderMonitors();
  });
}

/* ---------- clock ---------- */
function scheduleClock() {
  setTimeout(() => { tickClock(); scheduleClock(); }, 1000 - (Date.now() % 1000) + 5);
}
function tickClock(reset) {
  const now = new Date();
  const p = S.prefs;
  clock.render(p, look, !!reset);

  const H = now.getHours();
  $('#hello').textContent = H < 5 ? 'Up late,' : H < 12 ? 'Good morning,' : H < 17 ? 'Good afternoon,' : H < 22 ? 'Good evening,' : 'Good night,';
  $('#name').textContent = p.name || '';
  $('#date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const late = H >= 1 && H < 5;
  $('#late').hidden = !late;
  if (late) $('#late').textContent = 'it’s late — commit, push, sleep';
  if (reset === undefined && now.getSeconds() === 0 && now.getMinutes() === 0 && H === 0) { renderOne(); renderUsage(); }
}

/* ---------- weather ---------- */
async function renderWeather(force) {
  const w = S.prefs.weather || {};
  const el = $('#weather');
  if (!w.on || look?.widgets.weather === false) { el.hidden = true; return; }
  try {
    if (force) await chrome.storage.local.remove('weatherCache');
    const d = await getWeather(w);
    el.replaceChildren(icon(d.icon, { size: 17, cls: 'wx-ic' }), h('b', {}, `${d.temp}${d.unit}`), ` ${d.label.toLowerCase()}${d.place ? ` in ${d.place}` : ''}`);
    el.title = `Feels like ${d.feels}${d.unit} · high ${d.hi}° · low ${d.lo}°`;
    el.hidden = false;
  } catch {
    el.hidden = true;
  }
}

/* ---------- search ---------- */
function parseQuery(raw) {
  const q = raw.trim();
  if (!q) return null;
  const m = q.match(/^!?([a-z]+)\s+(.+)$/i);
  if (m && BANGS[m[1].toLowerCase()]) return BANGS[m[1].toLowerCase()][1] + encodeURIComponent(m[2]);
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/i.test(q)) return 'http://' + q;
  if (/^https?:\/\/\S+$/i.test(q)) return q;
  if (!/\s/.test(q) && /^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(q)) return 'https://' + q;
  return (ENGINES[S.prefs.engine] || ENGINES.google) + encodeURIComponent(q);
}

/* ---------- important pages ---------- */
let editing = false;
function renderPages() {
  const nav = $('#pages');
  const tiles = S.links.map((l, i) => {
    const a = h('a', { class: 'page fade', href: l.url, title: l.url, style: `--i:${i}`, draggable: editing, dataset: { id: l.id } },
      h('span', { class: 'ico' }, siteIcon(l.url, { size: 64, cls: 'pg-ic', label: l.title })),
      h('span', { class: 't' }, l.title),
      h('button', { class: 'rm', type: 'button', 'aria-label': `Remove ${l.title}`, onclick: (e) => { e.preventDefault(); e.stopPropagation(); saveShared('links', S.links.filter((x) => x.id !== l.id)); } }, icon('x', { size: 12 }))
    );
    a.addEventListener('click', (e) => { if (editing) e.preventDefault(); });
    a.addEventListener('dragstart', (e) => { a.classList.add('dragging'); e.dataTransfer.setData('text/plain', l.id); });
    a.addEventListener('dragend', () => a.classList.remove('dragging'));
    a.addEventListener('dragover', (e) => { if (editing) e.preventDefault(); });
    a.addEventListener('drop', (e) => { e.preventDefault(); movePage(e.dataTransfer.getData('text/plain'), l.id); });
    return a;
  });
  nav.replaceChildren(...tiles);
  nav.classList.toggle('editing', editing);
  $('#pagesTools').classList.toggle('pinned', editing || !S.links.length);
}
function movePage(fromId, toId) {
  if (!fromId || fromId === toId) return;
  const list = [...S.links];
  const from = list.findIndex((l) => l.id === fromId);
  const to = list.findIndex((l) => l.id === toId);
  if (from < 0 || to < 0) return;
  list.splice(to, 0, list.splice(from, 1)[0]);
  saveShared('links', list);
}
function openAdd(anchor) {
  const pop = $('#addPop');
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.min(innerWidth - 296, Math.max(16, r.left + r.width / 2 - 140))}px`;
  pop.style.top = `${r.bottom + 8}px`;
  pop.hidden = false;
  $('#addForm').url.focus();
}

/* ---------- one thing ---------- */
function renderOne() {
  const one = S.one || {};
  const today = dayKey();
  const set = one.day === today && one.text;
  $('#oneForm').hidden = !!set;
  $('#oneShow').hidden = !set;
  $('#oneClear').hidden = !set;
  $('#one').classList.toggle('done', !!(set && one.done));
  if (set) {
    $('#oneText').textContent = one.text;
    const c = $('#oneCheck');
    if (!c.firstChild) c.append(svgCheck());
    c.setAttribute('aria-label', one.done ? 'Mark as not done' : 'Mark as done');
  } else if (document.activeElement !== $('#oneInput')) {
    $('#oneInput').value = '';
  }
}

/* ---------- to-dos ---------- */
function renderTodos(first = false) {
  const ul = $('#todos');
  const tasks = (S.tasks || []).filter((t) => !t.deleted);
  const open = tasks.filter((t) => !t.done).length;
  const chip = $('#todoCount');
  chip.hidden = !tasks.length;
  chip.textContent = `${tasks.length - open}/${tasks.length} done`;
  $('#clearDone').hidden = !tasks.some((t) => t.done);
  if (!tasks.length) { ul.replaceChildren(h('li', { class: 'empty-state' }, 'All clear. Add what’s next.')); return; }

  const before = new Map($$('li[data-id]', ul).map((li) => [li.dataset.id, li.getBoundingClientRect().top]));
  const sorted = [...tasks].sort((a, b) => a.done - b.done || (a.done ? b.updatedAt - a.updatedAt : b.createdAt - a.createdAt));
  const items = sorted.map((t, i) => {
    const li = h('li', { class: (t.done ? 'done' : '') + (first ? ' fade' : ''), style: first ? `--i:${i}` : '', dataset: { id: t.id } },
      h('button', { class: 'check', type: 'button', 'aria-label': t.done ? 'Mark as not done' : 'Mark as done', onclick: () => toggleTask(t.id) }, svgCheck()),
      h('span', { class: 'txt' }, t.text),
      h('button', { class: 'del', type: 'button', 'aria-label': 'Delete', onclick: () => deleteTask(t.id, li) }, icon('x', { size: 14 }))
    );
    if (!first && !before.has(t.id)) li.classList.add('enter');
    return li;
  });
  ul.replaceChildren(...items);
  for (const li of items) {
    const prev = before.get(li.dataset.id);
    if (prev == null) continue;
    const dy = prev - li.getBoundingClientRect().top;
    if (dy) li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
}
function svgCheck() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  const c = document.createElementNS(ns, 'circle');
  c.setAttribute('cx', '10'); c.setAttribute('cy', '10'); c.setAttribute('r', '9');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M6 10.2l2.7 2.6L14 7.5');
  svg.append(c, p);
  return svg;
}
function setTasks(tasks) { S.tasks = tasks; renderTodos(); return saveTasks(tasks); }
function toggleTask(id) { setTasks(S.tasks.map((t) => (t.id === id ? { ...t, done: !t.done, updatedAt: Date.now() } : t))); }
function deleteTask(id, li) {
  li.classList.add('leave');
  setTimeout(() => setTasks(S.tasks.map((t) => (t.id === id ? { ...t, deleted: true, updatedAt: Date.now() } : t))), 300);
}
function addTask(text) {
  const now = Date.now();
  return setTasks([...(S.tasks || []), { id: uid(), text, done: false, createdAt: now, updatedAt: now }]);
}

/* ---------- screen time ---------- */
async function renderUsage() {
  const days = daysBack(7);
  const today = days[6];
  const usage = await usageFor(days);
  const ids = Object.keys(usage.perBrowser);
  const todayAgg = aggregate(usage, [today]);
  const yAgg = aggregate(usage, [days[5]]);
  const rules = S.rules || {};

  countUp($('#stTotal'), todayAgg.total);
  const delta = $('#stDelta');
  if (yAgg.total > 600) {
    const pct = Math.round(((todayAgg.total - yAgg.total) / yAgg.total) * 100);
    delta.replaceChildren(h('span', { class: 'trend ' + (pct > 0 ? 'up' : 'down') }, icon(pct > 0 ? 'up' : 'down', { size: 12 }), `${Math.abs(pct)}%`), ' vs all of yesterday');
  } else {
    const used = usage.browsers.filter((b) => b.mine || (todayAgg.perDayByBrowser[today]?.[b.id] || 0) >= 1).length;
    delta.textContent = used > 1 ? `across ${used} browsers` : 'in this browser';
  }

  // categories
  const cats = byCategory(usage, [today], ids, rules).total;
  const sum = Object.values(cats).reduce((a, b) => a + b, 0) || 1;
  $('#catBar').replaceChildren(...CAT_ORDER.map((c, i) => (cats[c] ? h('i', { style: `width:${(cats[c] / sum) * 100}%;background:${CATEGORIES[c].color};animation-delay:${i * 120}ms` }) : null)));
  $('#catLegend').replaceChildren(...CAT_ORDER.filter((c) => cats[c] > 0).map((c) =>
    h('span', { style: `--c:${CATEGORIES[c].color}` }, CATEGORIES[c].label, h('b', {}, fmtDur(cats[c])))));

  // browsers (only the ones used today; old installs with nothing today stay out of the way)
  const active = usage.browsers.map((b, i) => ({ ...b, i, sec: todayAgg.perDayByBrowser[today]?.[b.id] || 0 })).filter((b) => b.mine || b.sec >= 1);
  $('#browserLine').replaceChildren(...active.flatMap((b, k) => [
    h('span', { style: `--c:${BROWSER_COLORS[b.i % 4]}` }, h('i'), `${b.label}${b.mine ? ' (this one)' : ''} ${fmtDur(b.sec)}`),
    k < active.length - 1 ? '  ·  ' : null
  ].filter(Boolean)));

  // background lane: music / dashboards that played while you did something else
  const bgl = todayAgg.background;
  const lane = $('#bgLane');
  lane.hidden = bgl.total < 60;
  if (!lane.hidden) {
    lane.replaceChildren(
      h('span', { class: 'bg-ic' }, icon('music', { size: 14 }), h('i'), h('i'), h('i')),
      h('span', { class: 'bg-t' }, h('b', {}, fmtDur(bgl.total)), ' in the background'),
      h('span', { class: 'bg-s' }, bgl.sites.slice(0, 2).map((x) => x.domain.replace(/^music\./, 'YT Music · ').replace(/ · youtube\.com$/, '')).join(', ')));
    lane.title = 'Played while you were on something else. Not counted in your screen time.';
  }

  // top sites
  const top = todayAgg.sites.slice(0, 6);
  const max = top[0]?.sec || 1;
  $('#stSites').replaceChildren(
    ...(top.length ? top.map((s, i) => {
      const c = categoryOf(s.domain, rules);
      return h('li', { class: 'fade', style: `--i:${i}` },
        siteIcon(`https://${s.domain}`),
        h('span', { class: 'dom' }, s.domain, h('span', { class: 'cat-dot', style: `--c:${CATEGORIES[c].color}`, title: CATEGORIES[c].label })),
        h('span', { class: 'time' }, fmtDur(s.sec)),
        h('div', { class: 'bar', style: `--c:${CATEGORIES[c].color}` }, h('i', { style: `width:${(s.sec / max) * 100}%;--d:${i * 70 + 150}ms` })));
    }) : [h('li', { class: 'empty' }, 'Nothing tracked yet today. Browse a bit and it shows up here.')])
  );

  // limits
  const limits = Object.entries(rules.limits || {}).filter(([, m]) => m > 0);
  $('#limits').hidden = !limits.length;
  $('#limitList').replaceChildren(...limits.map(([rule, mins], i) => {
    const used = limitUsage(todayAgg, rule, rules);
    const pct = used / (mins * 60);
    return h('li', { class: pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : '' },
      h('span', {}, rule),
      h('span', { class: 'lt' }, `${fmtDur(used)} / ${fmtDur(mins * 60)}`),
      h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, pct * 100)}%;--d:${i * 80 + 300}ms` })));
  }));

  // last 7 days stacked by category
  const agg = aggregate(usage, days);
  const perCat = byCategory(usage, days, ids, rules).perDay;
  const wmax = Math.max(...days.map((d) => agg.perDay[d]), 1);
  $('#week').replaceChildren(...days.map((d, i) => {
    const date = new Date(d + 'T12:00:00');
    const tot = agg.perDay[d] || 0;
    return h('div', { class: 'wk' + (d === today ? ' today' : '') },
      h('span', { class: 'tip' }, `${date.toLocaleDateString(undefined, { weekday: 'short' })} · ${fmtDur(tot)}`),
      h('div', { class: 'col stack', style: `height:${Math.max(2, (tot / wmax) * 100)}%;--d:${i * 60 + 200}ms` },
        ...CAT_ORDER.filter((c) => perCat[d][c] > 0).map((c) => h('i', { style: `height:${(perCat[d][c] / tot) * 100}%;background:${CATEGORIES[c].color}` }))),
      h('span', { class: 'lbl' }, date.toLocaleDateString(undefined, { weekday: 'narrow' })));
  }));

  renderRecap(rules);
  requestAnimationFrame(() => setTimeout(() => $$('.st, .week').forEach((c) => c.classList.add('settled')), 1500));
}

async function renderRecap(rules) {
  const r = await weeklyRecap(rules);
  const chip = $('#weekChip');
  const lines = [];
  if (!r.total) { $('#recap').replaceChildren(h('li', { class: 'dim' }, 'Your weekly recap builds up as you browse.')); chip.hidden = true; return; }
  if (r.prevTotal > 600) {
    const pct = Math.round(((r.total - r.prevTotal) / r.prevTotal) * 100);
    chip.hidden = false;
    chip.replaceChildren(icon(pct > 0 ? 'up' : 'down', { size: 12 }), `${Math.abs(pct)}% vs last week`);
  } else chip.hidden = true;
  lines.push(h('li', {}, h('b', {}, fmtDur(r.total)), ` since Monday${r.days > 1 ? ` · ${fmtDur(r.total / r.days)}/day` : ''}`));
  const topCat = Object.entries(r.cats).sort((a, b) => b[1] - a[1])[0];
  if (topCat?.[1]) lines.push(h('li', {}, 'Mostly ', h('b', {}, CATEGORIES[topCat[0]].label.toLowerCase()), ` — ${Math.round((topCat[1] / r.total) * 100)}% of your time`));
  if (r.top) lines.push(h('li', {}, 'Top site ', h('b', {}, r.top.domain), ` · ${fmtDur(r.top.sec)}`));
  if (r.mover && Math.abs(r.mover.diff) > 900) lines.push(h('li', {}, 'Biggest change ', h('b', {}, r.mover.domain), ' ', h('span', { class: r.mover.diff > 0 ? 'up' : 'down' }, `${r.mover.diff > 0 ? '+' : '−'}${fmtDur(Math.abs(r.mover.diff))}`)));
  $('#recap').replaceChildren(...lines.map((l, i) => { l.className = (l.className ? l.className + ' ' : '') + 'fade'; l.style.setProperty('--i', i + 2); return l; }));
}

/* ---------- dev card ---------- */
async function renderDev(force = false) {
  const repos = (S.prefs.repos || []).filter(Boolean);
  const card = $('.dev');
  card.hidden = !repos.length;
  if (!repos.length) return;
  const token = S.github?.token || (S.sync?.mode !== 'server' && S.sync?.token) || '';
  try {
    const items = await repoStatuses(token, repos, { force });
    // time spent per repo this week (from github.com paths)
    const days = daysBack(7);
    const agg = aggregate(await usageFor(days), days);
    const repoTime = agg.paths['github.com'] || {};
    $('#repos').replaceChildren(...items.map((r, i) => {
      const spent = repoTime[r.full?.toLowerCase()] || 0;
      if (r.error) return h('li', { class: 'fade', style: `--i:${i}` }, h('span', { class: 'ci' }), h('a', { class: 'nm', href: r.url }, r.full), h('span'), h('span', { class: 'err' }, r.error));
      return h('li', { class: 'fade', style: `--i:${i}` },
        h('a', { class: `ci ${r.ci}`, href: r.ciUrl, title: r.ci === 'none' ? 'No CI runs' : `${r.ciName}: ${r.ci}` }),
        h('a', { class: 'nm', href: r.url }, r.name),
        h('a', { class: 'pr', href: `${r.url}/pulls`, title: 'Open pull requests' }, `${r.prs} PR${r.prs === 1 ? '' : 's'}`),
        r.commit ? h('span', { class: 'meta' }, h('a', { href: r.commit.url }, `${r.commit.msg}`), ` · ${ago(r.commit.at)}`) : h('span', { class: 'meta' }, 'No commits'),
        spent > 60 ? h('span', { class: 'repo-time' }, `${fmtDur(spent)} on GitHub this week`) : null);
    }));
  } catch {
    $('#repos').replaceChildren(h('li', { class: 'empty' }, 'Couldn’t reach GitHub.'));
  }
}

/* ---------- sync & servers ---------- */
function renderSync() {
  const chip = $('#syncChip');
  const sic = $('.sic', chip);
  const lbl = $('.lbl', chip);
  const s = S.sync;
  const others = Object.keys(S.remote || {}).filter((id) => id !== S.browser?.id).length;
  const state = !syncOn(s) ? 'off' : s.lastError ? 'bad' : 'ok';
  if (sic.dataset.state !== state) { sic.dataset.state = state; sic.replaceChildren(icon(state === 'off' ? 'cloudOff' : state === 'bad' ? 'alert' : 'lock', { size: 14 })); }
  chip.dataset.state = state;
  if (!syncOn(s)) { lbl.textContent = 'Sync off'; chip.title = 'Sync Chrome and Brave (encrypted)'; return; }
  if (s.lastError) { lbl.textContent = 'Sync needs attention'; chip.title = s.lastError; return; }
  lbl.textContent = others ? `${others + 1} browsers` : 'Synced';
  chip.title = `End-to-end encrypted · last sync ${s.lastSync ? new Date(s.lastSync).toLocaleTimeString() : '—'}`;
}

function renderMonitors() {
  const cache = S.monitorCache?.results || {};
  const list = S.monitors || [];
  const up = list.filter((m) => cache[m.url]?.up).length;
  const known = list.filter((m) => cache[m.url]).length;
  const chip = $('#srvChip');
  chip.hidden = !list.length;
  $('.dot', chip).className = 'dot' + (known ? (up === list.length ? ' ok' : ' bad') : '');
  chip.dataset.state = known ? (up === list.length ? 'ok' : 'bad') : 'off';
  $('.lbl', chip).textContent = known ? `${up}/${list.length} up` : 'Servers';
  $('#monitors').replaceChildren(...list.map((m) => {
    const r = cache[m.url];
    return h('li', {},
      h('span', { class: 'dot ' + (r ? (r.up ? 'ok' : 'bad') : '') }),
      h('a', { href: m.url.replace(/\/healthz$/, ''), title: m.url }, m.name),
      h('span', { class: 'ms' }, r ? (r.up ? `${r.status ? r.status + ' · ' : ''}${r.ms}ms` : r.status ? `HTTP ${r.status}` : 'down') : '…'));
  }));
  const at = S.monitorCache?.at;
  $('#checkedAt').textContent = at ? `Checked ${new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : '';
}
async function checkOne(url) {
  let u;
  try { u = new URL(url); } catch { return { up: false }; }
  let perm = false;
  try { perm = await chrome.permissions.contains({ origins: [`${u.protocol}//${u.hostname}/*`] }); } catch {}
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  const t0 = performance.now();
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal, mode: perm ? 'cors' : 'no-cors', credentials: 'omit' });
    const ms = Math.round(performance.now() - t0);
    if (res.type === 'opaque') return { up: true, ms };
    return { up: res.status < 500, status: res.status, ms };
  } catch {
    return { up: false };
  } finally { clearTimeout(timer); }
}
async function checkMonitors(force) {
  if (!force && S.monitorCache?.at && Date.now() - S.monitorCache.at < 120000) return;
  $$('#monitors .dot').forEach((d) => d.classList.add('checking'));
  const entries = await Promise.all((S.monitors || []).map(async (m) => [m.url, await checkOne(m.url)]));
  S.monitorCache = { at: Date.now(), results: Object.fromEntries(entries) };
  await save({ monitorCache: S.monitorCache });
  renderMonitors();
}

/* ---------- wiring ---------- */
function wire() {
  const q = $('#q');
  const hint = $('#bangHint');
  q.addEventListener('input', () => {
    const m = q.value.match(/^!?([a-z]+)\s/i);
    const b = m && BANGS[m[1].toLowerCase()];
    hint.hidden = !b;
    if (b) hint.textContent = b[0];
  });
  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = parseQuery(q.value);
    if (url) location.href = url;
  });

  palette = createPalette({
    getLinks: () => S.links,
    actions: (text) => [
      { title: 'Screen Time', icon: icon('chart'), run: () => (location.href = 'insights.html') },
      { title: 'Customise the new tab', icon: icon('palette'), run: () => (location.href = 'options.html#customise') },
      { title: 'Options', icon: icon('sliders'), run: () => chrome.runtime.openOptionsPage() },
      ...(text.trim() ? [
        { title: `Add to-do: “${text.trim()}”`, icon: icon('plus'), always: true, run: (v) => { addTask(v.trim()); toast('To-do added'); } },
        { title: `Search the web for “${text.trim()}”`, icon: icon('search'), always: true, run: (v) => (location.href = parseQuery(v) || '#') }
      ] : [])
    ]
  });
  $('#openPal').addEventListener('click', () => palette.open(q.value));

  $('#oneForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('#oneInput').value.trim();
    if (!text) return;
    S.one = { text, day: dayKey(), done: false };
    $('#oneInput').blur();
    renderOne();
    saveShared('one', S.one);
  });
  $('#oneCheck').addEventListener('click', () => {
    S.one = { ...S.one, done: !S.one.done };
    renderOne();
    saveShared('one', S.one);
    if (S.one.done) toast('Nice. That’s the day won.');
  });
  $('#oneClear').addEventListener('click', () => {
    const prev = S.one.text;
    S.one = { text: '', day: dayKey(), done: false };
    renderOne();
    $('#oneInput').value = prev;
    $('#oneInput').focus();
  });

  $('#todoForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#todoInput');
    const text = input.value.trim();
    if (!text) return;
    addTask(text);
    input.value = '';
  });
  $('#clearDone').addEventListener('click', () => {
    $$('#todos li.done').forEach((li) => li.classList.add('leave'));
    setTimeout(() => setTasks(S.tasks.map((t) => (t.done && !t.deleted ? { ...t, deleted: true, updatedAt: Date.now() } : t))), 300);
  });

  let noteTimer;
  $('#notes').addEventListener('input', (e) => {
    clearTimeout(noteTimer);
    $('#notesState').textContent = 'typing…';
    noteTimer = setTimeout(async () => {
      S.notes = e.target.value;
      await saveShared('notes', S.notes);
      $('#notesState').textContent = 'saved';
    }, 500);
  });

  $('#devRefresh').addEventListener('click', () => { $('#repos').style.opacity = '.5'; renderDev(true).then(() => ($('#repos').style.opacity = '')); });

  $('#editPages').addEventListener('click', (e) => {
    editing = !editing;
    $('span', e.currentTarget).textContent = editing ? 'Done' : 'Edit';
    e.currentTarget.classList.toggle('on', editing);
    renderPages();
  });
  $('#addPage').addEventListener('click', (e) => { e.stopPropagation(); openAdd(e.currentTarget); });
  // Drop a link (from a page, the address bar or another tab) onto the row to add it.
  const nav = $('#pages');
  const isLink = (e) => [...e.dataTransfer.types].includes('text/uri-list') && !$('.page.dragging');
  nav.addEventListener('dragover', (e) => { if (isLink(e)) { e.preventDefault(); nav.classList.add('drop'); } });
  nav.addEventListener('dragleave', (e) => { if (!nav.contains(e.relatedTarget)) nav.classList.remove('drop'); });
  nav.addEventListener('drop', async (e) => {
    nav.classList.remove('drop');
    if (!isLink(e)) return;
    e.preventDefault();
    const url = toUrl(e.dataTransfer.getData('text/uri-list').split('\n').find((l) => l && !l.startsWith('#')));
    if (!url || S.links.some((l) => l.url === url)) return;
    const title = new URL(url).hostname.replace(/^www\./, '').split('.')[0].replace(/^./, (c) => c.toUpperCase());
    await saveShared('links', [...S.links, { id: uid(), title, url }]);
    toast(`Added ${title}`);
  });
  $('#addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const url = toUrl(f.url.value);
    if (!url) { toast('That doesn’t look like a URL'); return; }
    const title = f.title.value.trim() || new URL(url).hostname.replace(/^www\./, '').split('.')[0].replace(/^./, (c) => c.toUpperCase());
    await saveShared('links', [...S.links, { id: uid(), title, url }]);
    f.reset();
    $('#addPop').hidden = true;
  });
  $('#addCancel').addEventListener('click', () => ($('#addPop').hidden = true));

  const srv = $('#srvChip');
  srv.addEventListener('click', (e) => {
    e.stopPropagation();
    const pop = $('#srvPop');
    pop.hidden = !pop.hidden;
    srv.setAttribute('aria-expanded', String(!pop.hidden));
    if (!pop.hidden) checkMonitors(false);
  });
  $('#recheck').addEventListener('click', (e) => { e.stopPropagation(); checkMonitors(true); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.pop-wrap')) $('#srvPop').hidden = true;
    if (!e.target.closest('#addPop') && !e.target.closest('#addPage')) $('#addPop').hidden = true;
  });

  $$('.card').forEach((c) => c.addEventListener('pointermove', (e) => {
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', `${e.clientX - r.left}px`);
    c.style.setProperty('--my', `${e.clientY - r.top}px`);
  }));

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette.isOpen ? palette.close() : palette.open(); return; }
    if (palette.isOpen) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (e.key === 'Escape') { $('#addPop').hidden = true; $('#srvPop').hidden = true; if (document.activeElement === q) { q.value = ''; hint.hidden = true; q.blur(); } return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); q.focus(); }
    else if (e.key === 't') { e.preventDefault(); $('#todoInput').focus(); }
    else if (e.key === 'n') { e.preventDefault(); $('#notes').focus(); }
    else if (e.key === 's') { e.preventDefault(); location.href = 'insights.html'; }
    else if (e.key === 'c') { e.preventDefault(); location.href = 'options.html#customise'; }
    else if (e.key === 'k') { e.preventDefault(); palette.open(); }
  });

  $('#updChip').addEventListener('click', () => runUpdate(true));
  if (PREVIEW) return;
  setInterval(() => checkMonitors(false), 60000);
  setInterval(renderUsage, 60000);
  setInterval(() => renderDev(false), 5 * 60000);
  setInterval(() => renderWeather(false), 30 * 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    renderUsage();
    if (S.sync?.mode === 'server') notifyBackground('sync:pull');
  });
}

/* ---------- self-update ---------- */
function renderUpdate() {
  const chip = $('#updChip');
  const st = S.updater || {};
  const show = hasUpdate(st) && !PREVIEW;
  chip.hidden = !show;
  if (show) {
    $('.lbl', chip).textContent = `Update to ${st.latest.version}`;
    chip.title = st.latest.message ? `What’s new: ${st.latest.message}` : 'A new version is in your repo';
  }
}

async function runUpdate(interactive) {
  if (!folderSupported()) { location.href = 'options.html#updates'; return; }
  const perm = await folderPermission();
  if (perm === 'none') { location.href = 'options.html#updates'; return; }
  const ov = $('#updOverlay');
  try {
    if (interactive) { ov.hidden = false; $('#updMsg').textContent = 'Updating Nightshift…'; }
    const r = await applyUpdate({ interactive, onProgress: (m) => interactive && ($('#updMsg').textContent = m) });
    if (interactive) {
      $('#updMsg').textContent = `Installed ${r.version}. Restarting…`;
      await save({ justUpdated: { ...(await chrome.storage.local.get('justUpdated')).justUpdated, reopen: 'newtab.html' } });
      notifyBackground('update:reload');
    } else {
      notifyBackground('update:staged'); // reloads once you've left every Nightshift page
    }
  } catch (e) {
    ov.hidden = true;
    if (interactive) toast(e.message || 'Update failed');
  }
}

// Silent update: only when it's switched on and folder access is already permanent.
async function maybeUpdate() {
  renderUpdate();
  if (PREVIEW || !S.updater?.auto || !hasUpdate(S.updater)) return;
  if ((await folderPermission()) !== 'granted') return;
  runUpdate(false);
}

async function showJustUpdated() {
  const { justUpdated: j } = await chrome.storage.local.get('justUpdated');
  if (!j || j.seen || PREVIEW || Date.now() - j.at > 86400000) return;
  await save({ justUpdated: { ...j, seen: true } });
  setTimeout(() => toast(`Updated to ${j.to}${j.message ? ` · ${j.message}` : ''}`), 900);
}

/* ---------- live sync (own server) ---------- */
let stopLive = null;
function startLive() {
  stopLive?.();
  let t = null;
  stopLive = watchServer(S.sync, S.browser?.id, () => {
    clearTimeout(t);
    t = setTimeout(() => notifyBackground('sync:pull'), 300); // the worker pulls, storage updates, the page re-renders
  });
}

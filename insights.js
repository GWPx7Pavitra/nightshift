import {
  load, saveShared, daysBack, dayKey, fmtDur, siteIcon, h, $, $$, applyAccent, countUp, usageFor, aggregate, byCategory, categoryOf,
  matchesDomain, limitApplies, CATEGORIES, CAT_ORDER, BROWSER_COLORS, notifyBackground, ensureCategories, PRODUCTIVE
} from './lib/common.js';
import { icon, hydrateIcons } from './lib/icons.js';
import { watchServer } from './lib/sync.js';
import { renderBackdrop } from './lib/backdrop.js';

const hashRange = location.hash.slice(1);
let range = ['1', 'y', '7', '30'].includes(hashRange) ? hashRange : sessionStorage.getItem('st-range') || '1';
let colorBy = sessionStorage.getItem('st-color') || 'cat';
let filterIds = null; // null = all browsers
let catFilter = null;
let showAll = false;
let expanded = new Set(['github.com']);
let usage, browsers, agg, days, rules;

init();

async function init() {
  const st = await load(['prefs', 'rules']);
  rules = st.rules;
  ensureCategories(rules);
  applyAccent(st.prefs);
  hydrateIcons();
  renderBackdrop($('#backdrop'), st.prefs);
  await notifyBackground('track:flush');

  $$('#range button').forEach((b) => b.addEventListener('click', () => { range = b.dataset.r; sessionStorage.setItem('st-range', range); showAll = false; render(); }));
  $$('#colorBy button').forEach((b) => b.addEventListener('click', () => { colorBy = b.dataset.c; sessionStorage.setItem('st-color', colorBy); render(true); }));
  $('#filter').addEventListener('input', () => renderTable());
  $('#more').addEventListener('click', () => { showAll = true; renderTable(); });
  $('#catFilter').addEventListener('click', () => { catFilter = null; renderCats(); renderTable(); });
  addEventListener('resize', moveIndicators);
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local') return;
    if (c.rules) { rules = c.rules.newValue; ensureCategories(rules); }
    if (c.prefs) applyAccent(c.prefs.newValue);
    if (c.remote || c.rules || c[`u:${dayKey()}`]) render(true);
  });
  render();
  // own sync server: live updates from your other browsers
  const { sync, browser } = await load(['sync', 'browser']);
  if (sync.mode === 'server') {
    notifyBackground('sync:pull');
    let t = null;
    watchServer(sync, browser.id, () => { clearTimeout(t); t = setTimeout(() => notifyBackground('sync:pull'), 300); });
  }
}

function rangeDays() {
  if (range === 'y') return [daysBack(2)[0]];
  return daysBack(Number(range));
}

function moveIndicators() {
  for (const [sel, val, attr] of [['#range', range, 'r'], ['#colorBy', colorBy, 'c']]) {
    const btn = $(`${sel} button[data-${attr}="${val}"]`);
    const ind = $(`${sel} .seg-ind`);
    if (!btn || !ind) continue;
    ind.style.width = `${btn.offsetWidth}px`;
    ind.style.transform = `translateX(${btn.offsetLeft}px)`;
    $$(`${sel} button`).forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
  }
}

const shownIds = () => (filterIds ? filterIds.filter((id) => usage.perBrowser[id]) : Object.keys(usage.perBrowser));

async function render(quiet = false) {
  moveIndicators();
  days = rangeDays();
  usage = await usageFor(days);
  browsers = usage.browsers.map((b, i) => ({ ...b, color: BROWSER_COLORS[i % 4] }));
  agg = aggregate(usage, days, shownIds());

  $('#browsers').replaceChildren(
    ...(browsers.length > 1 ? [
      h('button', { class: 'chip bchip', style: '--c:var(--text-2)', 'aria-pressed': String(!filterIds), onclick: () => { filterIds = null; render(); } }, 'All browsers'),
      ...browsers.map((b) => h('button', { class: 'chip bchip', style: `--c:${b.color}`, 'aria-pressed': String(!!filterIds?.includes(b.id)), onclick: () => { filterIds = [b.id]; render(); } },
        h('span', { class: 'sw' }), b.label + (b.mine ? ' · this' : '')))
    ] : [h('a', { class: 'chip', href: 'options.html#sync' }, h('span', { class: 'dot ok' }), `${browsers[0].label} only — set up sync to add your other browser`)])
  );
  const label = range === '1' ? 'today' : range === 'y' ? 'yesterday' : `in the last ${range} days`;
  $('#sub').textContent = `Where your browsing time went ${label}.`;

  renderStats(quiet);
  renderCats();
  renderChart();
  renderTable();
  const other = browsers.filter((b) => !b.mine);
  $('#foot').textContent = (other.length
    ? `Includes ${other.map((b) => `${b.label} (synced ${b.updatedAt ? new Date(b.updatedAt).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : '—'})`).join(', ')}. `
    : '') + 'Only the tab you’re actively using counts — plus tabs playing audio. Idle time is ignored.';
}

function renderStats(quiet) {
  const activeDays = days.filter((d) => agg.perDay[d] > 0).length || 1;
  const peak = agg.hours.indexOf(Math.max(...agg.hours));
  const top = agg.sites[0];
  const hourLabel = (hr) => new Date(2000, 0, 1, hr).toLocaleTimeString(undefined, { hour: 'numeric' });
  const cards = [
    ['Total', h('div', { class: 'v', id: 'vTotal' }), days.length > 1 ? `${activeDays} active day${activeDays === 1 ? '' : 's'}` : `${agg.sites.length} sites`],
    [days.length > 1 ? 'Daily average' : 'Productive', h('div', { class: 'v' }, days.length > 1 ? fmtDur(agg.total / activeDays) : fmtDur(Object.entries(byCategory(usage, days, shownIds(), rules).total).filter(([c]) => PRODUCTIVE.has(c)).reduce((a, [, v]) => a + v, 0))), days.length > 1 ? `${agg.sites.length} sites` : [...PRODUCTIVE].map((c) => CATEGORIES[c].label.toLowerCase()).join(', ')],
    ['Most used', top ? h('div', { class: 'v site' }, siteIcon(`https://${top.domain}`), top.domain) : h('div', { class: 'v' }, '—'), top ? fmtDur(top.sec) : ''],
    ['Peak hour', h('div', { class: 'v' }, agg.hours[peak] > 0 ? hourLabel(peak) : '—'), agg.hours[peak] > 0 ? `${fmtDur(agg.hours[peak])} in that hour` : '']
  ];
  $('#stats').replaceChildren(...cards.map(([k, v, s], i) => h('div', { class: 'card stat' + (quiet ? '' : ' reveal'), style: `--i:${i + 1}` }, h('div', { class: 'k' }, k), v, h('div', { class: 's' }, s))));
  countUp($('#vTotal'), agg.total, { duration: quiet ? 1 : 1100 });
}

function renderCats() {
  const cats = byCategory(usage, days, shownIds(), rules).total;
  const total = Object.values(cats).reduce((a, b) => a + b, 0) || 1;
  $('#cats').replaceChildren(...CAT_ORDER.filter((c) => cats[c] > 0 || c === catFilter).map((c, i) => h('button', {
    class: 'cat' + (catFilter === c ? ' on' : '') + (catFilter && catFilter !== c ? ' off' : ''), style: `--c:${CATEGORIES[c].color}`,
    onclick: () => { catFilter = catFilter === c ? null : c; showAll = false; renderCats(); renderTable(); }
  },
  h('div', { class: 'cat-top' }, h('span', { class: 'cat-chip', style: `--c:${CATEGORIES[c].color}` }, CATEGORIES[c].label), h('span', { class: 'pct' }, `${Math.round((cats[c] / total) * 100)}%`)),
  h('div', { class: 'cat-v' }, fmtDur(cats[c])),
  h('div', { class: 'bar' }, h('i', { style: `width:${(cats[c] / total) * 100}%;background:${CATEGORIES[c].color};--d:${i * 90 + 200}ms` })))));
  const chip = $('#catFilter');
  chip.hidden = !catFilter;
  if (catFilter) chip.replaceChildren(CATEGORIES[catFilter].label, icon('x', { size: 12 }));
}

function renderChart() {
  const chart = $('#chart');
  const single = days.length === 1;
  const ids = shownIds();
  const shown = browsers.filter((b) => ids.includes(b.id));
  $('#chartTitle').textContent = single ? 'By hour' : 'By day';
  $('#colorBy').hidden = single;
  const legend = single ? [] : colorBy === 'cat' ? CAT_ORDER.map((c) => ({ label: CATEGORIES[c].label, color: CATEGORIES[c].color })) : shown.length > 1 ? shown.map((b) => ({ label: b.label, color: b.color })) : [];
  $('#chartLegend').replaceChildren(...legend.map((l) => h('span', { style: `--c:${l.color}` }, l.label)));

  let cols;
  if (single) {
    const max = Math.max(...agg.hours, 1);
    cols = agg.hours.map((sec, hr) => ({
      label: hr % 3 === 0 ? new Date(2000, 0, 1, hr).toLocaleTimeString(undefined, { hour: 'numeric' }) : '',
      tip: `${new Date(2000, 0, 1, hr).toLocaleTimeString(undefined, { hour: 'numeric' })} · ${fmtDur(sec)}`,
      height: (sec / max) * 100,
      parts: sec ? [{ pct: 100, color: 'var(--accent)' }] : []
    }));
  } else {
    const perCat = byCategory(usage, days, ids, rules).perDay;
    const max = Math.max(...days.map((d) => agg.perDay[d]), 1);
    cols = days.map((d, idx) => {
      const tot = agg.perDay[d];
      const date = new Date(d + 'T12:00:00');
      const every = days.length > 14 ? 5 : 1;
      const parts = !tot ? [] : colorBy === 'cat'
        ? CAT_ORDER.map((c) => ({ pct: (perCat[d][c] / tot) * 100, color: CATEGORIES[c].color }))
        : shown.map((b) => ({ pct: ((agg.perDayByBrowser[d]?.[b.id] || 0) / tot) * 100, color: b.color }));
      return {
        label: idx % every === 0 || idx === days.length - 1 ? date.toLocaleDateString(undefined, days.length > 7 ? { day: 'numeric', month: 'short' } : { weekday: 'short' }) : '',
        tip: `${date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtDur(tot)}`,
        height: (tot / max) * 100,
        parts: parts.filter((p) => p.pct > 0)
      };
    });
  }
  chart.style.gridTemplateColumns = `repeat(${cols.length}, minmax(0, 1fr))`;
  chart.replaceChildren(...cols.map((c, i) => h('div', { class: 'c' },
    h('span', { class: 'tip' }, c.tip),
    h('div', { class: 'stack', style: `height:${Math.max(1, c.height)}%;--d:${i * (single ? 25 : 40)}ms` }, ...c.parts.map((p) => h('i', { style: `height:${p.pct}%;background:${p.color}` }))),
    h('span', { class: 'lbl' }, c.label))));
}

function catSelect(domain) {
  const cur = categoryOf(domain, rules);
  const sel = h('select', { class: 'cat-select', style: `--c:${CATEGORIES[cur].color}`, title: 'Change category', 'aria-label': `Category for ${domain}` },
    ...CAT_ORDER.map((c) => h('option', { value: c, selected: c === cur }, CATEGORIES[c].label)), h('option', { value: '__new' }, 'New category…'));
  sel.addEventListener('change', async () => {
    if (sel.value === '__new') { location.href = 'options.html#categories'; return; }
    rules = { ...rules, categories: { ...(rules.categories || {}), [domain]: sel.value } };
    await saveShared('rules', rules);
  });
  return sel;
}

function renderTable() {
  const q = $('#filter').value.trim().toLowerCase();
  const rows = agg.sites.filter((s) => (!q || s.domain.includes(q)) && (!catFilter || categoryOf(s.domain, rules) === catFilter));
  const list = showAll || q ? rows : rows.slice(0, 25);
  $('#more').hidden = showAll || q || rows.length <= 25;
  $('#more').textContent = `Show all ${rows.length}`;
  const ids = shownIds();
  const total = agg.total || 1;
  const max = agg.sites[0]?.sec || 1;
  const perDayLimit = (domain) => Object.entries(rules.limits || {}).find(([r, m]) => m > 0 && limitApplies(domain, r, rules));
  const items = [];
  list.forEach((s, i) => {
    const subs = agg.paths[s.domain];
    const canExpand = subs && Object.keys(subs).length;
    const open = canExpand && expanded.has(s.domain);
    const lim = perDayLimit(s.domain);
    items.push(h('li', { class: (i < 25 ? 'fade' : '') + (canExpand ? ' expandable' : '') + (open ? ' open' : ''), style: `--i:${Math.min(i, 20)}` },
      h('span', { class: 'rank' }, String(agg.sites.indexOf(s) + 1)),
      siteIcon(`https://${s.domain}`),
      h('div', { class: 'name' },
        h('a', { href: `https://${s.domain}`, title: s.domain }, s.domain),
        canExpand ? h('button', { class: 'exp', 'aria-expanded': String(open), onclick: () => { open ? expanded.delete(s.domain) : expanded.add(s.domain); renderTable(); } }, open ? 'hide repos' : `${Object.keys(subs).length} repos`) : null,
        lim ? h('span', { class: 'lim', title: 'Daily limit' }, `limit ${fmtDur(lim[1] * 60)}/day`) : null),
      catSelect(s.domain),
      h('div', { class: 'split', title: browsers.filter((b) => ids.includes(b.id) && s.by?.[b.id]).map((b) => `${b.label}: ${fmtDur(s.by[b.id])}`).join(' · ') },
        ...browsers.filter((b) => ids.includes(b.id)).map((b) => (s.by?.[b.id] ? h('i', { style: `width:${(s.by[b.id] / max) * 100}%;background:${b.color};--d:${Math.min(i, 20) * 40 + 100}ms` }) : null))),
      h('span', { class: 'pct' }, `${Math.round((s.sec / total) * 100)}%`),
      h('span', { class: 't' }, fmtDur(s.sec))));
    if (open) {
      const sorted = Object.entries(subs).sort((a, b) => b[1] - a[1]);
      for (const [sub, sec] of sorted.slice(0, 12)) {
        items.push(h('li', { class: 'subrow fade' },
          h('span'), h('span', { class: 'sub-ic' }, icon('sub', { size: 14 })),
          h('a', { href: `https://${s.domain}/${sub}`, title: sub }, sub),
          h('span'),
          h('div', { class: 'bar' }, h('i', { style: `width:${(sec / s.sec) * 100}%` })),
          h('span', { class: 'pct' }, `${Math.round((sec / s.sec) * 100)}%`),
          h('span', { class: 't' }, fmtDur(sec))));
      }
    }
  });
  $('#table').replaceChildren(...(items.length ? items : [h('li', { class: 'none' }, q || catFilter ? 'No sites match.' : 'No browsing tracked for this range yet.')]));
  renderBackground();
}

// Music and dashboards that played while something else had your attention (not in the totals).
function renderBackground() {
  const bg = agg.background;
  const card = $('#bgCard');
  card.hidden = !bg || bg.total < 60;
  if (card.hidden) return;
  $('#bgTotal').textContent = fmtDur(bg.total);
  const max = bg.sites[0]?.sec || 1;
  $('#bgList').replaceChildren(...bg.sites.slice(0, 8).map((s, i) => h('li', { class: 'fade', style: `--i:${i}` },
    siteIcon(`https://${s.domain}`),
    h('span', { class: 'd' }, s.domain),
    h('div', { class: 'bar' }, h('i', { style: `width:${(s.sec / max) * 100}%;background:var(--cat-bg);--d:${i * 60 + 100}ms` })),
    h('span', { class: 't' }, fmtDur(s.sec)))));
}

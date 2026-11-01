import {
  load, save, saveShared, uid, daysBack, fmtDur, h, $, applyAccent, countUp, usageFor, aggregate, domainOf, normalizeDomain, toUrl,
  siteIcon, categoryOf, matchesDomain, limitApplies, limitUsage, CATEGORIES, CAT_ORDER, notifyBackground, ensureCategories, syncOn
} from './lib/common.js';
import { icon, hydrateIcons } from './lib/icons.js';

init();

async function init() {
  const st = await load(['prefs', 'links', 'tracking', 'sync', 'remote', 'browser', 'rules']);
  applyAccent(st.prefs);
  ensureCategories(st.rules);
  hydrateIcons();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await notifyBackground('track:flush');

  const days = daysBack(1);
  const usage = await usageFor(days);
  const all = aggregate(usage, days);
  const mine = aggregate(usage, days, [st.browser.id]);
  const domain = domainOf(tab?.url || '');
  const d = normalizeDomain(domain);
  let rules = st.rules;

  // current site
  if (domain) {
    $('#siteFav').replaceWith(siteIcon(tab.url, { size: 64, cls: 'fav big-fav' }));
    $('#siteDom').textContent = domain;
    const here = all.sites.find((s) => s.domain === domain)?.sec || 0;
    const mineHere = mine.sites.find((s) => s.domain === domain)?.sec || 0;
    countUp($('#siteTime'), here, { duration: 700 });
    const ignored = st.tracking.excluded.includes(d);
    $('#siteSub').textContent = ignored ? 'Not tracked' : usage.browsers.length > 1 ? `today · ${fmtDur(mineHere)} in ${st.browser.label}` : 'today on this site';

    const sel = $('#siteCat');
    const paint = () => {
      const cur = categoryOf(domain, rules);
      sel.replaceChildren(...CAT_ORDER.map((c) => h('option', { value: c, selected: c === cur }, CATEGORIES[c].label)), h('option', { value: '__new' }, 'New category…'));
      sel.style.setProperty('--c', CATEGORIES[cur].color);
    };
    paint();
    sel.hidden = false;
    sel.addEventListener('change', async () => {
      if (sel.value === '__new') { chrome.tabs.create({ url: chrome.runtime.getURL('options.html#categories') }); window.close(); return; }
      rules = { ...rules, categories: { ...(rules.categories || {}), [d]: sel.value } };
      await saveShared('rules', rules);
      paint();
    });

    // limit for this site
    const box = $('#limitBox');
    box.hidden = false;
    const paintLimit = () => {
      const entry = Object.entries(rules.limits || {}).find(([r, m]) => m > 0 && limitApplies(domain, r, rules));
      const rule = entry?.[0] || d;
      const mins = entry?.[1] || 0;
      const used = limitUsage(all, rule, rules);
      box.classList.toggle('over', !!mins && used >= mins * 60);
      $('#limitUsed').textContent = mins ? `${fmtDur(used)} of ${fmtDur(mins * 60)}${entry && entry[0] !== d ? ` (${entry[0]})` : ''}` : 'none — pick one to get a nudge';
      $('#limitBar').hidden = !mins;
      requestAnimationFrame(() => ($('#limitBar > i').style.width = mins ? `${Math.min(100, (used / (mins * 60)) * 100)}%` : '0'));
      $('#limitOpts').replaceChildren(...[0, 15, 30, 60, 120].map((m) => h('button', {
        class: m === mins ? 'on' : '',
        onclick: async () => {
          const limits = { ...(rules.limits || {}) };
          if (m) limits[rule] = m; else delete limits[rule];
          rules = { ...rules, limits };
          await saveShared('rules', rules);
          paintLimit();
        }
      }, m ? fmtDur(m * 60) : 'Off')));
    };
    paintLimit();
  } else {
    $('#siteFav').src = 'icons/48.png';
    $('#siteDom').textContent = 'Browser page';
    $('#siteSub').textContent = 'Not a website — nothing to track';
    $('#siteTime').textContent = '';
  }

  // actions
  const add = $('#addPage');
  const url = toUrl(tab?.url || '');
  const already = st.links.some((l) => l.url === url || (domain && domainOf(l.url) === domain && new URL(l.url).pathname === '/'));
  if (!domain) add.disabled = true;
  if (already) { add.replaceChildren(icon('check', { size: 14 }), 'In important pages'); add.classList.add('done'); add.disabled = true; }
  add.addEventListener('click', async () => {
    const title = (tab.title || '').split(/ [-|·–—] /)[0].trim().slice(0, 24) || domain;
    await saveShared('links', [...st.links, { id: uid(), title, url }]);
    add.replaceChildren(icon('check', { size: 14 }), 'Added'); add.classList.add('done'); add.disabled = true;
  });

  const ign = $('#ignore');
  const setIgn = (on) => { ign.replaceChildren(...(on ? [icon('check', { size: 14 }), 'Not tracking'] : ['Don’t track this site'])); ign.classList.toggle('done', on); };
  if (!d) ign.disabled = true;
  setIgn(st.tracking.excluded.includes(d));
  ign.addEventListener('click', async () => {
    const { tracking } = await load(['tracking']);
    const on = !tracking.excluded.includes(d);
    tracking.excluded = on ? [...tracking.excluded, d] : tracking.excluded.filter((x) => x !== d);
    await save({ tracking });
    setIgn(on);
  });

  // today list
  countUp($('#total'), all.total, { duration: 700 });
  const top = all.sites.slice(0, 5);
  const max = top[0]?.sec || 1;
  $('#top').replaceChildren(...(top.length ? top.map((s, i) => {
    const c = categoryOf(s.domain, rules);
    return h('li', { class: 'fade', style: `--i:${i + 3}` },
      siteIcon(`https://${s.domain}`),
      h('span', { class: 'd' }, s.domain),
      h('span', { class: 't' }, fmtDur(s.sec)),
      h('div', { class: 'bar' }, h('i', { style: `width:${(s.sec / max) * 100}%;background:${CATEGORIES[c].color};--d:${i * 60 + 200}ms` })));
  }) : [h('li', { class: 'none' }, 'Nothing tracked yet today.')]));

  // sync chip
  const chip = $('#sync');
  const others = Object.keys(st.remote || {}).filter((id) => id !== st.browser.id).length;
  const state = !syncOn(st.sync) ? 'off' : st.sync.lastError ? 'bad' : 'ok';
  chip.dataset.state = state;
  $('.sic', chip).replaceChildren(icon(state === 'off' ? 'cloudOff' : state === 'bad' ? 'alert' : 'lock', { size: 13 }));
  $('.lbl', chip).textContent = !syncOn(st.sync) ? 'Sync off' : st.sync.lastError ? 'Sync: fix' : others ? `${others + 1} browsers` : 'Synced';
  chip.title = st.sync.lastError || '';

  const open = (path) => (e) => { e.preventDefault(); chrome.tabs.create({ url: chrome.runtime.getURL(path) }); window.close(); };
  $('#openST').addEventListener('click', open('insights.html'));
  $('#openTab').addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({}); window.close(); });
  $('#opts').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); window.close(); });
  chip.addEventListener('click', open('options.html#sync'));
  chip.style.cursor = 'pointer';
}

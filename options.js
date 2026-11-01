import {
  load, save, saveShared, uid, toUrl, normalizeDomain, h, $, $$, applyAccent, toast, detectBrowserLabel, ensureBrowserIdentity, DEFAULTS,
  siteIcon, daysBack, usageFor, aggregate, categoryOf, limitUsage, fmtDur, ago, CATEGORIES, CAT_ORDER, notifyBackground,
  lookOf, LOOK, FONTS, UI_FONTS, CLOCK_FONTS, CLOCK_STYLES, WIDGETS, ensureCategories, CAT_COLORS
} from './lib/common.js';
import { icon, hydrateIcons } from './lib/icons.js';
import { updaterState, checkForUpdate, hasUpdate, applyUpdate, pickFolder, getFolder, folderPermission, folderSupported, currentVersion } from './lib/updater.js';
import { renderBackdrop } from './lib/backdrop.js';
import { connect, connectServer, forgetBrowser, normalizeServerUrl, syncOn } from './lib/sync.js';
import { searchCity } from './lib/weather.js';

let S = {};

init();

async function init() {
  await ensureBrowserIdentity();
  S = await load();
  ensureCategories(S.rules);
  applyAccent(S.prefs);
  hydrateIcons();
  renderBackdrop($('#backdrop'), S.prefs);
  $('#ver').textContent = `v${chrome.runtime.getManifest().version}`;
  if (location.hash === '#welcome') $('#welcome').hidden = false;

  fillGeneral();
  fillLook();
  buildCustomiser();
  renderLinks();
  fillTracking();
  renderCatDefs();
  renderCats();
  renderLimits();
  renderSync();
  fillDev();
  fillWeather();
  renderMons();
  renderUpdates();
  dataInfo();
  wire();
  spy();

  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local') return;
    for (const [k, { newValue }] of Object.entries(c)) if (k in DEFAULTS) S[k] = newValue ?? structuredClone(DEFAULTS[k]);
    if (c.sync || c.remote || c.browser) renderSync();
    if (c.links && !dragging) renderLinks();
    if (c.prefs) { applyAccent(S.prefs); fillLook(); if (!czBusy) fillCustomiser(); }
    if (c.rules) { ensureCategories(S.rules); renderCatDefs(); renderCats(); renderLimits(); }
    if (c.updater || c.github) renderUpdates();
  });
}

/* ---------- general ---------- */
function fillGeneral() {
  $('#name').value = S.prefs.name || '';
  $('#engine').value = S.prefs.engine;
  $('#clock24').checked = !!S.prefs.clock24;
  $('#showSeconds').checked = !!S.prefs.showSeconds;
}
async function setPref(patch, msg = 'Saved') {
  S.prefs = { ...S.prefs, ...patch };
  await saveShared('prefs', S.prefs);
  if (msg) toast(msg);
}

/* ---------- look ---------- */
async function fillLook() {
  $$('#bgGrid button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.bg === S.prefs.background)));
  $$('#swatches button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.accent === S.prefs.accent)));
  $('#customSw').classList.toggle('on', S.prefs.accent === 'custom');
  $('#customSw').style.setProperty('--c', S.prefs.accentHex || '#34d399');
  if (document.activeElement !== $('#accentHex')) $('#accentHex').value = S.prefs.accentHex || '#34d399';
  const { bgImage } = await chrome.storage.local.get('bgImage');
  $('#pvCustom').style.backgroundImage = bgImage ? `url("${bgImage}")` : '';
  $('#customHint').textContent = bgImage ? 'click to replace' : 'upload one';
}
async function readImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2560 / bmp.width);
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * scale);
  cv.height = Math.round(bmp.height * scale);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.86);
}

/* ---------- important pages ---------- */
let dragging = null;
function renderLinks() {
  $('#linkList').replaceChildren(...S.links.map((l) => linkRow(l)));
}
function linkRow(l) {
  const li = h('li', { draggable: true, dataset: { id: l.id } },
    h('span', { class: 'grip', title: 'Drag to reorder' }, icon('grip', { size: 16 })),
    h('input', { class: 'input', value: l.title, placeholder: 'Name', maxlength: '24', onchange: (e) => updateLink(l.id, { title: e.target.value.trim() || l.title }) }),
    h('input', { class: 'input', value: l.url, placeholder: 'https://…', onchange: (e) => { const u = toUrl(e.target.value); if (u) updateLink(l.id, { url: u }); else toast('Not a valid URL'); } }),
    h('button', { class: 'rm', type: 'button', 'aria-label': 'Remove', onclick: () => saveLinks(S.links.filter((x) => x.id !== l.id)) }, icon('x', { size: 14 }))
  );
  li.addEventListener('dragstart', () => { dragging = l.id; li.classList.add('dragging'); });
  li.addEventListener('dragend', () => { dragging = null; li.classList.remove('dragging'); renderLinks(); });
  li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('over'); });
  li.addEventListener('dragleave', () => li.classList.remove('over'));
  li.addEventListener('drop', (e) => {
    e.preventDefault(); li.classList.remove('over');
    const list = [...S.links];
    const from = list.findIndex((x) => x.id === dragging);
    const to = list.findIndex((x) => x.id === l.id);
    if (from < 0 || to < 0 || from === to) return;
    list.splice(to, 0, list.splice(from, 1)[0]);
    saveLinks(list);
  });
  return li;
}
async function saveLinks(list) {
  S.links = list.filter((l) => /^https?:\/\/[^/]+/.test(l.url));
  if (!dragging) renderLinks();
  await saveShared('links', S.links);
  toast('Saved');
}
function updateLink(id, patch) { saveLinks(S.links.map((l) => (l.id === id ? { ...l, ...patch } : l))); }

/* ---------- tracking ---------- */
function fillTracking() {
  const t = S.tracking;
  $('#trackOn').checked = !!t.enabled;
  $('#countAudible').checked = !!t.countAudible;
  $('#badge').checked = !!S.prefs.badge;
  $('#idleSec').value = String(t.idleSec || 60);
  $('#excluded').value = (t.excluded || []).join('\n');
}
async function setTracking(patch) {
  S.tracking = { ...S.tracking, ...patch };
  await save({ tracking: S.tracking });
  toast('Saved');
}

/* ---------- categories ---------- */
function catSelect(value, onChange) {
  const sel = h('select', { class: 'input sel' }, ...CAT_ORDER.map((c) => h('option', { value: c, selected: c === value }, CATEGORIES[c].label)));
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}
async function setRules(rules, msg = 'Saved') {
  S.rules = rules;
  await saveShared('rules', rules);
  if (msg) toast(msg);
}
function renderCatDefs() {
  const custom = S.rules.customCats || [];
  const rows = CAT_ORDER.map((id) => {
    const c = CATEGORIES[id];
    const def = custom.find((x) => x.id === id);
    if (!def) return h('li', { class: 'builtin' }, h('span', { class: 'cdot', style: `--c:${c.color}` }), h('span', { class: 't' }, c.label, h('span', { class: 'time' }, c.hint ? `· ${c.hint}` : '')), h('span', { class: 'small dim' }, c.productive ? 'productive' : ''), h('span'));
    const upd = (patch) => setRules({ ...S.rules, customCats: custom.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
    return h('li', { class: 'custom-cat' },
      h('input', { type: 'color', class: 'cpick', value: def.color, 'aria-label': 'Colour', onchange: (e) => upd({ color: e.target.value }) }),
      h('input', { class: 'input', value: def.label, maxlength: '20', onchange: (e) => e.target.value.trim() && upd({ label: e.target.value.trim() }) }),
      h('label', { class: 'small muted chk' }, h('input', { type: 'checkbox', checked: !!def.productive, onchange: (e) => upd({ productive: e.target.checked }) }), ' productive'),
      h('button', { class: 'rm', type: 'button', 'aria-label': `Delete ${def.label}`, onclick: () => {
        if (!confirm(`Delete “${def.label}”? Sites in it go back to their automatic category.`)) return;
        const cats = Object.fromEntries(Object.entries(S.rules.categories || {}).filter(([, v]) => v !== id));
        setRules({ ...S.rules, customCats: custom.filter((x) => x.id !== id), categories: cats }, 'Category deleted');
      } }, icon('x', { size: 14 })));
  });
  $('#catDefs').replaceChildren(...rows);
  $('#ncColor').value = CAT_COLORS[custom.length % CAT_COLORS.length];
}

async function renderCats() {
  const days = daysBack(30);
  const agg = aggregate(await usageFor(days), days);
  const overrides = S.rules.categories || {};
  const domains = [...new Set([...agg.sites.slice(0, 30).map((s) => s.domain), ...Object.keys(overrides)])];
  const secOf = Object.fromEntries(agg.sites.map((s) => [s.domain, s.sec]));
  $('#catList').replaceChildren(...(domains.length ? domains.map((d) => h('li', {},
    siteIcon(`https://${d}`),
    h('span', { class: 't' }, d, secOf[d] ? h('span', { class: 'time' }, fmtDur(secOf[d])) : null, overrides[d] ? h('span', { class: 'time' }, '· custom') : null),
    catSelect(categoryOf(d, S.rules), (v) => setRules({ ...S.rules, categories: { ...S.rules.categories, [d]: v } })),
    overrides[d] ? h('button', { class: 'rm', type: 'button', title: 'Back to automatic', 'aria-label': 'Reset', onclick: () => { const c = { ...S.rules.categories }; delete c[d]; setRules({ ...S.rules, categories: c }, 'Reset to automatic'); } }, icon('refresh', { size: 14 })) : h('span')
  )) : [h('li', { class: 'muted small' }, 'Browse a little and your sites appear here.')]));
  const keep = $('#catNew').value;
  $('#catNew').replaceChildren(...CAT_ORDER.map((c) => h('option', { value: c, selected: c === keep }, CATEGORIES[c].label)));
}

/* ---------- limits ---------- */
async function renderLimits() {
  const days = daysBack(1);
  const today = aggregate(await usageFor(days), days);
  const entries = Object.entries(S.rules.limits || {});
  $('#limList').replaceChildren(...(entries.length ? entries.map(([d, mins]) => {
    const used = limitUsage(today, d, S.rules);
    return h('li', {},
      siteIcon(`https://${d}`),
      h('span', { class: 't' }, d),
      h('span', { class: 'used' + (used >= mins * 60 ? ' over' : '') }, `${fmtDur(used)} today`),
      h('input', { class: 'input num', type: 'number', min: '5', max: '1440', step: '5', value: String(mins), 'aria-label': 'Minutes per day', onchange: (e) => { const m = Math.max(5, Math.min(1440, Number(e.target.value) || 0)); setRules({ ...S.rules, limits: { ...S.rules.limits, [d]: m } }); } }),
      h('button', { class: 'rm', type: 'button', 'aria-label': 'Remove limit', onclick: () => { const l = { ...S.rules.limits }; delete l[d]; setRules({ ...S.rules, limits: l }, 'Limit removed'); } }, icon('x', { size: 14 })));
  }) : [h('li', { class: 'muted small' }, 'No limits yet.')]));
}

/* ---------- sync ---------- */
let showServerForm = false;
function renderSync() {
  const s = S.sync;
  const on = syncOn(s) && !showServerForm;
  const live = s.mode === 'server';
  $('#syncOff').hidden = on;
  $('#syncOn').hidden = !on;
  if (!on) { pickMode(showServerForm ? 'server' : $('#syncMode [aria-pressed="true"]')?.dataset.v || 'server'); if (!$('#srvUrl').value) $('#srvUrl').value = s.url || 'https://sync.cre8ivize.com'; return; }
  const needsKey = !s.key;
  const chip = $('#syncChip');
  $('.dot', chip).className = 'dot ' + (s.lastError ? 'bad' : s.lastSync ? 'ok' : 'warn');
  $('.lbl', chip).textContent = needsKey ? 'Needs passphrase' : s.lastError ? 'Error' : s.lastSync ? (live ? 'Live · encrypted' : 'Connected · encrypted') : 'Connecting…';
  $('#syncWhen').textContent = s.lastSync
    ? (live ? `Your server ${s.url.replace(/^https?:\/\//, '')} · last sync ${ago(s.lastSync)} · updates every minute, the moment you switch browsers, and instantly on open pages`
      : `Last sync ${ago(s.lastSync)} · checks every 10 min; uploads changes right away (screen time every 30 min)`) : '';
  $('#syncErr').hidden = !s.lastError;
  $('#syncErr').textContent = s.lastError;
  $('#syncNote').hidden = !s.note;
  $('#syncNote').textContent = s.note || '';
  $('#reconnect').hidden = live || (!needsKey && !/passphrase/i.test(s.lastError || ''));
  $('#upgradeLive').hidden = live;
  if (document.activeElement !== $('#label')) $('#label').value = S.browser.label || '';
  const gl = $('#gistLink');
  gl.hidden = live || !s.gistId;
  if (s.gistId && !live) gl.href = `https://gist.github.com/${s.gistId}`;
  const rows = [h('li', {}, h('span', {}, `${S.browser.label} `, h('span', { class: 'dim small' }, '(this browser)')), h('span', { class: 'small muted' }, 'live'), h('span'))];
  const others = Object.entries(S.remote || {}).filter(([id]) => id !== S.browser.id).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
  for (const [id, r] of others) {
    const stale = Date.now() - (r.updatedAt || 0) > 3 * 86400000;
    rows.push(h('li', { class: stale ? 'stale' : '' },
      h('span', {}, r.label || 'Browser', stale ? h('span', { class: 'dim small' }, ' · probably an old install') : null),
      h('span', { class: 'small muted' }, `updated ${ago(r.updatedAt)}`),
      h('button', { class: 'rm', type: 'button', title: 'Remove this browser and its screen time', 'aria-label': `Remove ${r.label}`, onclick: async (e) => {
        if (!confirm(`Remove “${r.label}” from sync? Its screen time disappears from every browser. If that browser is still in use, it adds itself back on its next sync.`)) return;
        e.currentTarget.disabled = true;
        try { await forgetBrowser(id); toast(`Removed ${r.label}`); } catch (err) { toast(err.message || 'Couldn’t remove it'); e.currentTarget.disabled = false; }
      } }, icon('x', { size: 14 }))));
  }
  if (rows.length === 1) rows.push(h('li', {}, h('span', { class: 'muted small' }, 'No other browser yet. Connect it with the same details and passphrase.'), h('span'), h('span')));
  $('#syncList').replaceChildren(...rows);
}
function pickMode(m) {
  segSelect($('#syncMode'), m);
  for (const ol of $$('#syncOff .steps')) ol.hidden = ol.dataset.mode !== m;
}
async function doConnectServer(btn) {
  const url = normalizeServerUrl($('#srvUrl').value);
  const secret = $('#srvToken').value.trim();
  const pass = $('#srvPass').value;
  if (!url) { toast('Enter your server’s address'); return; }
  if (secret.length < 24) { toast('Paste the token the server printed (ns_…)'); return; }
  if (pass.length < 8) { toast('Passphrase needs at least 8 characters'); return; }
  // Hosts other than *.cre8ivize.com need permission first (must happen right after the click).
  const origin = new URL(url).origin + '/*';
  if (!(await chrome.permissions.contains({ origins: [origin] }))) {
    const ok = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
    if (!ok) { toast('Nightshift needs permission to reach that server'); return; }
  }
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Connecting…';
  try {
    const r = await connectServer(url, secret, pass);
    showServerForm = false;
    const res = await notifyBackground('sync:now', { force: true });
    const n = res?.data?.browsers || 1;
    toast(r.joined ? `Live sync on · ${n} browser${n === 1 ? '' : 's'}` : 'Live sync on. Now connect your other browser.');
    $('#srvToken').value = ''; $('#srvPass').value = '';
  } catch (e) {
    toast(e.message || 'Couldn’t connect');
  } finally { btn.disabled = false; btn.textContent = label; }
}
async function doConnect(token, pass, btn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Encrypting…';
  try {
    const r = await connect(token, pass);
    const res = await notifyBackground('sync:now', { force: true });
    const n = res?.data?.browsers || 1;
    toast(r.joined ? (n > 1 ? `Connected — ${n} browsers in sync` : 'Connected to your encrypted gist') : 'Encrypted gist created — now connect your other browser');
    $('#token').value = ''; $('#pass').value = ''; $('#pass2').value = '';
  } catch (e) {
    toast(e.message || 'Couldn’t connect');
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

/* ---------- dev & weather ---------- */
function fillDev() {
  $('#repos').value = (S.prefs.repos || []).join('\n');
  $('#ghToken').placeholder = S.github.token ? '•••••••• (saved)' : 'ghp_…';
  $('#ghState').textContent = S.github.token ? 'Using the token saved here.' : S.sync.mode !== 'server' && S.sync.token ? 'Using your sync token.' : 'No token: public repos only (60 requests/hour).';
}
function fillWeather() {
  const w = S.prefs.weather || {};
  $('#wxOn').checked = w.on !== false;
  $('#wxF').checked = w.units === 'f';
  $('#city').value = w.city || '';
  $('#city').placeholder = w.city ? '' : 'Using your location — search a city to pin one';
}
async function setWeather(patch, msg) {
  await setPref({ weather: { ...S.prefs.weather, ...patch } }, msg);
  await chrome.storage.local.remove('weatherCache');
}

/* ---------- servers ---------- */
function renderMons() {
  $('#monList').replaceChildren(...S.monitors.map((m, i) => h('li', {},
    h('span', { class: 'grip' }, icon('server', { size: 14 })),
    h('input', { class: 'input', value: m.name, placeholder: 'Name', onchange: (e) => setMon(i, { name: e.target.value.trim() || m.name }) }),
    h('input', { class: 'input', value: m.url, placeholder: 'https://…/healthz', onchange: (e) => { const u = toUrl(e.target.value); if (u) setMon(i, { url: u }); } }),
    h('button', { class: 'rm', type: 'button', 'aria-label': 'Remove', onclick: () => saveMons(S.monitors.filter((_, j) => j !== i)) }, icon('x', { size: 14 }))
  )));
}
async function saveMons(list) { S.monitors = list; renderMons(); await save({ monitors: list, monitorCache: null }); toast('Saved'); }
function setMon(i, patch) { saveMons(S.monitors.map((m, j) => (j === i ? { ...m, ...patch } : m))); }

/* ---------- data ---------- */
async function dataInfo() {
  const all = await chrome.storage.local.get(null);
  const days = Object.keys(all).filter((k) => k.startsWith('u:')).sort();
  const bytes = await chrome.storage.local.getBytesInUse(null);
  $('#dataInfo').textContent = days.length
    ? `${days.length} day${days.length === 1 ? '' : 's'} of screen time since ${days[0].slice(2)} · ${(bytes / 1024).toFixed(0)} KB on this device. History older than 120 days is removed automatically.`
    : 'No screen-time history yet.';
}

/* ---------- wiring ---------- */
function wire() {
  $('#name').addEventListener('change', (e) => setPref({ name: e.target.value.trim() }));
  $('#engine').addEventListener('change', (e) => setPref({ engine: e.target.value }));
  $('#clock24').addEventListener('change', (e) => setPref({ clock24: e.target.checked }, ''));
  $('#showSeconds').addEventListener('change', (e) => setPref({ showSeconds: e.target.checked }, ''));
  $('#accentHex').addEventListener('input', (e) => {
    S.prefs = { ...S.prefs, accent: 'custom', accentHex: e.target.value };
    applyAccent(S.prefs);
    $('#customSw').style.setProperty('--c', e.target.value);
    $$('#swatches button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    $('#customSw').classList.add('on');
    queueSave();
  });
  $('#ncAdd').addEventListener('click', () => {
    const label = $('#ncName').value.trim();
    if (!label) { toast('Name the category'); return; }
    const list = S.rules.customCats || [];
    if (Object.values(CATEGORIES).some((c) => c.label.toLowerCase() === label.toLowerCase())) { toast('You already have that one'); return; }
    setRules({ ...S.rules, customCats: [...list, { id: `c_${uid().slice(0, 8)}`, label, color: $('#ncColor').value, productive: $('#ncProd').checked }] }, `Added ${label}`);
    $('#ncName').value = ''; $('#ncProd').checked = false;
  });
  $('#ncName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#ncAdd').click(); });

  $$('#bgGrid button').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.bg === 'custom') {
      const { bgImage } = await chrome.storage.local.get('bgImage');
      if (!bgImage || S.prefs.background === 'custom') { $('#bgFile').click(); return; }
    }
    await setPref({ background: b.dataset.bg }, '');
    renderBackdrop($('#backdrop'), S.prefs);
  }));
  $('#bgFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      await chrome.storage.local.set({ bgImage: await readImage(f) });
      await setPref({ background: 'custom' }, 'Background changed');
      renderBackdrop($('#backdrop'), S.prefs);
      fillLook();
    } catch { toast('Couldn’t read that image'); }
    e.target.value = '';
  });
  $$('#swatches button').forEach((b) => b.addEventListener('click', async () => {
    await setPref({ accent: b.dataset.accent }, '');
    applyAccent(S.prefs);
    fillLook();
    renderBackdrop($('#backdrop'), S.prefs);
  }));

  $('#addLink').addEventListener('click', () => {
    const l = { id: uid(), title: 'New page', url: 'https://' };
    S.links = [...S.links, l];
    $('#linkList').append(linkRow(l));
    const inputs = $$('#linkList li:last-child input');
    inputs[1].focus(); inputs[1].select();
  });

  $('#trackOn').addEventListener('change', (e) => setTracking({ enabled: e.target.checked }));
  $('#countAudible').addEventListener('change', (e) => setTracking({ countAudible: e.target.checked }));
  $('#idleSec').addEventListener('change', (e) => setTracking({ idleSec: Number(e.target.value) }));
  $('#excluded').addEventListener('change', (e) => setTracking({ excluded: [...new Set(e.target.value.split(/[\n,]/).map(normalizeDomain).filter(Boolean))] }));
  $('#badge').addEventListener('change', (e) => setPref({ badge: e.target.checked }));

  $('#catAdd').addEventListener('click', () => {
    const d = normalizeDomain($('#catDomain').value);
    if (!d) { toast('Enter a site like example.com'); return; }
    setRules({ ...S.rules, categories: { ...S.rules.categories, [d]: $('#catNew').value } });
    $('#catDomain').value = '';
  });
  $('#limAdd').addEventListener('click', () => {
    const d = normalizeDomain($('#limDomain').value);
    const m = Number($('#limMins').value);
    if (!d) { toast('Enter a site like youtube.com'); return; }
    if (!(m >= 5)) { toast('Set at least 5 minutes'); return; }
    setRules({ ...S.rules, limits: { ...S.rules.limits, [d]: Math.min(1440, Math.round(m)) } }, 'Limit added');
    $('#limDomain').value = ''; $('#limMins').value = '';
  });

  $('#connect').addEventListener('click', (e) => {
    const token = $('#token').value.trim();
    const pass = $('#pass').value;
    if (!/^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$/.test(token)) { toast('That doesn’t look like a GitHub token'); return; }
    if (pass.length < 8) { toast('Passphrase needs at least 8 characters'); return; }
    doConnect(token, pass, e.currentTarget);
  });
  $('#reconnectBtn').addEventListener('click', (e) => {
    const pass = $('#pass2').value;
    if (pass.length < 8) { toast('Passphrase needs at least 8 characters'); return; }
    doConnect(S.sync.token, pass, e.currentTarget);
  });
  $('#syncMode').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) pickMode(b.dataset.v); });
  $('#srvConnect').addEventListener('click', (e) => doConnectServer(e.currentTarget));
  $('#goLive').addEventListener('click', () => { showServerForm = true; renderSync(); $('#srvUrl').focus(); });
  $('#syncNow').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = 'Syncing…';
    const res = await notifyBackground('sync:now', { force: true });
    b.disabled = false; b.textContent = 'Sync now';
    toast(res?.data?.ok ? 'Synced' : 'Sync failed — see the message above');
  });
  $('#disconnect').addEventListener('click', async () => {
    if (!confirm('Stop syncing this browser? Your data stays here and (encrypted) on the server or gist.')) return;
    await save({ sync: { ...DEFAULTS.sync }, remote: {} });
    toast('Sync turned off');
  });
  $('#label').addEventListener('change', async (e) => {
    const label = e.target.value.trim() || (await detectBrowserLabel());
    await save({ browser: { ...S.browser, label, labelAuto: false } });
    notifyBackground('sync:now', { force: true });
    toast('Renamed');
  });

  $('#repos').addEventListener('change', async (e) => {
    const repos = [...new Set(e.target.value.split(/[\n,\s]+/).map((x) => x.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '')).filter((x) => /^[\w.-]+\/[\w.-]+$/.test(x)))];
    e.target.value = repos.join('\n');
    await chrome.storage.local.remove('ghCache');
    setPref({ repos });
  });
  $('#ghToken').addEventListener('change', async (e) => {
    const token = e.target.value.trim();
    if (token && !/^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$/.test(token)) { toast('That doesn’t look like a GitHub token'); return; }
    S.github = { token };
    await save({ github: S.github });
    await chrome.storage.local.remove('ghCache');
    e.target.value = '';
    fillDev();
    toast(token ? 'Token saved on this device' : 'Token removed');
  });

  $('#wxOn').addEventListener('change', (e) => setWeather({ on: e.target.checked }));
  $('#wxF').addEventListener('change', (e) => setWeather({ units: e.target.checked ? 'f' : 'c' }));
  let ct;
  $('#city').addEventListener('input', (e) => {
    clearTimeout(ct);
    const q = e.target.value.trim();
    if (q.length < 2) { $('#cityResults').replaceChildren(); return; }
    ct = setTimeout(async () => {
      try {
        const res = await searchCity(q);
        $('#cityResults').replaceChildren(...res.map((r) => h('li', { onclick: async () => {
          $('#city').value = r.name;
          $('#cityResults').replaceChildren();
          await setWeather({ city: r.name, lat: r.lat, lon: r.lon }, `Weather set to ${r.name}`);
        } }, h('span', {}, r.name), h('span', { class: 'small muted' }, r.detail))));
      } catch { $('#cityResults').replaceChildren(h('li', {}, h('span', { class: 'muted small' }, 'Couldn’t search right now'), h('span'))); }
    }, 300);
  });
  $('#cityClear').addEventListener('click', async () => {
    $('#city').value = '';
    $('#cityResults').replaceChildren();
    await setWeather({ city: '', lat: null, lon: null }, 'Using your location');
    fillWeather();
  });

  $('#addMon').addEventListener('click', () => saveMons([...S.monitors, { name: 'New server', url: 'https://' }]));

  $('#openStartup').addEventListener('click', async () => {
    const brave = (await detectBrowserLabel()) === 'Brave';
    chrome.tabs.create({ url: brave ? 'brave://settings/getStarted' : 'chrome://settings/onStartup' });
  });

  $('#export').addEventListener('click', async () => {
    const all = await chrome.storage.local.get(null);
    for (const k of ['sync', 'github', 'bgImage', 'ghCache', 'weatherCache', 'geo']) delete all[k]; // never export tokens or keys
    const blob = new Blob([JSON.stringify({ app: 'nightshift', version: 2, exported: new Date().toISOString(), data: all })], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `nightshift-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      if (json?.app !== 'nightshift' || typeof json.data !== 'object') throw new Error('Not a Nightshift export');
      const keep = {};
      for (const [k, v] of Object.entries(json.data)) if (k in DEFAULTS || k.startsWith('u:')) keep[k] = v;
      for (const k of ['sync', 'browser', 'github']) delete keep[k];
      await save(keep);
      toast('Imported — reloading');
      setTimeout(() => location.reload(), 700);
    } catch (err) { toast(`Import failed: ${err.message}`); }
  });
  $('#wipe').addEventListener('click', async () => {
    if (!confirm('Delete all screen-time history on this browser? Synced copies in other browsers are not affected until they next sync.')) return;
    const all = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('u:')));
    toast('Screen-time history cleared');
    dataInfo();
  });
}

function spy() {
  const links = $$('#nav a');
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${en.target.id}`));
  }, { rootMargin: '-30% 0px -60% 0px' });
  $$('main > section[id]').forEach((s) => io.observe(s));
  if (location.hash && location.hash !== '#welcome') setTimeout(() => $(location.hash)?.scrollIntoView({ behavior: 'smooth' }), 300);
}

/* ---------- customiser ----------
   Every control writes prefs.look; the preview (a real new tab in an iframe) and every open new tab
   pick it up through storage.onChanged, so changes show up live everywhere. */
let czBusy = false;
let saveTimer = null;
function look() { return lookOf(S.prefs); }
function queueSave() {
  czBusy = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await saveShared('prefs', S.prefs);
    czBusy = false;
    const el = $('#czSaved');
    el.textContent = 'Saved';
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }, 90);
}
function setLook(patch) {
  const cur = look();
  S.prefs = { ...S.prefs, look: { ...cur, ...patch, widgets: { ...cur.widgets, ...(patch.widgets || {}) } } };
  applyAccent(S.prefs);
  fillCustomiser();
  queueSave();
}

function segSelect(root, value) {
  for (const b of $$('button', root)) b.setAttribute('aria-pressed', String(b.dataset.v === value));
}

function buildCustomiser() {
  // styles
  const sample = { roll: '19:18', flip: '19:18', fade: '19:18', stack: '19\n18', analog: '', words: 'quarter past seven' };
  $('#styleGrid').replaceChildren(...Object.entries(CLOCK_STYLES).map(([k, label]) => h('button', { type: 'button', dataset: { v: k }, onclick: () => setLook({ clockStyle: k }) },
    h('span', { class: `sp sp-${k}` }, k === 'analog' ? h('i', { class: 'face' }, h('i', { class: 'hh' }), h('i', { class: 'mh' })) : k === 'flip' ? ['1', '9', '1', '8'].map((d) => h('b', {}, d)) : sample[k]),
    h('span', { class: 'sl' }, label))));
  $('#clockFonts').replaceChildren(...CLOCK_FONTS.map((k) => h('button', { type: 'button', dataset: { v: k }, style: `--f:${FONTS[k].family};--fs:${FONTS[k].italic ? 'italic' : 'normal'}`, onclick: () => setLook({ clockFont: k }) },
    h('span', { class: 'fs' }, '19:18'), h('span', { class: 'fl' }, FONTS[k].label))));
  $('#uiFonts').replaceChildren(...UI_FONTS.map((k) => h('button', { type: 'button', dataset: { v: k }, style: `--f:${FONTS[k].family}`, onclick: () => setLook({ uiFont: k }) },
    h('span', { class: 'fs' }, 'Good evening'), h('span', { class: 'fl' }, FONTS[k].label))));
  $('#widgets').replaceChildren(...Object.entries(WIDGETS).map(([k, label]) => h('label', { class: 'wchip' },
    h('input', { type: 'checkbox', dataset: { w: k }, onchange: (e) => setLook({ widgets: { [k]: e.target.checked } }) }), h('span', {}, icon('check', { size: 13 }), label))));

  for (const [id, key, fmt, num] of [
    ['clockWeight', 'clockWeight', (v) => v, true], ['clockSize', 'clockSize', (v) => `${Math.round(v * 100)}%`, true],
    ['glass', 'glass', (v) => `${v}%`, true], ['blur', 'blur', (v) => `${v}px`, true], ['radius', 'radius', (v) => `${v}px`, true], ['dim', 'dim', (v) => `${v}%`, true]
  ]) {
    $(`#${id}`).addEventListener('input', (e) => { const v = num ? Number(e.target.value) : e.target.value; $(`#${id}V`).textContent = fmt(v); setLook({ [key]: v }); });
  }
  for (const [id, key] of [['clockColor', 'clockColor'], ['density', 'density'], ['motion', 'motion'], ['layoutGrid', 'layout']]) {
    $(`#${id}`).addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) setLook({ [key]: b.dataset.v }); });
  }
  $('#showDate').addEventListener('change', (e) => setLook({ showDate: e.target.checked }));
  $('#grain').addEventListener('change', (e) => setLook({ grain: e.target.checked }));
  $('#czReset').addEventListener('click', () => {
    if (!confirm('Reset fonts, clock, cards and layout to the defaults? (Background and accent stay.)')) return;
    S.prefs = { ...S.prefs, look: structuredClone(LOOK) };
    applyAccent(S.prefs); fillCustomiser(); queueSave();
  });

  // tabs with a sliding indicator
  const tabs = $('#czTabs');
  const moveInd = () => {
    const on = $('[aria-selected="true"]', tabs);
    const ind = $('.seg-ind', tabs);
    ind.style.width = `${on.offsetWidth}px`;
    ind.style.transform = `translateX(${on.offsetLeft - 4}px)`;
  };
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    $$('button', tabs).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    for (const p of $$('.cz-panel')) {
      const show = p.dataset.panel === b.dataset.tab;
      if (show && p.hidden) { p.hidden = false; p.classList.remove('enter'); void p.offsetWidth; p.classList.add('enter'); } else if (!show) p.hidden = true;
    }
    moveInd();
  });
  requestAnimationFrame(moveInd);
  addEventListener('resize', moveInd);
  document.fonts?.ready.then(moveInd);

  // the preview iframe is a full-size new tab, scaled to fit
  const frame = $('#pvFrame');
  const iframe = $('#pvIframe');
  const fit = () => {
    const W = 1440, H = 860;
    const scale = frame.clientWidth / W;
    iframe.style.width = `${W}px`; iframe.style.height = `${H}px`;
    iframe.style.transform = `scale(${scale})`;
    frame.style.height = `${H * scale}px`;
  };
  new ResizeObserver(fit).observe(frame);
  fit();
  // Listen first, then load: a cached new tab can finish loading before this code runs,
  // and the preview would stay hidden. A timer is the last resort.
  const ready = () => frame.classList.add('ready');
  iframe.addEventListener('load', ready, { once: true });
  iframe.src = 'newtab.html?preview';
  setTimeout(ready, 1500);

  fillCustomiser();
}

function fillCustomiser() {
  const l = look();
  segSelect($('#styleGrid'), l.clockStyle);
  segSelect($('#clockFonts'), l.clockFont);
  segSelect($('#uiFonts'), l.uiFont);
  segSelect($('#clockColor'), l.clockColor);
  segSelect($('#density'), l.density);
  segSelect($('#motion'), l.motion);
  segSelect($('#layoutGrid'), l.layout);
  for (const [id, fmt] of [['clockWeight', (v) => v], ['clockSize', (v) => `${Math.round(v * 100)}%`], ['glass', (v) => `${v}%`], ['blur', (v) => `${v}px`], ['radius', (v) => `${v}px`], ['dim', (v) => `${v}%`]]) {
    const el = $(`#${id}`);
    if (document.activeElement !== el) el.value = String(l[id]);
    $(`#${id}V`).textContent = fmt(l[id]);
  }
  $('#clock24').checked = !!S.prefs.clock24;
  $('#showSeconds').checked = !!S.prefs.showSeconds;
  $('#showDate').checked = l.showDate !== false;
  $('#grain').checked = !!l.grain;
  for (const cb of $$('#widgets input')) cb.checked = l.widgets[cb.dataset.w] !== false;
  // the font weight slider only makes sense for fonts that have weights
  $('#clockWeight').disabled = l.clockFont === 'serif';
}

/* ---------- updates ---------- */
async function renderUpdates() {
  const st = await updaterState();
  $('#updVer').replaceChildren(`v${currentVersion()}`);
  for (const [id, k] of [['updRepo', 'repo'], ['updBranch', 'branch'], ['updDir', 'dir']]) if (document.activeElement !== $(`#${id}`)) $(`#${id}`).value = st[k] || '';
  $('#updAuto').checked = st.auto !== false;
  $('#updToken').textContent = S.github?.token ? 'Uses the Dev card token saved on this device. It needs read access to the repo (classic token with “repo”, or a fine-grained one with Contents: read).'
    : S.sync?.token ? 'Uses your sync token. If it only has the “gist” scope, add a Dev card token with “repo” access (Dev card section above).'
      : 'No token yet: add one in the Dev card section (needs “repo” access for a private repo).';

  const box = $('#updStatus');
  const l = st.latest;
  const avail = hasUpdate(st);
  box.className = 'upd-status' + (st.lastError ? ' bad' : avail ? ' new' : l ? ' ok' : '');
  box.replaceChildren(
    icon(st.lastError ? 'alert' : avail ? 'download' : l ? 'check' : 'refresh', { size: 16 }),
    h('div', {},
      h('b', {}, st.lastError ? 'Couldn’t check' : avail ? `Version ${l.version} is ready` : l ? 'You’re up to date' : 'Not checked yet'),
      h('span', { class: 'small muted' }, st.lastError || (l ? `${st.repo}@${(l.sha || '').slice(0, 7)}${l.message ? ` · “${l.message}”` : ''} · checked ${ago(st.lastCheck)}` : 'Click “Check now”.'))));
  $('#updNow').disabled = !avail;

  $('#updBrave').hidden = folderSupported();
  $('#updPick').disabled = !folderSupported();
  const dir = await getFolder();
  const perm = await folderPermission(dir);
  $('#updFolder').textContent = !dir ? 'Not linked yet: pick the folder you loaded in chrome://extensions.'
    : perm === 'granted' ? `Linked: “${dir.name}” · access granted` : `Linked: “${dir.name}” · Chrome will ask for access when updating`;
}

function wireUpdates() {
  const saveUpd = async (patch) => { const { updater } = await load(['updater']); await save({ updater: { ...updater, ...patch, latest: null, lastCheck: 0 } }); };
  $('#updRepo').addEventListener('change', (e) => saveUpd({ repo: e.target.value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '') }));
  $('#updBranch').addEventListener('change', (e) => saveUpd({ branch: e.target.value.trim() || 'main' }));
  $('#updDir').addEventListener('change', (e) => saveUpd({ dir: e.target.value.trim().replace(/^\/+|\/+$/g, '') }));
  $('#updAuto').addEventListener('change', async (e) => { const { updater } = await load(['updater']); await save({ updater: { ...updater, auto: e.target.checked } }); toast('Saved'); });
  $('#updPick').addEventListener('click', async () => {
    try { await pickFolder(); toast('Folder linked'); renderUpdates(); } catch (e) { if (e.name !== 'AbortError') toast(e.message); }
  });
  $('#updCheck').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    await checkForUpdate({ force: true });
    b.disabled = false; renderUpdates();
  });
  $('#updNow').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      if (!(await getFolder())) { await pickFolder(); }
      const r = await applyUpdate({ interactive: true, onProgress: (m) => ($('#updProg').textContent = m) });
      $('#updProg').textContent = `Installed ${r.version} (${r.changed} file${r.changed === 1 ? '' : 's'} changed). Restarting…`;
      const { justUpdated } = await chrome.storage.local.get('justUpdated');
      await save({ justUpdated: { ...justUpdated, reopen: 'options.html#updates', seen: true } });
      notifyBackground('update:reload');
    } catch (err) {
      $('#updProg').textContent = '';
      if (err.name !== 'AbortError') toast(err.message || 'Update failed');
      b.disabled = false;
      renderUpdates();
    }
  });
}
wireUpdates();

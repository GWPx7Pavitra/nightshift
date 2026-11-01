// Ctrl/⌘+K command palette: open tabs, important pages, bookmarks, history and actions in one box.
import { h, $, siteIcon, hostOf } from './common.js';

const DAY = 86400000;

function score(text, q) {
  const t = text.toLowerCase();
  const i = t.indexOf(q);
  if (i < 0) {
    // loose subsequence match
    let j = 0;
    for (const ch of t) if (ch === q[j]) j++;
    return j === q.length ? 1 : 0;
  }
  if (i === 0) return 10;
  if (/[\s/.\-_:]/.test(t[i - 1])) return 6;
  return 3;
}

export function createPalette({ getLinks, actions }) {
  const input = h('input', { class: 'pal-input', placeholder: 'Jump to a tab, page, bookmark or history…', 'aria-label': 'Command palette', autocomplete: 'off', spellcheck: false });
  const list = h('ul', { class: 'pal-list', role: 'listbox' });
  const foot = h('div', { class: 'pal-foot small dim' }, h('span', {}, h('kbd', {}, '↑↓'), ' move'), h('span', {}, h('kbd', {}, '↵'), ' open'), h('span', {}, h('kbd', {}, 'esc'), ' close'));
  const box = h('div', { class: 'pal', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'pal-top' }, h('span', { class: 'pal-k' }, '⌘K'), input), list, foot);
  const overlay = h('div', { class: 'pal-overlay', hidden: true, onclick: (e) => { if (e.target === overlay) close(); } }, box);
  document.body.append(overlay);

  let items = [];
  let sel = 0;
  let seq = 0;

  async function gather(q) {
    const my = ++seq;
    const ql = q.trim().toLowerCase();
    const out = [];
    for (const a of actions(q)) if (!ql || score(a.title, ql) || a.always) out.push({ ...a, group: 'Actions', s: a.always ? 1 : score(a.title, ql) });
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (!t.url || t.url.startsWith(chrome.runtime.getURL(''))) continue;
      const s = ql ? Math.max(score(t.title || '', ql), score(t.url, ql)) : 1;
      if (s) out.push({ group: 'Open tabs', title: t.title || t.url, sub: hostOf(t.url), url: t.url, s: s + 2, run: () => { chrome.tabs.update(t.id, { active: true }); chrome.windows.update(t.windowId, { focused: true }); } });
    }
    for (const l of getLinks()) {
      const s = ql ? Math.max(score(l.title, ql), score(l.url, ql)) : 1;
      if (s) out.push({ group: 'Important pages', title: l.title, sub: hostOf(l.url), url: l.url, s: s + 3 });
    }
    if (ql) {
      const [bm, hist] = await Promise.all([
        chrome.bookmarks ? chrome.bookmarks.search(ql).catch(() => []) : [],
        chrome.history ? chrome.history.search({ text: ql, maxResults: 25, startTime: Date.now() - 120 * DAY }).catch(() => []) : []
      ]);
      for (const b of bm.slice(0, 8)) if (b.url) out.push({ group: 'Bookmarks', title: b.title || b.url, sub: hostOf(b.url), url: b.url, s: Math.max(score(b.title || '', ql), score(b.url, ql)) + 1 });
      const seen = new Set(out.map((o) => o.url));
      for (const x of hist) if (x.url && !seen.has(x.url)) { seen.add(x.url); out.push({ group: 'History', title: x.title || x.url, sub: hostOf(x.url), url: x.url, s: Math.max(score(x.title || '', ql), score(x.url, ql)) + Math.min(2, Math.log10((x.visitCount || 1) + 1)) }); }
    }
    if (my !== seq) return;
    // With a query, real matches come first and actions last; empty, the actions lead.
    const order = ql ? ['Important pages', 'Open tabs', 'Bookmarks', 'History', 'Actions'] : ['Actions', 'Open tabs', 'Important pages'];
    const limit = { Actions: 4, 'Open tabs': ql ? 6 : 8, 'Important pages': ql ? 5 : 10, Bookmarks: 5, History: 8 };
    items = [];
    for (const g of order) items.push(...out.filter((o) => o.group === g).sort((a, b) => b.s - a.s).slice(0, limit[g]));
    sel = 0;
    render();
  }

  function render() {
    const nodes = [];
    let last = '';
    items.forEach((it, i) => {
      if (it.group !== last) { nodes.push(h('li', { class: 'pal-group', role: 'presentation' }, it.group)); last = it.group; }
      const li = h('li', { class: 'pal-item' + (i === sel ? ' on' : ''), role: 'option', 'aria-selected': String(i === sel), onmousemove: () => { if (sel !== i) { sel = i; mark(); } }, onclick: () => go(i) },
        it.url ? siteIcon(it.url, { cls: 'fav' }) : h('span', { class: 'pal-ico' }, it.icon || '›'),
        h('span', { class: 'pal-t' }, it.title),
        it.sub ? h('span', { class: 'pal-sub' }, it.sub) : null);
      li.dataset.i = i;
      nodes.push(li);
    });
    if (!items.length) nodes.push(h('li', { class: 'pal-empty' }, 'Nothing found'));
    list.replaceChildren(...nodes);
  }
  function mark() {
    list.querySelectorAll('.pal-item').forEach((li) => { const on = Number(li.dataset.i) === sel; li.classList.toggle('on', on); li.setAttribute('aria-selected', String(on)); if (on) li.scrollIntoView({ block: 'nearest' }); });
  }
  function go(i) {
    const it = items[i];
    if (!it) return;
    close();
    if (it.run) it.run(input.value);
    else if (it.url) location.href = it.url;
  }

  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => gather(input.value), 60); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });

  function open(prefill = '') {
    overlay.hidden = false;
    input.value = prefill;
    gather(prefill);
    requestAnimationFrame(() => input.focus());
  }
  function close() { overlay.hidden = true; }
  return { open, close, get isOpen() { return !overlay.hidden; } };
}

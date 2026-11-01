// The new tab clock in six styles. createClock(root) → { render(prefs, look, reset) }, called every second.
import { h, $ } from './common.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

function parts(prefs, now = new Date()) {
  let hr = now.getHours();
  let ampm = '';
  if (!prefs.clock24) { ampm = hr < 12 ? 'AM' : 'PM'; hr = hr % 12 || 12; }
  const hh = prefs.clock24 ? String(hr).padStart(2, '0') : String(hr);
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return { now, hh, mm, ss, ampm, text: `${hh}:${mm}` };
}

/* ---------- rolling digits (also used by "stacked") ---------- */
function rollSlot(colon) {
  return colon
    ? h('span', { class: 'slot colon', 'aria-hidden': 'true' }, h('i'), h('i'))
    : h('span', { class: 'slot' }, h('span', { class: 'sizer' }, '0'));
}
function setRoll(root, text, animate) {
  const chars = [...text];
  while (root.children.length > chars.length) root.lastElementChild.remove();
  chars.forEach((ch, i) => {
    const isColon = ch === ':';
    let slot = root.children[i];
    if (slot && slot.classList.contains('colon') !== isColon) { const nu = rollSlot(isColon); slot.replaceWith(nu); slot = nu; }
    if (!slot) { slot = rollSlot(isColon); root.append(slot); }
    if (isColon || slot.dataset.v === ch) return;
    const old = $('.dg:not(.out)', slot);
    const nu = h('span', { class: 'dg' + (animate && old ? ' in' : '') }, ch);
    slot.append(nu);
    if (old) { if (animate) { old.classList.add('out'); setTimeout(() => old.remove(), 800); } else old.remove(); }
    slot.dataset.v = ch;
  });
}

/* ---------- split-flap ---------- */
function flipCard() {
  return h('span', { class: 'flip' },
    h('span', { class: 'half top' }, h('b')),
    h('span', { class: 'half bot' }, h('b')));
}
function setFlip(card, ch, animate) {
  if (card.dataset.v === ch) return;
  const old = card.dataset.v ?? ch;
  card.dataset.v = ch;
  const [top, bot] = [$('.top b', card), $('.bot b', card)];
  if (!animate || old === ch) { top.textContent = ch; bot.textContent = ch; return; }
  top.textContent = ch;            // the new top waits behind the falling flap
  bot.textContent = old;           // the old bottom stays until the new one lands
  const fall = h('span', { class: 'half top flap fall' }, h('b', {}, old));
  const land = h('span', { class: 'half bot flap land' }, h('b', {}, ch));
  card.append(fall, land);
  setTimeout(() => { bot.textContent = ch; fall.remove(); land.remove(); }, 620);
}
function setFlipRow(root, text, animate) {
  const chars = [...text];
  const want = chars.map((c) => (c === ':' ? 'colon' : 'flip'));
  const have = [...root.children].map((c) => (c.classList.contains('colon') ? 'colon' : 'flip'));
  if (want.join() !== have.join()) {
    root.replaceChildren(...want.map((w) => (w === 'colon' ? rollSlot(true) : flipCard())));
    animate = false;
  }
  chars.forEach((ch, i) => { if (ch !== ':') setFlip(root.children[i], ch, animate); });
}

/* ---------- words ---------- */
const NUM = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export function timeInWords(d = new Date()) {
  const m = d.getMinutes();
  const hr = d.getHours();
  const hourWord = (x) => {
    const h24 = ((x % 24) + 24) % 24;
    if (h24 === 0) return 'midnight';
    if (h24 === 12) return 'noon';
    return NUM[h24 % 12];
  };
  const phraseAt = (mark) => { // mark: minutes 0..60, a multiple of 5
    const hw = hourWord(mark > 30 ? hr + 1 : hr);
    const r = mark % 60;
    if (r === 0) return /midnight|noon/.test(hw) ? hw : `${hw} o’clock`;
    if (r === 15) return `quarter past ${hw}`;
    if (r === 30) return `half past ${hw}`;
    if (r === 45) return `quarter to ${hw}`;
    if (r < 30) return `${['', 'five', 'ten', '', 'twenty', 'twenty-five'][r / 5]} past ${hw}`;
    return `${['', '', '', '', '', '', '', 'twenty-five', 'twenty', '', 'ten', 'five'][r / 5]} to ${hw}`;
  };
  const off = m % 5;
  if (off === 0) return phraseAt(m);
  const next = m - off + 5;
  // Before the half hour "just after ten past" reads well; after it, "almost five to" does.
  if (off <= 2 && m < 33) return `just after ${phraseAt(m - off)}`;
  return `almost ${phraseAt(next)}`;
}

/* ---------- analog ---------- */
function analogFace() {
  const s = svg('svg', { viewBox: '0 0 200 200', class: 'analog-svg' });
  s.append(svg('circle', { cx: 100, cy: 100, r: 96, class: 'face' }));
  for (let i = 0; i < 60; i++) {
    const big = i % 5 === 0;
    const a = (i * 6 * Math.PI) / 180;
    const r1 = big ? 80 : 86, r2 = 90;
    s.append(svg('line', { x1: 100 + r1 * Math.sin(a), y1: 100 - r1 * Math.cos(a), x2: 100 + r2 * Math.sin(a), y2: 100 - r2 * Math.cos(a), class: big ? 'tk big' : 'tk' }));
  }
  const hand = (cls, len, tail) => {
    const g = svg('g', { class: `hand ${cls}` });
    g.append(svg('line', { x1: 100, y1: 100 + tail, x2: 100, y2: 100 - len }));
    return g;
  };
  s.append(hand('hr', 46, 8), hand('mn', 70, 10), hand('sc', 78, 18), svg('circle', { cx: 100, cy: 100, r: 4.5, class: 'pin' }));
  return s;
}

/* ---------- the clock ---------- */
export function createClock(root) {
  let style = '';
  let secDeg = null;
  let lastSec = null;
  let wordsShown = '';

  function build(look) {
    style = look.clockStyle;
    secDeg = null; lastSec = null; wordsShown = '';
    [...root.classList].forEach((c) => c.startsWith('cs-') && root.classList.remove(c));
    root.classList.add(`cs-${style}`);
    const extras = () => [h('span', { class: 'sec' }), h('span', { class: 'ampm' })];
    if (style === 'roll' || style === 'fade') root.replaceChildren(h('span', { class: 'digits' }), ...extras());
    else if (style === 'flip') root.replaceChildren(h('span', { class: 'digits flips' }), ...extras());
    else if (style === 'stack') root.replaceChildren(h('span', { class: 'stack-rows' }, h('span', { class: 'digits row-h' }), h('span', { class: 'digits row-m' })), h('span', { class: 'stack-side' }, ...extras()));
    else if (style === 'analog') root.replaceChildren(analogFace(), h('span', { class: 'analog-digital' }));
    else if (style === 'words') root.replaceChildren(h('span', { class: 'words-pre' }, 'it’s'), h('span', { class: 'words' }));
  }

  function render(prefs, look, reset = false) {
    if (reset || look.clockStyle !== style) build(look);
    const animate = !reset && document.documentElement.dataset.motion !== 'off';
    const p = parts(prefs);
    root.setAttribute('aria-label', `${p.text}${p.ampm ? ' ' + p.ampm : ''}`);
    root.dataset.color = look.clockColor;

    if (style === 'roll') setRoll($('.digits', root), p.text, animate);
    else if (style === 'flip') setFlipRow($('.digits', root), p.text, animate);
    else if (style === 'stack') { setRoll($('.row-h', root), p.hh.padStart(2, '0'), animate); setRoll($('.row-m', root), p.mm, animate); }
    else if (style === 'fade') {
      const d = $('.digits', root);
      if (d.dataset.v !== p.text) {
        const old = $('.fd:not(.out)', d);
        const nu = h('span', { class: 'fd' + (old && animate ? ' in' : '') }, p.text);
        d.append(nu);
        if (old) { if (animate) { old.classList.add('out'); setTimeout(() => old.remove(), 1200); } else old.remove(); }
        d.dataset.v = p.text;
      }
    } else if (style === 'analog') {
      const n = p.now;
      const s = n.getSeconds();
      const m = n.getMinutes() + s / 60;
      const hr = (n.getHours() % 12) + m / 60;
      if (secDeg == null || !animate) secDeg = s * 6;
      else secDeg += ((s - lastSec + 60) % 60) * 6; // only forwards, never spins back at :00
      lastSec = s;
      $('.hand.sc', root).style.transform = `rotate(${secDeg}deg)`;
      $('.hand.mn', root).style.transform = `rotate(${m * 6}deg)`;
      $('.hand.hr', root).style.transform = `rotate(${hr * 30}deg)`;
      $('.analog-digital', root).textContent = `${p.text}${p.ampm ? ' ' + p.ampm : ''}`;
      return;
    } else if (style === 'words') {
      const w = timeInWords(p.now);
      if (w !== wordsShown) {
        const el = $('.words', root);
        if (animate && wordsShown) {
          el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap');
          setTimeout(() => (el.textContent = w), 260);
        } else el.textContent = w;
        wordsShown = w;
      }
      return;
    }
    const sec = $('.sec', root);
    if (sec) sec.textContent = prefs.showSeconds ? p.ss : '';
    const ap = $('.ampm', root);
    if (ap) ap.textContent = p.ampm;
  }

  return { render };
}

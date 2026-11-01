// Renders the chosen background into <div class="backdrop">.
import { h, reducedMotion, dayKey } from './common.js';

export async function renderBackdrop(root, prefs) {
  const kind = prefs.background || 'aurora';
  const layers = [];
  if (kind === 'aurora') layers.push(h('div', { class: 'aurora' }, h('i'), h('i'), h('i'), h('i')));
  if (kind === 'stars' || kind === 'aurora') layers.push(starCanvas(kind === 'stars' ? 1 : 0.55));
  if (kind === 'bing' || kind === 'custom') {
    const photo = h('div', { class: 'photo' });
    layers.push(photo, h('div', { class: 'shade' }));
    const src = kind === 'bing' ? await bingImage() : (await chrome.storage.local.get('bgImage')).bgImage;
    if (src?.url || typeof src === 'string') {
      const url = typeof src === 'string' ? src : src.url;
      const img = new Image();
      img.onload = () => { photo.style.backgroundImage = `url("${url}")`; requestAnimationFrame(() => photo.classList.add('on')); };
      img.src = url;
      if (src.credit) root.dataset.credit = src.credit;
    } else {
      layers.unshift(h('div', { class: 'aurora' }, h('i'), h('i'), h('i'), h('i')));
    }
  }
  layers.push(h('div', { class: 'dimmer' }), h('div', { class: 'vignette' }), h('div', { class: 'grain' }));
  root.replaceChildren(...layers);
}

async function bingImage() {
  const { bingCache } = await chrome.storage.local.get('bingCache');
  if (bingCache?.day === dayKey()) return bingCache;
  try {
    const res = await fetch('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-IN', { cache: 'no-store' });
    const img = (await res.json()).images?.[0];
    if (!img) throw new Error('no image');
    const base = img.urlbase ? `https://www.bing.com${img.urlbase}_UHD.jpg` : `https://www.bing.com${img.url}`;
    const data = { day: dayKey(), url: base, credit: img.copyright || img.title || '' };
    await chrome.storage.local.set({ bingCache: data });
    return data;
  } catch {
    return bingCache || null;
  }
}

function starCanvas(strength) {
  const cv = h('canvas', { class: 'stars' });
  const ctx = cv.getContext('2d');
  let pts = [];
  const still = reducedMotion();
  const size = () => {
    const dpr = devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round((innerWidth * innerHeight) / 7000);
    pts = Array.from({ length: n }, () => ({
      x: Math.random() * innerWidth, y: Math.random() * innerHeight,
      r: Math.random() * 1.1 + 0.15, p: Math.random() * 6.28, s: 0.3 + Math.random(), v: (Math.random() - 0.5) * 0.02
    }));
  };
  const draw = (t) => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.fillStyle = '#fff';
    for (const s of pts) {
      if (!still) { s.x += s.v; if (s.x < 0) s.x = innerWidth; if (s.x > innerWidth) s.x = 0; }
      ctx.globalAlpha = strength * (still ? 0.5 : 0.2 + 0.5 * (1 + Math.sin(s.p + t * 0.001 * s.s)) / 2);
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
    }
  };
  addEventListener('resize', () => { size(); draw(performance.now()); });
  size();
  requestAnimationFrame(() => draw(0));
  if (!still) {
    let last = 0;
    const loop = (t) => { if (!document.hidden && t - last > 50) { draw(t); last = t; } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  return cv;
}

// One small stroke icon set (24px grid, currentColor), so every icon follows the accent and theme.
const P = {
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.5v2"/>',
  unlock: '<rect x="4.5" y="10.5" width="15" height="10" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 7.6-1.7"/>',
  alert: '<path d="M12 4 2.8 19.5a1 1 0 0 0 .9 1.5h16.6a1 1 0 0 0 .9-1.5L12 4z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  cloudOff: '<path d="M3 3l18 18"/><path d="M8.5 6.2A6 6 0 0 1 17.7 10a4 4 0 0 1 2.7 6.5M16.5 18H7a4 4 0 0 1-1.3-7.8"/>',
  server: '<rect x="3.5" y="4" width="17" height="7" rx="2"/><rect x="3.5" y="13" width="17" height="7" rx="2"/><path d="M7.5 7.5h.01M7.5 16.5h.01"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  up: '<path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/>',
  down: '<path d="M12 5v13M6.5 12.5 12 18l5.5-5.5"/>',
  right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  left: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.4 5.7"/><path d="M20 4v7h-7"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5"/><path d="M5 20h14"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  sparkle: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M19 16v4M17 18h4"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.9 1.4-1.8-.4-1.2.4-2.2 1.6-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15.5" cy="7.5" r="1"/>',
  grip: '<circle cx="9" cy="6" r=".6"/><circle cx="15" cy="6" r=".6"/><circle cx="9" cy="12" r=".6"/><circle cx="15" cy="12" r=".6"/><circle cx="9" cy="18" r=".6"/><circle cx="15" cy="18" r=".6"/>',
  sub: '<path d="M6 4v7a3 3 0 0 0 3 3h10M15 10l4 4-4 4"/>',
  // weather
  sun: '<circle cx="12" cy="12" r="4"/><path class="rays" d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 10.6 4 4 0 0 0 7 18.5z"/>',
  cloudSun: '<path d="M8.5 2.5v1.5M3.2 4.7l1.1 1.1M1.5 10H3M13.8 4.7l-1.1 1.1"/><path d="M5.3 13.2a4 4 0 1 1 6.9-4"/><path d="M10 20.5h8a3.5 3.5 0 0 0 .5-6.96A5 5 0 0 0 9 13.6a3.5 3.5 0 0 0 1 6.9z"/>',
  cloudMoon: '<path d="M11.5 7.6A5 5 0 0 1 6 2.6a5 5 0 0 0-1.3 9.3"/><path d="M10 20.5h8a3.5 3.5 0 0 0 .5-6.96A5 5 0 0 0 9 13.6a3.5 3.5 0 0 0 1 6.9z"/>',
  rain: '<path d="M7 15h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 7.1 4 4 0 0 0 7 15z"/><path class="drops" d="M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>',
  drizzle: '<path d="M7 15h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 7.1 4 4 0 0 0 7 15z"/><path class="drops" d="M9 18.5v1M13 19.5v1M16 18.5v1"/>',
  snow: '<path d="M7 15h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 7.1 4 4 0 0 0 7 15z"/><path class="drops" d="M8.5 18.5h.01M12 20.5h.01M15.5 18.5h.01M10.2 21.5h.01M13.8 21.5h.01"/>',
  storm: '<path d="M7 15h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 7.1 4 4 0 0 0 7 15z"/><path d="M12.5 15.5l-2 3h3l-2 3.5"/>',
  fog: '<path d="M7 12h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 4.1 4 4 0 0 0 7 12z"/><path d="M4 16h16M6 20h12"/>'
};

const NS = 'http://www.w3.org/2000/svg';
export function icon(name, { size = 16, cls = '', label = '' } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', `ic ic-${name}${cls ? ' ' + cls : ''}`);
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); } else svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = P[name] || P.sparkle; // static strings from this file only
  return svg;
}

// <i data-icon="lock" data-size="14"></i> in HTML becomes the SVG.
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.replaceWith(icon(el.dataset.icon, { size: Number(el.dataset.size) || 16, cls: el.className || '' }));
  }
}

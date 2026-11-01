// Current weather from Open-Meteo (free, no key). Uses the city set in Options, else your location.
const TTL = 30 * 60 * 1000;

// [label, day icon, night icon] — icon names from lib/icons.js
const CODES = {
  0: ['Clear', 'sun', 'moon'], 1: ['Mostly clear', 'cloudSun', 'cloudMoon'], 2: ['Partly cloudy', 'cloudSun', 'cloudMoon'], 3: ['Cloudy', 'cloud', 'cloud'],
  45: ['Fog', 'fog', 'fog'], 48: ['Fog', 'fog', 'fog'],
  51: ['Drizzle', 'drizzle', 'drizzle'], 53: ['Drizzle', 'drizzle', 'drizzle'], 55: ['Drizzle', 'drizzle', 'drizzle'], 56: ['Freezing drizzle', 'drizzle', 'drizzle'], 57: ['Freezing drizzle', 'drizzle', 'drizzle'],
  61: ['Light rain', 'rain', 'rain'], 63: ['Rain', 'rain', 'rain'], 65: ['Heavy rain', 'rain', 'rain'], 66: ['Freezing rain', 'rain', 'rain'], 67: ['Freezing rain', 'rain', 'rain'],
  71: ['Light snow', 'snow', 'snow'], 73: ['Snow', 'snow', 'snow'], 75: ['Heavy snow', 'snow', 'snow'], 77: ['Snow grains', 'snow', 'snow'],
  80: ['Showers', 'rain', 'rain'], 81: ['Showers', 'rain', 'rain'], 82: ['Heavy showers', 'storm', 'storm'], 85: ['Snow showers', 'snow', 'snow'], 86: ['Snow showers', 'snow', 'snow'],
  95: ['Thunderstorm', 'storm', 'storm'], 96: ['Thunderstorm', 'storm', 'storm'], 99: ['Thunderstorm', 'storm', 'storm']
};

function position() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('no geolocation'));
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }), reject, { timeout: 8000, maximumAge: 6 * 3600 * 1000 });
  });
}

async function coords(w) {
  if (w.lat != null && w.lon != null) return { lat: w.lat, lon: w.lon, place: w.city };
  const { geo } = await chrome.storage.local.get('geo');
  if (geo && Date.now() - geo.at < 86400000) return geo;
  const p = await position();
  const out = { ...p, place: '', at: Date.now() };
  await chrome.storage.local.set({ geo: out });
  return out;
}

export async function getWeather(w) {
  const c = await coords(w);
  const { weatherCache } = await chrome.storage.local.get('weatherCache');
  const sig = `v2,${c.lat.toFixed(2)},${c.lon.toFixed(2)},${w.units}`;
  if (weatherCache?.sig === sig && Date.now() - weatherCache.at < TTL) return weatherCache.data;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,apparent_temperature,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1${w.units === 'f' ? '&temperature_unit=fahrenheit' : ''}`;
  const j = await (await fetch(url, { cache: 'no-store' })).json();
  const code = j.current?.weather_code ?? 0;
  const [label, day, night] = CODES[code] || ['—', 'cloud', 'cloud'];
  const data = {
    temp: Math.round(j.current.temperature_2m),
    feels: Math.round(j.current.apparent_temperature),
    hi: Math.round(j.daily.temperature_2m_max[0]),
    lo: Math.round(j.daily.temperature_2m_min[0]),
    label,
    icon: j.current.is_day ? day : night,
    unit: w.units === 'f' ? '°F' : '°C',
    place: c.place || ''
  };
  await chrome.storage.local.set({ weatherCache: { sig, at: Date.now(), data } });
  return data;
}

export async function searchCity(q) {
  const j = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en`)).json();
  return (j.results || []).map((r) => ({ name: r.name, detail: [r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude }));
}

// Nightshift sync server: a tiny, single-user store for Nightshift's end-to-end encrypted sync,
// with a live event stream so every browser sees changes within a second or two.
//
// It never sees your data: every item arrives already encrypted (AES-256-GCM, key from your
// passphrase, which never leaves your browsers). It stores opaque blobs and tells connected
// browsers when one changes. No dependencies; Node 18+.
//
//   NIGHTSHIFT_TOKEN  secret the extension sends (generated and printed on first start if unset)
//   PORT              port to listen on (Pelican's SERVER_PORT works too); default 8787
//   DATA_DIR          where state.json lives; default ./data
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || process.env.SERVER_PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const TOKEN_FILE = path.join(DATA_DIR, 'token');
const MAX_BODY = 4 * 1024 * 1024;
const NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
const TOMBSTONE_DAYS = 30;

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- token ---------- */
let TOKEN = process.env.NIGHTSHIFT_TOKEN || '';
if (!TOKEN) {
  try { TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch {}
  if (!TOKEN) {
    TOKEN = 'ns_' + crypto.randomBytes(32).toString('base64url');
    fs.writeFileSync(TOKEN_FILE, TOKEN + '\n', { mode: 0o600 });
    console.log('\n  New sync token (paste it into Nightshift → Options → Sync browsers):\n\n  ' + TOKEN + '\n\n  It is saved in ' + TOKEN_FILE + '. Set NIGHTSHIFT_TOKEN to use your own instead.\n');
  } else console.log(`Using the sync token saved in ${TOKEN_FILE}`);
}
if (TOKEN.length < 24) { console.error('NIGHTSHIFT_TOKEN must be at least 24 characters.'); process.exit(1); }
const tokenBuf = Buffer.from(TOKEN);
function authorised(req, url) {
  const h = req.headers.authorization || '';
  const given = h.startsWith('Bearer ') ? h.slice(7) : '';
  const b = Buffer.from(given);
  return b.length === tokenBuf.length && crypto.timingSafeEqual(b, tokenBuf);
}

/* ---------- state: { rev, items: { name: { rev, at, client, data } }, deleted: { name: { rev, at } } } ---------- */
let state = { rev: 0, items: {}, deleted: {} };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch {}
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const cutoff = Date.now() - TOMBSTONE_DAYS * 86400000;
    for (const [n, d] of Object.entries(state.deleted)) if (d.at < cutoff) delete state.deleted[n];
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, STATE_FILE); // atomic: never a half-written file
  }, 250);
}

/* ---------- live events (server-sent events) ---------- */
const streams = new Set();
function broadcast(ev) {
  const line = `event: change\ndata: ${JSON.stringify(ev)}\n\n`;
  for (const res of streams) res.write(line);
}
setInterval(() => { for (const res of streams) res.write(': ping\n\n'); }, 20000);

/* ---------- failed-auth throttle ---------- */
const fails = new Map();
function throttled(ip) {
  const f = fails.get(ip);
  return f && f.n >= 20 && Date.now() - f.at < 10 * 60000;
}
function failed(ip) {
  const f = fails.get(ip) || { n: 0, at: Date.now() };
  if (Date.now() - f.at > 10 * 60000) { f.n = 0; f.at = Date.now(); }
  f.n++;
  fails.set(ip, f);
}

/* ---------- http ---------- */
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  // The extension calls with host permission, so CORS only matters for the health check.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Client');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return send(res, 204);
  if (url.pathname === '/healthz') return send(res, 200, { ok: true, app: 'nightshift-sync', rev: state.rev });

  if (!url.pathname.startsWith('/v1/')) return send(res, 404, { error: 'not found' });
  if (throttled(ip)) return send(res, 429, { error: 'too many failed attempts, try later' });
  if (!authorised(req, url)) { failed(ip); return send(res, 401, { error: 'bad token' }); }

  try {
    // Everything changed since a revision (0 = everything).
    if (req.method === 'GET' && url.pathname === '/v1/items') {
      const since = Number(url.searchParams.get('since') || 0);
      const items = {};
      for (const [n, it] of Object.entries(state.items)) if (it.rev > since) items[n] = it;
      const deleted = Object.entries(state.deleted).filter(([, d]) => d.rev > since && since > 0).map(([n]) => n);
      return send(res, 200, { rev: state.rev, items, deleted, full: since === 0 });
    }

    if (req.method === 'GET' && url.pathname === '/v1/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`event: hello\ndata: ${JSON.stringify({ rev: state.rev })}\n\n`);
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }

    const m = url.pathname.match(/^\/v1\/items\/([^/]+)$/);
    if (m && NAME.test(m[1])) {
      const name = m[1];
      const client = String(req.headers['x-client'] || '').slice(0, 64);
      if (req.method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        if (typeof body?.data !== 'string') return send(res, 400, { error: 'data must be a string' });
        const rev = ++state.rev;
        state.items[name] = { rev, at: Date.now(), client, data: body.data };
        delete state.deleted[name];
        persist();
        broadcast({ rev, name, client });
        return send(res, 200, { rev });
      }
      if (req.method === 'DELETE') {
        if (!state.items[name]) return send(res, 200, { rev: state.rev });
        const rev = ++state.rev;
        delete state.items[name];
        state.deleted[name] = { rev, at: Date.now() };
        persist();
        broadcast({ rev, name, client, deleted: true });
        return send(res, 200, { rev });
      }
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, e.status || 400, { error: e.status ? e.message : 'bad request' });
  }
});
server.keepAliveTimeout = 65000;
server.listen(PORT, HOST, () => console.log(`Nightshift sync listening on ${HOST}:${PORT} (data in ${DATA_DIR})`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  clearTimeout(saveTimer);
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {}
  process.exit(0);
});

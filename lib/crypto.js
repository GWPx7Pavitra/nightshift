// End-to-end encryption for sync: AES-256-GCM with a key derived from your passphrase (PBKDF2).
// GitHub only ever stores ciphertext; the passphrase never leaves your browsers.
const te = new TextEncoder();
const td = new TextDecoder();
const ITERATIONS = 310000;

export function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function newSalt() {
  return b64(crypto.getRandomValues(new Uint8Array(16)));
}

// Returns the raw AES key (base64) so the background worker can use it without the passphrase.
export async function deriveKey(passphrase, saltB64) {
  const base = await crypto.subtle.importKey('raw', te.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(saltB64), iterations: ITERATIONS, hash: 'SHA-256' }, base, 256);
  return b64(bits);
}

const keys = new Map();
function aes(rawB64) {
  if (!keys.has(rawB64)) keys.set(rawB64, crypto.subtle.importKey('raw', unb64(rawB64), 'AES-GCM', false, ['encrypt', 'decrypt']));
  return keys.get(rawB64);
}

export async function seal(rawKey, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(rawKey), te.encode(JSON.stringify(value)));
  return JSON.stringify({ alg: 'A256GCM', iv: b64(iv), ct: b64(ct) });
}

// Throws if the key is wrong or the data was tampered with.
export async function unseal(rawKey, text) {
  const box = JSON.parse(text);
  if (box?.alg !== 'A256GCM') throw new Error('not encrypted');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, await aes(rawKey), unb64(box.ct));
  return JSON.parse(td.decode(pt));
}

export async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', te.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

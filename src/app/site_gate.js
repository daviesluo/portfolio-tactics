// @ts-check
// The site's gate: the Cloudflare Pages worker in front of every file of dist/ (Davies, 2026-11-05: "任何人不登录应该任何
// 东西都下载不了才行"). A static host serves every file to anyone who asks, so the bundle, its styles, its service
// worker and its precache list were the public's. Through this gate a visitor who has not signed in is sent one small
// sign-in page and nothing else of the app; a signed-in viewer is sent the app without the Agents page's files and
// without the pages it cannot open (the transaction history, the editors: "登录后的访客也下载不了agents的任何文件吧，还有交易
// 记录等不对访客开放的内容"); the operator's `check` token the viewer's and the Agents page's; the admin everything.
//
// The build (vite.config.js, `siteGate`) writes this file to dist/_worker.js with its CONFIG filled in: the files only
// some roles get, with their roles (every `agents-*` and `admin-*` chunk and stylesheet, read from the bundle), the security headers of
// src/public/_headers (Pages applies that file to static files, not to a worker's answers), and where the auth
// function is. It imports nothing, so the one file is the whole worker.
//
// The session. The `auth` function's sign-in answers a second token beside the app's, `site`: `{ role, exp, kind:
// "site" }` signed with Ed25519. Its private key is derived inside `auth` from APP_AUTH_SECRET, so no new secret exists
// and none passes through a person; its public half is public (`auth?action=site-key`), read here and kept for an hour.
// The page posts `site` to /__session, which checks it and sets it as an HttpOnly cookie that lapses with it (24 hours,
// as the app's token). Rotating APP_AUTH_SECRET rotates the key: a token the kept key refuses has the key read again.
//
// What a visitor without a session gets: the sign-in page for a page load (any path, `?pwd=` read there as the app
// read it), a self-removing service worker for /sw.js (SW_REMOVER), 401 for anything else, robots.txt, and /__gate,
// the gate's own health for the monitor. Never a file of the app, and never a sign of which files exist: every
// refused path answers the same.

/** The session cookie. `__Host-`: Secure, Path=/, no Domain, so no other host can set or read it. */
export const COOKIE = '__Host-dp_site';
/** Where the page hands its `site` token over (POST) and signs out (DELETE). */
export const SESSION_PATH = '/__session';
/** The gate's health: on, and whether the app behind it is served. */
export const GATE_PATH = '/__gate';
/** Files anyone may have. */
export const PUBLIC_PATHS = new Set(['/robots.txt']);
/**
 * What a browser without a session gets for the service worker's script: a worker that removes itself. A device that
 * installed the app keeps serving it from its own cache, page loads included, and only asks the network for this
 * script; refused it, it would keep the copy it has forever. This one empties every cache, unregisters, and reloads
 * the page, which then reaches the gate: the sign-in page. It carries nothing of the app.
 */
export const SW_REMOVER = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.clients.claim();
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
})()));
`;
/** The marker the gate puts in the app's page, so the app knows its session is the gate's to keep. */
export const GATE_META = '<meta name="dp-site-gate" content="on">';
const KEY_TTL_MS = 60 * 60 * 1000;
const KEY_RETRY_MS = 60 * 1000;

/**
 * @typedef {{ restricted: Record<string, string[]>, headers: Record<string, string>, keyUrl: string, authUrl: string, anon: string }} GateConfig
 * @typedef {{ role: string, exp: number }} Session
 * @typedef {{ fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>, now: () => number }} Deps
 */

/** Filled in by the build; null in the source, where the tests hand their own. @type {GateConfig | null} */
const CONFIG = null; // @gate-config
/**
 * The build's CONFIG, for the test that runs the committed dist/_worker.js on the committed files.
 * @public (used through the built file, which knip does not read)
 */
export const gateConfig = () => CONFIG;

/** @param {string} s */
function b64urlBytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

/** One cookie's value from a Cookie header, or null. @param {string | null} header @param {string} name */
export function cookieValue(header, name = COOKIE) {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * A `site` token's claims when one of `keys` signed it and it has not lapsed, else null.
 * @param {string | null} token @param {CryptoKey[]} keys @param {number} now
 * @returns {Promise<Session | null>}
 */
export async function verifySession(token, keys, now) {
  if (!token || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [p, s] = token.split('.');
  let sig, claims;
  try {
    sig = b64urlBytes(s);
    claims = JSON.parse(new TextDecoder().decode(b64urlBytes(p)));
  } catch { return null; }
  if (claims?.kind !== 'site' || typeof claims.role !== 'string' || typeof claims.exp !== 'number' || claims.exp <= now) return null;
  const data = new TextEncoder().encode(p);
  for (const key of keys) {
    try {
      if (await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, data)) return { role: claims.role, exp: claims.exp };
    } catch { /* a key of another shape: the next */ }
  }
  return null;
}

/** A page load, as opposed to a script, a style, a fetch or the service worker's own. @param {Request} req */
export function isNavigation(req) {
  const mode = req.headers.get('sec-fetch-mode');
  if (mode) return mode === 'navigate';
  return req.method === 'GET' && /\btext\/html\b/.test(req.headers.get('accept') ?? '');
}

/** The sign-in page's script: the app's own sign-in (auth.js), then the session handed to the gate, then the page again. */
function loginScript(/** @type {GateConfig} */ c) {
  return `(() => {
  const AUTH = ${JSON.stringify(c.authUrl)}, ANON = ${JSON.stringify(c.anon)};
  const form = document.getElementById('f'), pw = document.getElementById('pw'), btn = document.getElementById('go'), msg = document.getElementById('m');
  const say = (t, k) => { msg.textContent = t; msg.className = k || ''; };
  async function signIn(p) {
    btn.disabled = true; say('Signing in…');
    let res;
    try {
      res = await fetch(AUTH, { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: p }), signal: AbortSignal.timeout(10000) });
    } catch { btn.disabled = false; return say('The server did not answer, so the password was not checked. Try again in a minute.', 'warn'); }
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.token && body.site) {
      try { sessionStorage.setItem('dp.token', body.token); } catch {}
      const s = await fetch(${JSON.stringify(SESSION_PATH)}, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: body.site }).catch(() => null);
      if (s && s.ok) { location.replace(location.pathname + location.search + location.hash); return; }
      btn.disabled = false; return say('Signed in, but the site refused the session. Try again.', 'warn');
    }
    btn.disabled = false;
    if (res.status === 429) {
      const h = Math.max(1, Math.ceil(((Number(body.lockoutUntil) || Date.now() + 864e5) - Date.now()) / 36e5));
      return say('Too many incorrect attempts. Try again in ' + h + 'h.', 'bad');
    }
    if (res.status === 401) return say('Incorrect password.', 'bad');
    return say('The server did not answer (' + res.status + '), so the password was not checked. Try again in a minute.', 'warn');
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); if (pw.value) signIn(pw.value); });
  const q = new URLSearchParams(location.search), p = q.get('pwd');
  if (p != null) {
    q.delete('pwd');
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    if (p) signIn(p);
  }
})();`;
}

const LOGIN_STYLE = `html,body{margin:0;min-height:100%;background:#0c1310;color:#ccc;font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
main{min-height:100vh;display:grid;place-items:center;padding:16px;box-sizing:border-box}
form{display:flex;flex-direction:column;gap:12px;width:min(100%,300px);padding:32px 24px;border:1px solid #2a2a2a;border-radius:4px;box-sizing:border-box}
h1{margin:0;font-size:13px;font-weight:400;letter-spacing:.2em;color:#888;text-align:center}
input,button{font:inherit;padding:10px 12px;border-radius:2px;border:1px solid #3a3a3a;background:#14201b;color:#ddd}
button{cursor:pointer;background:#1e2d28}button:disabled{opacity:.6;cursor:default}
#m{min-height:1.4em;text-align:center;color:#888}#m.bad{color:#f55}#m.warn{color:#fa3}`;

/** The sign-in page and its Content-Security-Policy (the script allowed by its hash alone). @param {GateConfig} c */
export async function loginPage(c) {
  const script = loginScript(c);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script)));
  const hash = btoa(String.fromCharCode(...digest));
  const html = `<!doctype html><html lang="en" data-site-gate="login"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Sign in</title><style>${LOGIN_STYLE}</style></head>`
    + `<body><main><form id="f" autocomplete="on"><h1>SIGN IN</h1><input id="pw" type="password" name="password" autocomplete="current-password" aria-label="Password" placeholder="Password" required autofocus><button id="go" type="submit">Enter</button><div id="m" role="status"></div></form></main><script>${script}</script></body></html>`;
  const origin = new URL(c.authUrl).origin;
  const csp = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; connect-src 'self' ${origin}; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;
  return { html, csp };
}

/**
 * The gate's verdict and answer for one request.
 * @param {Request} req @param {{ ASSETS: { fetch: (r: Request | string) => Promise<Response> } }} env @param {GateConfig} c
 * @param {Deps & { keys: (force?: boolean) => Promise<CryptoKey[]> }} d
 * @returns {Promise<Response>}
 */
export async function handle(req, env, c, d) {
  const url = new URL(req.url);
  const path = url.pathname;
  const base = (/** @type {Record<string, string>} */ extra = {}) => new Headers({ ...c.headers, 'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex', ...extra });
  const plain = (/** @type {number} */ status, /** @type {string} */ text, extra = {}) =>
    new Response(status === 204 ? null : text, { status, headers: base({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra }) });

  if (path === SESSION_PATH) return session(req, url, c, d, plain);
  if (path === GATE_PATH) return gateHealth(env, url, c, plain);
  if (PUBLIC_PATHS.has(path) && req.method === 'GET') return withHeaders(await env.ASSETS.fetch(req), base, path);

  const s = await sessionOf(req, d);
  // A session the gate cannot check (the auth function's key unreadable, Supabase down) is not a signed-out one: a
  // file is 503, and the service worker's script never the remover, so an installed copy is kept until the key is back.
  if (s === UNCHECKED && !isNavigation(req)) return plain(503, 'The gate cannot check the session right now.\n', { 'Retry-After': '60' });
  if (!s || s === UNCHECKED) {
    if (isNavigation(req)) {
      const { html, csp } = await loginPage(c);
      const h = base({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      h.set('Content-Security-Policy', csp);
      return new Response(req.method === 'HEAD' ? null : html, { status: 200, headers: h });
    }
    if (path === '/sw.js') return new Response(SW_REMOVER, { status: 200, headers: base({ 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }) });
    return plain(401, 'Sign in first.\n');
  }
  // A file only some roles get (the Agents page's, the pages a viewer cannot open): to anyone else, as one not there.
  const roles = Object.prototype.hasOwnProperty.call(c.restricted, path.slice(1)) ? c.restricted[path.slice(1)] : null;
  if (roles && !roles.includes(s.role)) return plain(404, 'Not found.\n');
  const res = await env.ASSETS.fetch(req);
  const type = res.headers.get('content-type') ?? '';
  if (res.status === 200 && /text\/html/.test(type) && (path === '/' || path === '/index.html' || isNavigation(req))) {
    const html = await res.text();
    const marked = html.includes(GATE_META) ? html : html.replace('</head>', `${GATE_META}</head>`);
    const h = new Headers(res.headers);
    h.delete('content-length');
    return withHeaders(new Response(marked, { status: 200, headers: h }), base, path);
  }
  return withHeaders(res, base, path);
}

/** A file's answer with the site's headers, kept out of shared caches (it is a signed-in person's). */
function withHeaders(/** @type {Response} */ res, /** @type {(e?: Record<string, string>) => Headers} */ base, /** @type {string} */ path) {
  const h = new Headers(res.headers);
  for (const [k, v] of base()) h.set(k, v);
  const page = path === '/' || path === '/index.html' || path === '/sw.js' || path === '/manifest.webmanifest' || /\.html$/.test(path);
  h.set('Cache-Control', page ? 'private, no-cache' : 'private, max-age=0, must-revalidate');
  h.set('Vary', 'Cookie');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

/** A cookie the gate holds no key to check. */
const UNCHECKED = /** @type {const} */ ('unchecked');

/**
 * The request's session, null, or UNCHECKED when it carries one and no key can be read. A token the kept key refuses
 * has the key read again, once (a rotated secret).
 * @returns {Promise<Session | null | typeof UNCHECKED>}
 */
async function sessionOf(/** @type {Request} */ req, /** @type {Deps & { keys: (force?: boolean) => Promise<CryptoKey[]> }} */ d) {
  const token = cookieValue(req.headers.get('cookie'));
  if (!token) return null;
  const kept = await d.keys(false);
  const s = (await verifySession(token, kept, d.now())) ?? (await verifySession(token, await d.keys(true), d.now()));
  if (s) return s;
  return (await d.keys(false)).length ? null : UNCHECKED;
}

/**
 * /__session: POST a `site` token to be signed in (a cookie that lapses with it), DELETE to be signed out. Only from
 * this site's own pages (the Origin), so another site cannot sign a browser in or out.
 */
async function session(/** @type {Request} */ req, /** @type {URL} */ url, /** @type {GateConfig} */ c, /** @type {any} */ d, /** @type {(s: number, t: string, e?: Record<string, string>) => Response} */ plain) {
  const origin = req.headers.get('origin');
  if (origin !== null && origin !== url.origin) return plain(403, 'Not from this site.\n');
  if (req.method === 'DELETE') return plain(204, '', { 'Set-Cookie': `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0` });
  if (req.method !== 'POST') return plain(405, 'POST or DELETE.\n', { Allow: 'POST, DELETE' });
  const token = (await req.text().catch(() => '')).trim();
  const now = d.now();
  const s = (await verifySession(token, await d.keys(false), now)) ?? (await verifySession(token, await d.keys(true), now));
  if (!s) return plain(401, 'That session is not good.\n');
  const age = Math.max(0, Math.floor((s.exp - now) / 1000));
  return plain(204, '', { 'Set-Cookie': `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}` });
}

/** /__gate: the gate is on, and the app behind it is there (its page names an app chunk that answers as JavaScript). */
async function gateHealth(/** @type {any} */ env, /** @type {URL} */ url, /** @type {GateConfig} */ c, /** @type {any} */ plain) {
  let app = 'missing';
  try {
    const page = await env.ASSETS.fetch(new Request(new URL('/', url)));
    const chunk = /assets\/app-[0-9a-f]+\.js/.exec(await page.text())?.[0];
    if (chunk) {
      const js = await env.ASSETS.fetch(new Request(new URL(`/${chunk}`, url)));
      try { await js.body?.cancel(); } catch { /* not needed */ }
      app = js.status === 200 && /javascript/.test(js.headers.get('content-type') ?? '') ? 'ok' : `chunk ${js.status}`;
    }
  } catch { app = 'unreadable'; }
  return plain(200, JSON.stringify({ gate: 'on', app }), { 'Content-Type': 'application/json' });
}

/**
 * The auth function's public keys, kept for an hour; read again when asked (`force`), at most once a minute.
 * @param {GateConfig} c @param {Deps} d
 */
export function keyStore(c, d) {
  /** @type {{ keys: CryptoKey[], at: number, tried: number }} */
  const kept = { keys: [], at: 0, tried: 0 };
  return async (force = false) => {
    const now = d.now();
    const fresh = kept.keys.length && now - kept.at < KEY_TTL_MS;
    if ((fresh && !force) || now - kept.tried < KEY_RETRY_MS) return kept.keys;
    kept.tried = now;
    try {
      const res = await d.fetch(c.keyUrl, { headers: { apikey: c.anon, Authorization: `Bearer ${c.anon}` } });
      const body = await res.json();
      const keys = [];
      for (const k of Array.isArray(body?.keys) ? body.keys : []) {
        if (k?.kty === 'OKP' && k?.crv === 'Ed25519' && typeof k.x === 'string') {
          keys.push(await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: k.x }, { name: 'Ed25519' }, false, ['verify']));
        }
      }
      if (keys.length) { kept.keys = keys; kept.at = now; }
    } catch { /* the kept keys, if any, until the next try */ }
    return kept.keys;
  };
}

/** @type {ReturnType<typeof keyStore> | null} */
let keys = null;

// The worker Pages runs (it reads it from the built file, dist/_worker.js).
export default {
  /** @param {Request} req @param {any} env */
  async fetch(req, env) {
    const c = /** @type {GateConfig} */ (/** @type {unknown} */ (CONFIG));
    const d = { fetch: (/** @type {any} */ i, /** @type {any} */ o) => fetch(i, o), now: () => Date.now() };
    keys ??= keyStore(c, d);
    try {
      return await handle(req, env, c, { ...d, keys });
    } catch {
      return new Response('The gate failed.\n', { status: 503, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
    }
  },
};

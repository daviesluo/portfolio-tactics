// @vitest-environment node
// The site's gate (site_gate.js; Davies, 2026-11-05: "任何人不登录应该任何东西都下载不了才行"): who is sent what, through the
// worker's own `handle`, with a made-up key pair and a fake ASSETS that serves a small dist/. No network.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { COOKIE, GATE_META, SW_REMOVER, cookieValue, handle, isNavigation, keyStore, loginPage, verifySession } from './site_gate.js';
import { CONFIG_LINE, restrictedFiles, siteHeaders, workerSource } from './site_gate_build.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.UTC(2026, 10, 5, 9, 0);
const ORIGIN = 'https://daviesluo.com';
const b64url = (/** @type {Uint8Array | string} */ b) =>
  Buffer.from(typeof b === 'string' ? Buffer.from(b) : b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const other = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const pub = /** @type {CryptoKeyPair} */ (pair).publicKey;
async function siteToken(/** @type {Record<string, unknown>} */ claims, key = /** @type {CryptoKeyPair} */ (pair).privateKey) {
  const p = b64url(JSON.stringify(claims));
  return `${p}.${b64url(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(p))))}`;
}
const tok = (/** @type {string} */ role, exp = NOW + 3600_000) => siteToken({ role, exp, kind: 'site' });

/** A small dist/: the page, the app's chunk, the Agents page's two files, the service worker, robots.txt. */
const FILES = {
  '/': ['text/html', '<!doctype html><html><head><script type="module" src="/assets/app-0123abcd.js"></script></head><body></body></html>'],
  '/assets/app-0123abcd.js': ['text/javascript', 'export const app = 1;'],
  '/assets/agents-1111aaaa.js': ['text/javascript', 'export const agents = "the page";'],
  '/assets/agents-2222bbbb.css': ['text/css', '.ag-page{}'],
  '/assets/admin-3333cccc.js': ['text/javascript', 'export const history = 1;'],
  '/sw.js': ['text/javascript', 'self.precache = [];'],
  '/robots.txt': ['text/plain', 'User-agent: *\nDisallow: /\n'],
};
const env = {
  ASSETS: {
    fetch: async (/** @type {Request | string} */ r) => {
      const p = new URL(typeof r === 'string' ? r : r.url).pathname;
      const f = /** @type {Record<string, string[]>} */ (FILES)[p];
      return f ? new Response(f[1], { status: 200, headers: { 'content-type': f[0], 'content-length': String(f[1].length) } }) : new Response('404 page', { status: 404, headers: { 'content-type': 'text/html' } });
    },
  },
};
const CONFIG = {
  restricted: { 'assets/admin-3333cccc.js': ['admin'], 'assets/agents-1111aaaa.js': ['admin', 'check'], 'assets/agents-2222bbbb.css': ['admin', 'check'] },
  headers: { 'Strict-Transport-Security': 'max-age=63072000', 'Content-Security-Policy': "default-src 'self'" },
  keyUrl: 'https://sb.example/functions/v1/auth?action=site-key',
  authUrl: 'https://sb.example/functions/v1/auth',
  anon: 'anon-key',
};
const deps = { fetch: async () => new Response('{}'), now: () => NOW, keys: async () => [pub] };
const ask = (/** @type {string} */ p, /** @type {Record<string, string>} */ headers = {}, init = {}) =>
  handle(new Request(ORIGIN + p, { headers, ...init }), env, CONFIG, deps);
const nav = { 'sec-fetch-mode': 'navigate', accept: 'text/html' };
const withCookie = async (/** @type {string} */ role, extra = {}) => ({ cookie: `other=1; ${COOKIE}=${await tok(role)}`, ...extra });

describe('the site gate: a visitor who has not signed in', () => {
  it('gets the sign-in page for any page load, the same page for every path, and none of the app', async () => {
    const pages = await Promise.all(['/', '/?pwd=x', '/index.html', '/assets/app-0123abcd.js', '/no-such'].map((p) => ask(p, nav)));
    const bodies = await Promise.all(pages.map((r) => r.text()));
    expect(pages.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(new Set(bodies).size).toBe(1);
    const html = bodies[0];
    expect(html).toContain('data-site-gate="login"');
    for (const s of ['app-0123abcd', 'agents', 'Revolut', 'ag-venue', 'sw.js', 'manifest']) expect(html).not.toContain(s);
    expect(pages[0].headers.get('cache-control')).toBe('no-store');
    expect(pages[0].headers.get('content-security-policy')).toMatch(/^default-src 'none'; script-src 'sha256-[A-Za-z0-9+/=]+';/);
  });

  it('gets 401 and the same few words for every file: the chunks, the styles, the manifest', async () => {
    for (const p of ['/assets/app-0123abcd.js', '/assets/agents-1111aaaa.js', '/assets/agents-2222bbbb.css', '/assets/admin-3333cccc.js', '/manifest.webmanifest', '/assets/missing.js']) {
      const r = await ask(p, { 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' });
      expect([p, r.status, await r.text()]).toEqual([p, 401, 'Sign in first.\n']);
    }
  });

  it("gets, for the service worker's script, one that removes itself: an installed copy of the app does not outlive the session", async () => {
    const r = await ask('/sw.js', { 'sec-fetch-mode': 'same-origin', 'sec-fetch-dest': 'serviceworker' });
    expect([r.status, r.headers.get('content-type'), r.headers.get('cache-control')]).toEqual([200, 'text/javascript; charset=utf-8', 'no-store']);
    const js = await r.text();
    expect(js).toBe(SW_REMOVER);
    for (const s of ['caches.delete', 'unregister()', 'skipWaiting()', 'navigate(']) expect(js).toContain(s);
    for (const s of ['precache', 'assets/', 'importScripts', 'fetch']) expect(js).not.toContain(s);
    // With a session, the real one.
    expect(await (await ask('/sw.js', await withCookie('ro'))).text()).toBe('self.precache = [];');
  });

  it('gets robots.txt, and nothing for a forged, lapsed, unsigned or wrongly signed cookie', async () => {
    expect(await (await ask('/robots.txt')).text()).toContain('Disallow: /');
    const forged = [
      `${COOKIE}=${await tok('admin', NOW - 1)}`,                                            // lapsed
      `${COOKIE}=${await siteToken({ role: 'admin', exp: NOW + 60_000, kind: 'site' }, /** @type {CryptoKeyPair} */ (other).privateKey)}`, // another key
      `${COOKIE}=${await siteToken({ role: 'admin', exp: NOW + 60_000 })}`,                  // not a site token (the app's shape)
      `${COOKIE}=${b64url(JSON.stringify({ role: 'admin', exp: NOW + 60_000, kind: 'site' }))}.AAAA`,
      `${COOKIE}=garbage`,
    ];
    for (const cookie of forged) expect((await ask('/assets/app-0123abcd.js', { cookie })).status).toBe(401);
  });
});

describe('the site gate: a signed-in session', () => {
  it("the viewer gets the app, never the Agents page's files nor a closed page's (404, as a file that is not there)", async () => {
    const h = await withCookie('ro');
    const app = await ask('/assets/app-0123abcd.js', h);
    expect([app.status, await app.text()]).toEqual([200, 'export const app = 1;']);
    expect(app.headers.get('cache-control')).toBe('private, max-age=0, must-revalidate');
    expect(app.headers.get('vary')).toBe('Cookie');
    expect(app.headers.get('strict-transport-security')).toBe('max-age=63072000');
    for (const p of ['/assets/agents-1111aaaa.js', '/assets/agents-2222bbbb.css', '/assets/admin-3333cccc.js']) {
      const r = await ask(p, h);
      expect([p, r.status, await r.text()]).toEqual([p, 404, 'Not found.\n']);
    }
  });

  it("the admin and the operator's check get the Agents page's files too; a closed page's the admin alone", async () => {
    for (const role of ['admin', 'check']) {
      const r = await ask('/assets/agents-1111aaaa.js', await withCookie(role));
      expect([role, r.status, await r.text()]).toEqual([role, 200, 'export const agents = "the page";']);
    }
    expect((await ask('/assets/admin-3333cccc.js', await withCookie('admin'))).status).toBe(200);
    expect((await ask('/assets/admin-3333cccc.js', await withCookie('check'))).status).toBe(404);
  });

  it("the page carries the gate's marker (so the app keeps its session there), not cached, its length not the file's", async () => {
    const r = await ask('/', await withCookie('ro', nav));
    const html = await r.text();
    expect(html).toContain(`${GATE_META}</head>`);
    expect(html.match(/dp-site-gate/g)).toHaveLength(1);
    expect(r.headers.get('content-length')).toBeNull();
    expect(r.headers.get('cache-control')).toBe('private, no-cache');
    expect(r.headers.get('content-security-policy')).toBe("default-src 'self'");
  });

  it("with no key to check a session (Supabase down), a file is 503 and an installed app is never sent the remover", async () => {
    const blind = { ...deps, keys: async () => [] };
    const askBlind = async (/** @type {string} */ p, /** @type {Record<string, string>} */ h) => handle(new Request(ORIGIN + p, { headers: h }), env, CONFIG, blind);
    const cookie = `${COOKIE}=${await tok('admin')}`;
    for (const p of ['/sw.js', '/assets/app-0123abcd.js']) {
      const r = await askBlind(p, { cookie, 'sec-fetch-mode': 'same-origin' });
      expect([p, r.status, r.headers.get('retry-after')]).toEqual([p, 503, '60']);
    }
    expect(await (await askBlind('/', { cookie, ...nav })).text()).toContain('data-site-gate="login"');
    // Without a cookie at all it is a signed-out browser, key or no key: the remover.
    expect(await (await askBlind('/sw.js', {})).text()).toBe(SW_REMOVER);
  });

  it('reads the key again when the kept one refuses a token (a rotated secret), at most once a minute', async () => {
    let calls = 0;
    const jwk = await crypto.subtle.exportKey('jwk', pub);
    let t = NOW;
    const store = keyStore(CONFIG, { fetch: async () => { calls++; return new Response(JSON.stringify({ keys: [{ kty: 'OKP', crv: 'Ed25519', x: jwk.x }] })); }, now: () => t });
    expect((await store()).length).toBe(1);
    expect((await store()).length).toBe(1);
    expect(calls).toBe(1);
    t += 30_000;
    await store(true);
    expect(calls).toBe(1);                       // within the minute: no second read
    t += 60_000;
    await store(true);
    expect(calls).toBe(2);
    t += 2 * 3600_000;
    await store();
    expect(calls).toBe(3);                       // past the hour: read again
  });
});

describe('the site gate: /__session', () => {
  const post = (/** @type {string} */ body, /** @type {Record<string, string>} */ headers = {}) => ask('/__session', { origin: ORIGIN, ...headers }, { method: 'POST', body });

  it('sets a good token as an HttpOnly, Secure, host-only cookie that lapses with it', async () => {
    const r = await post(await tok('ro', NOW + 3600_000));
    expect(r.status).toBe(204);
    const c = r.headers.get('set-cookie') ?? '';
    expect(c).toMatch(new RegExp(`^${COOKIE}=[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600$`));
  });

  it('refuses a bad token, another site, and any method but POST and DELETE; DELETE signs out', async () => {
    expect((await post('nope')).status).toBe(401);
    expect((await post(await tok('admin'), { origin: 'https://evil.example' })).status).toBe(403);
    expect((await ask('/__session')).status).toBe(405);
    const out = await ask('/__session', { origin: ORIGIN }, { method: 'DELETE' });
    expect([out.status, out.headers.get('set-cookie')]).toEqual([204, `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`]);
  });
});

describe('the site gate: its parts', () => {
  it('fails closed: the source, its CONFIG not filled by the build, sends nothing but a 503', async () => {
    const r = await worker.fetch(new Request(`${ORIGIN}/assets/app-0123abcd.js`, { headers: { cookie: `${COOKIE}=${await tok('admin')}` } }), env);
    expect([r.status, await r.text()]).toEqual([503, 'The gate failed.\n']);
  });

  it('/__gate says the gate is on and the app behind it is served, and names no file', async () => {
    const r = await ask('/__gate');
    expect(JSON.parse(await r.text())).toEqual({ gate: 'on', app: 'ok' });
  });

  it('cookieValue, isNavigation and verifySession read what they should', async () => {
    expect(cookieValue(`a=1; ${COOKIE}=x.y; b=2`)).toBe('x.y');
    expect(cookieValue('a=1')).toBeNull();
    expect(isNavigation(new Request(ORIGIN, { headers: { 'sec-fetch-mode': 'navigate' } }))).toBe(true);
    expect(isNavigation(new Request(ORIGIN, { headers: { 'sec-fetch-mode': 'cors', accept: 'text/html' } }))).toBe(false);
    expect(isNavigation(new Request(ORIGIN, { headers: { accept: 'text/html,application/xhtml+xml' } }))).toBe(true);
    expect(await verifySession(await tok('check'), [pub], NOW)).toEqual({ role: 'check', exp: NOW + 3600_000 });
  });

  it("the sign-in page's script is the one its CSP hash allows, and it hands the session to the gate", async () => {
    const { html, csp } = await loginPage(CONFIG);
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? '';
    const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script))).toString('base64');
    expect(csp).toContain(`'sha256-${digest}'`);
    expect(csp).toContain('connect-src \'self\' https://sb.example;');
    expect(script).toContain('"/__session"');
    expect(script).toContain("sessionStorage.setItem('dp.token', body.token)");
    expect(script).toContain("q.get('pwd')");
  });

  it("the build fills the source's CONFIG line, takes the headers of _headers' /* block, and lists every agents-* file", () => {
    const src = fs.readFileSync(path.join(SRC, 'app', 'site_gate.js'), 'utf8');
    expect(src).toContain(CONFIG_LINE);
    const out = workerSource(src, CONFIG);
    expect(out).not.toContain(CONFIG_LINE);
    expect(out).toContain(`const CONFIG = ${JSON.stringify(CONFIG)};`);
    expect(() => workerSource('no line', CONFIG)).toThrow(/gate-config/);
    const h = siteHeaders(fs.readFileSync(path.join(SRC, 'public', '_headers'), 'utf8'));
    expect(Object.keys(h)).toEqual(['Strict-Transport-Security', 'X-Content-Type-Options', 'X-Robots-Tag', 'Referrer-Policy', 'Permissions-Policy', 'Content-Security-Policy']);
    expect(h['Content-Security-Policy']).toMatch(/^default-src 'self'; script-src 'self';/);
    const both = ['admin', 'check'];
    expect(restrictedFiles({
      a: { fileName: 'assets/agents-1234abcd.js', viteMetadata: { importedCss: new Set(['assets/agents-9999eeee.css']) } },
      b: { fileName: 'assets/app-1234abcd.js', viteMetadata: { importedCss: new Set(['assets/index-1111.css']) } },
      c: { fileName: 'assets/agents-5555ffff.js' },
      d: { fileName: 'assets/admin-7777aaaa.js' },
    })).toEqual({ 'assets/admin-7777aaaa.js': ['admin'], 'assets/agents-1234abcd.js': both, 'assets/agents-5555ffff.js': both, 'assets/agents-9999eeee.css': both });
  });
});

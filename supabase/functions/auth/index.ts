// Supabase Edge Function: auth
// Server-side password check + IP-rate-limited lockout. Replaces the
// client-side password compare so the actual passwords never ship in the
// browser bundle. On success returns a short-lived signed token that the
// `data` Edge Function trusts.
//
// POST /functions/v1/auth   body: { password: string, device?: string }
//   200 OK  { token, site, role: "admin" | "ro", device? }   site: the site gate's session (Ed25519; see "The site's
//           session" below); device: a proof for a browser that had none, which it keeps and sends with later sign-ins
//   401 Unauthorized
//   429 Too Many Requests   { error: "locked" | "busy", lockoutUntil: number }   locked: this address, three wrong
//           passwords; busy: the hour's budget of wrong passwords across addresses is spent, and this device has never
//           signed in (`signIn` below)
//   503 the lockout state could not be read or the attempt could not be counted: nothing was judged
//
// POST /functions/v1/auth?action=viewer-token   Authorization: Bearer <CRON_SECRET>
//   The operator's route (Davies, 2026-10-29: "以后每次页面改动等你都去网站实际验证"): a read-only token for checking
//   the real site as a viewer sees it (`bin/site-check.mjs`). It reads DAVIESLUO_VIEWER_PASSWORD here, on the server,
//   and mints a token only when that password IS the site's read-only one (APP_RO_PWD): the role the login would give,
//   never admin, for 30 minutes rather than the login's 24 hours.
//     200 { token, role: "ro", exp }   the token alone: the password is never returned or logged
//     401 without the cron bearer (after the same 500 ms as a wrong password; no lockout row is read or written,
//         so this route can neither trip nor clear an IP's lockout)
//     409 the stored password is not the read-only one, or is the admin one: no token
//     503 DAVIESLUO_VIEWER_PASSWORD or CRON_SECRET not set
//   Since 2026-11-05 the viewer's token opens nothing of the Agents page ("确保下访客密码进入的用户菜单栏里没有agents这个选项").
//
// POST /functions/v1/auth?action=check-token   Authorization: Bearer <CRON_SECRET>
//   The operator's check of the Agents page as the real site shows it (`bin/site-check.mjs --page agents`): a token of
//   role "check", 30 minutes, that reads what the viewer reads and the Agents page's reads too, and edits nothing (every
//   function's writes test `role === "admin"`). No password gives it: the cron bearer alone, which already opens every
//   agents action, so it adds no power. 200 { token, role: "check", exp }; 401 / 503 as above; 500 without APP_AUTH_SECRET.
//
// Lockout state lives in `public.auth_attempts` (ip primary key, attempts
// counter, lockout_until unix ms). Anon role has NO access — we only read
// and write via the auto-injected SUPABASE_SERVICE_ROLE_KEY. Three wrong
// passwords from the same IP triggers a 24h lockout. Beside it, since
// 2026-11-21, `public.auth_wrong_minutes` counts wrong passwords across
// addresses (migration 0360), and the form fails closed: see `signIn`.
//
// The token is HMAC-SHA256 over the payload with APP_AUTH_SECRET; format is
// `<base64url(payload)>.<base64url(sig)>`. `data/index.ts` re-derives the
// same HMAC and rejects anything where it doesn't match or where exp has
// passed. Lifetime is 24 h.
//
// REQUIRED secrets (set via Supabase Dashboard → Edge Functions → Secrets):
//   APP_ADMIN_PWD     — the admin password (full edit rights)
//   APP_RO_PWD        — the read-only password
//   APP_AUTH_SECRET   — long random string used to sign tokens
// No example values here, deliberately. This file was readable from the
// public site for months (the repository root was being served), and the
// two it used to carry read as the real ones. Rotating a secret does not
// un-publish the shape of it.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected.

import { reportServerError } from "../_shared/ops.ts";
import { b64url, constantTimeEqual, sign } from "../_shared/token.ts";
import { clientIpFromHeaders } from "../_shared/ip.ts";

// Re-exported so this function's index.test.ts keeps pinning the exact
// implementations the token issue path uses (and so older imports of
// these helpers from auth keep working).
export { b64url, sign, clientIpFromHeaders };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const TOKEN_TTL_MS  = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS  = 3;
const LOCKOUT_MS    = 24 * 60 * 60 * 1000;
export const WRONG_PASSWORD_DELAY_MS = 500;

const ADMIN_PWD    = Deno.env.get("APP_ADMIN_PWD") ?? "";
const RO_PWD       = Deno.env.get("APP_RO_PWD") ?? "";
const SECRET       = Deno.env.get("APP_AUTH_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET  = Deno.env.get("CRON_SECRET") ?? "";
const VIEWER_PWD   = Deno.env.get("DAVIESLUO_VIEWER_PASSWORD") ?? "";

/** How long a token minted for the operator's site check lives: a check takes minutes, and a leaked one lapses soon. */
export const VIEWER_TOKEN_TTL_MS = 30 * 60 * 1000;

// b64url / sign live in ../_shared/token.ts (imported + re-exported
// above) — the same module the verifying functions (data / trading212 /
// ops-error) now use, so issue and verify can't drift apart.

export async function makeToken(role: "admin" | "ro" | "check", secret = SECRET, ttlMs = TOKEN_TTL_MS): Promise<string> {
  const payload = b64url(JSON.stringify({ role, exp: Date.now() + ttlMs }));
  const signature = await sign(payload, secret);
  return `${payload}.${signature}`;
}

// ---- The site's session (`site`; Davies, 2026-11-05: "任何人不登录应该任何东西都下载不了才行") ------------------------------
// Beside the app's token every sign-in answers `site`: `{ role, exp, kind: "site" }` signed with Ed25519, which the
// site's gate (src/app/site_gate.js, Cloudflare's side) checks before it sends any file of the app. The gate holds no
// secret: it checks with the public half, which `?action=site-key` hands anyone. The private half is derived here
// from APP_AUTH_SECRET (the seed is an HMAC of a fixed label under it), so there is no new secret to set, store or pass
// through a person, and rotating APP_AUTH_SECRET rotates this key with it.
const SITE_SEED_LABEL = "dp-site-gate-ed25519-v1";
/** PKCS#8's fixed prefix for a raw 32-byte Ed25519 seed (RFC 8410). */
const PKCS8_ED25519 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
const siteKeys = new Map<string, Promise<{ privateKey: CryptoKey; x: string }>>();

/** The site's key pair for `secret`: the private key, and the public key's `x` (base64url) for the gate. */
export function siteKeyPair(secret: string): Promise<{ privateKey: CryptoKey; x: string }> {
  let kept = siteKeys.get(secret);
  if (!kept) {
    kept = (async () => {
      const mac = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const seed = new Uint8Array(await crypto.subtle.sign("HMAC", mac, new TextEncoder().encode(SITE_SEED_LABEL)));
      const pk8 = new Uint8Array(48);
      pk8.set(PKCS8_ED25519);
      pk8.set(seed, 16);
      const privateKey = await crypto.subtle.importKey("pkcs8", pk8, { name: "Ed25519" }, true, ["sign"]);
      const x = (await crypto.subtle.exportKey("jwk", privateKey)).x as string;
      return { privateKey, x };
    })();
    siteKeys.set(secret, kept);
  }
  return kept;
}

/** A `site` token: the role and expiry of the app token it goes with, Ed25519-signed. */
export async function makeSiteToken(role: "admin" | "ro" | "check", exp: number, secret = SECRET): Promise<string> {
  const payload = b64url(JSON.stringify({ role, exp, kind: "site" }));
  const { privateKey } = await siteKeyPair(secret);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, new TextEncoder().encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

/** The app's token and the site's, of one role and one expiry. */
export async function tokensFor(role: "admin" | "ro" | "check", ttlMs: number, secret = SECRET): Promise<{ token: string; site: string; exp: number }> {
  const token = await makeToken(role, secret, ttlMs);
  const payload = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
  const exp = JSON.parse(atob(payload + "=".repeat((4 - payload.length % 4) % 4))).exp as number;
  return { token, site: await makeSiteToken(role, exp, secret), exp };
}

/** `?action=site-key` (GET or POST, no credential): the public key the site's gate checks a session with. */
export async function siteKeyResponse(req: Request, secret = SECRET): Promise<Response | null> {
  if (new URL(req.url).searchParams.get("action") !== "site-key") return null;
  if (!secret) return json(500, { error: "auth not configured" });
  const { x } = await siteKeyPair(secret);
  return new Response(JSON.stringify({ keys: [{ kty: "OKP", crv: "Ed25519", x }] }), {
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
}

export type ViewerTokenEnv = { cronSecret: string; viewerPwd: string; roPwd: string; adminPwd: string; secret: string };

/**
 * The operator's viewer token (`?action=viewer-token`): the cron bearer, then the stored viewer password checked
 * against the read-only one, both in constant time, then a read-only token of VIEWER_TOKEN_TTL_MS. The reply carries
 * the token alone; no branch puts a password, or how it differs, into a body.
 */
export async function viewerToken(authorization: string | null, env: ViewerTokenEnv): Promise<{ status: number; body: Record<string, unknown> }> {
  const auth = authorization ?? "";
  if (!env.cronSecret) return { status: 503, body: { error: "CRON_SECRET not set" } };
  if (!auth.startsWith("Bearer ") || !constantTimeEqual(auth.slice(7).trim(), env.cronSecret)) {
    return { status: 401, body: { error: "unauthorised" } };
  }
  if (!env.secret || !env.roPwd) return { status: 500, body: { error: "auth not configured" } };
  if (!env.viewerPwd) return { status: 503, body: { error: "DAVIESLUO_VIEWER_PASSWORD not set" } };
  if (env.adminPwd && constantTimeEqual(env.viewerPwd, env.adminPwd)) {
    return { status: 409, body: { error: "the stored viewer password is the admin one: no token is minted for it" } };
  }
  if (!constantTimeEqual(env.viewerPwd, env.roPwd)) {
    return { status: 409, body: { error: "the stored viewer password is not the site's read-only password" } };
  }
  return { status: 200, body: await operatorToken("ro", env.secret) };
}

/** A token of `role` for VIEWER_TOKEN_TTL_MS, the site's session beside it, with their expiry. */
async function operatorToken(role: "ro" | "check", secret: string): Promise<Record<string, unknown>> {
  const { token, site, exp } = await tokensFor(role, VIEWER_TOKEN_TTL_MS, secret);
  return { token, site, role, exp };
}

/**
 * The operator's check token (`?action=check-token`): the cron bearer in constant time, then a token of role `check`
 * for VIEWER_TOKEN_TTL_MS. No password is read, so none can reach a body.
 */
export async function checkToken(authorization: string | null, env: Pick<ViewerTokenEnv, "cronSecret" | "secret">): Promise<{ status: number; body: Record<string, unknown> }> {
  const auth = authorization ?? "";
  if (!env.cronSecret) return { status: 503, body: { error: "CRON_SECRET not set" } };
  if (!auth.startsWith("Bearer ") || !constantTimeEqual(auth.slice(7).trim(), env.cronSecret)) {
    return { status: 401, body: { error: "unauthorised" } };
  }
  if (!env.secret) return { status: 500, body: { error: "auth not configured" } };
  return { status: 200, body: await operatorToken("check", env.secret) };
}

/**
 * The operator's two routes: null for any request that is neither `?action=viewer-token` nor `?action=check-token`
 * (the password form goes on), else the reply, never cached, a refused bearer answered only after the wrong-password delay.
 */
export async function viewerTokenResponse(req: Request, env: ViewerTokenEnv): Promise<Response | null> {
  const action = new URL(req.url).searchParams.get("action");
  if (action !== "viewer-token" && action !== "check-token") return null;
  const authorization = req.headers.get("authorization");
  const out = action === "viewer-token" ? await viewerToken(authorization, env) : await checkToken(authorization, env);
  if (out.status === 401) await new Promise((r) => setTimeout(r, WRONG_PASSWORD_DELAY_MS));
  return new Response(JSON.stringify(out.body), {
    status: out.status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// clientIpFromHeaders lives in ../_shared/ip.ts (imported +
// re-exported above) so ops-error's error rows and this function's
// lockout key share one trust order — see that module for the full
// x-real-ip / last-XFF-entry / sentinel rationale.

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ---------------- The sign-in's state: this address's lockout, and the hour's budget ----------------
const SB_HEADERS = {
  "apikey": SERVICE_KEY,
  "Authorization": `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

// Per-IP key derivation. See `clientIpFromHeaders` above for the full
// rationale: prefer the gateway-trusted `x-real-ip`, then the LAST
// entry of `x-forwarded-for` (proxies append as they forward, so the
// last hop is the most-trusted; the FIRST entry is the client-supplied
// value an attacker can rotate to defeat the per-IP lockout), then a
// sentinel so a missing header still keys per-deploy rather than
// bypassing the limiter entirely. Aliased here (and exported above)
// for unit testing.
const clientIp = clientIpFromHeaders;

/**
 * Wrong passwords an hour, across every address that has never signed in, before sign-in is refused to such addresses
 * (the audit of 2026-11-21, A2). The lockout below is per address, and addresses are cheap; this budget is not. It
 * never holds a device that has signed in before (`isKnownDevice`), so nobody can lock the owner out of his own site
 * by guessing from elsewhere: his browsers carry the proof, and are judged as before.
 */
export const GLOBAL_WRONG_MAX = 20;
/** What a refused address is told to wait: the page shows it, and the budget's hour slides meanwhile. */
export const BUSY_RETRY_MS = 15 * 60 * 1000;
/** A device's proof is good this long after it was issued. */
export const DEVICE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
/** Signed with the app's secret under its own label, so it can never pass for an app token (which carries a role). */
const DEVICE_LABEL = "dp-device-v1.";

/** A device's proof that it has signed in: `{ kind: "device", iat }`, issued with every successful sign-in from an unknown one. */
export async function makeDeviceToken(secret = SECRET, now = Date.now()): Promise<string> {
  const payload = b64url(JSON.stringify({ kind: "device", iat: now }));
  return `${payload}.${await sign(DEVICE_LABEL + payload, secret)}`;
}

/** Whether `token` is a proof this function issued with `secret`, not older than `DEVICE_MAX_AGE_MS`. */
export async function isKnownDevice(token: unknown, secret = SECRET, now = Date.now()): Promise<boolean> {
  if (!secret || typeof token !== "string" || token.length > 512) return false;
  const [p, s] = token.split(".");
  if (!p || !s) return false;
  if (!constantTimeEqual(await sign(DEVICE_LABEL + p, secret), s)) return false;
  try {
    const padded = p.replace(/-/g, "+").replace(/_/g, "/");
    const o = JSON.parse(atob(padded + "=".repeat((4 - padded.length % 4) % 4)));
    return o?.kind === "device" && typeof o.iat === "number" && o.iat <= now + 5 * 60_000 && now - o.iat <= DEVICE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

/** The address's lockout (unix ms, or null) and the hour's wrong passwords across unknown devices. */
export type SignInState = { lockoutUntil: number | null; wrongHour: number };
type BumpResult = { attempts_out: number; lockout_until_out: number | null; locked_out: boolean };

/**
 * Both in one read (`auth_state`, migration 0360). Null when the state cannot be read: the caller then judges nothing.
 * A database from before that migration answers that it has no such function (404, PGRST202): then the lockout is read
 * from its table as before and the budget is 0, so this function and its migration may land in either order.
 */
async function readState(ip: string): Promise<SignInState | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/auth_state`, {
      method: "POST", headers: SB_HEADERS, body: JSON.stringify({ _ip: ip }), signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const rows = await res.json();
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row || typeof row !== "object") return null;
      return { lockoutUntil: row.lockout_until == null ? null : Number(row.lockout_until), wrongHour: Number(row.wrong_hour) || 0 };
    }
    const text = await res.text();
    if (res.status !== 404 || !/PGRST202/.test(text)) return null;
    const old = await fetch(`${SUPABASE_URL}/rest/v1/auth_attempts?ip=eq.${encodeURIComponent(ip)}&select=lockout_until`, {
      headers: SB_HEADERS, signal: AbortSignal.timeout(5_000),
    });
    if (!old.ok) return null;
    const rows = await old.json();
    return { lockoutUntil: Array.isArray(rows) && rows[0] ? rows[0].lockout_until ?? null : null, wrongHour: 0 };
  } catch {
    return null;
  }
}

// Atomic increment-or-lockout via the bump_auth_attempt SQL function. Doing
// the read-modify-write in a single statement avoids the TOCTOU race that
// Codex flagged: if two wrong-password requests for the same IP land at the
// same time they each see the OTHER's increment, so the threshold can't
// be undercounted by parallel traffic. Null when it could not be counted.
async function bumpAttempt(ip: string): Promise<BumpResult | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/bump_auth_attempt`, {
      method: "POST",
      headers: SB_HEADERS,
      body: JSON.stringify({ _ip: ip, _max: MAX_ATTEMPTS, _lockout_ms: LOCKOUT_MS }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as BumpResult[];
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch {
    return null;
  }
}

/** One more wrong password in the hour's budget; the hour's count after it, or null when it could not be counted. */
async function bumpBudget(): Promise<number | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/auth_budget_bump`, {
      method: "POST", headers: SB_HEADERS, body: "{}", signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const n = Number(await res.json());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function clearAttempts(ip: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/auth_attempts?ip=eq.${encodeURIComponent(ip)}`, {
    method: "DELETE",
    headers: SB_HEADERS,
    signal: AbortSignal.timeout(5_000),
  });
}

export type SignInDeps = {
  env: { adminPwd: string; roPwd: string; secret: string };
  now: () => number;
  state: (ip: string) => Promise<SignInState | null>;
  bump: (ip: string) => Promise<BumpResult | null>;
  bumpBudget: () => Promise<number | null>;
  clear: (ip: string) => Promise<void>;
  wait: (ms: number) => Promise<void>;
  report: (kind: string, o: { message?: string; context?: unknown }) => Promise<void>;
};

/**
 * The password form (POST, `{ password, device? }`), with everything outside it injected so its order is pinned:
 *
 *   1. the state, this address's lockout and the hour's budget. UNREADABLE: 503, and nothing is judged. Until
 *      2026-11-21 an unreadable lockout read as "not locked" and an uncountable wrong password as "attempt 0 of 3", so
 *      while the database answered errors the only limit left was the half-second wait, which runs in parallel;
 *   2. locked out: 429 with when it ends, as before;
 *   3. the budget (`GLOBAL_WRONG_MAX`), for a device that cannot prove it has signed in before: spent, 429 `busy` with
 *      a time to try again, the password neither judged nor counted;
 *   4. the password, both compares in constant time. Right: the address's count is cleared and the answer carries the
 *      app's token, the site's, and a proof for a device that had none;
 *   5. wrong: the wait, then the address's count. UNCOUNTABLE: 503. An unknown device's also goes into the budget,
 *      and the one that spends it is said in the errors box.
 */
export async function signIn(req: Request, d: SignInDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!d.env.secret || !d.env.adminPwd || !d.env.roPwd) return { status: 500, body: { error: "auth not configured" } };
  const ip = clientIp(req);
  const state = await d.state(ip);
  if (!state) return { status: 503, body: { error: "unavailable" } };
  const now = d.now();
  if (state.lockoutUntil && state.lockoutUntil > now) return { status: 429, body: { error: "locked", lockoutUntil: state.lockoutUntil } };

  let body: { password?: unknown; device?: unknown };
  try { body = await req.json(); } catch { return { status: 400, body: { error: "bad json" } }; }
  const pw = (body?.password ?? "").toString();
  const known = await isKnownDevice(body?.device, d.env.secret, now);
  if (!known && state.wrongHour >= GLOBAL_WRONG_MAX) {
    return { status: 429, body: { error: "busy", lockoutUntil: now + BUSY_RETRY_MS } };
  }

  // Both compares always run: which password a guess was nearer to is not for the clock to say.
  const isAdmin = constantTimeEqual(pw, d.env.adminPwd), isRo = constantTimeEqual(pw, d.env.roPwd);
  const role: "admin" | "ro" | null = isAdmin ? "admin" : isRo ? "ro" : null;
  if (role) {
    // Successful login — wipe any failed-attempt counter for this IP.
    d.clear(ip).catch(() => {});
    // The app's token and, beside it, the site's session for the gate (`site`), of one expiry.
    const { token, site } = await tokensFor(role, TOKEN_TTL_MS, d.env.secret);
    return { status: 200, body: { token, site, role, ...(known ? {} : { device: await makeDeviceToken(d.env.secret, now) }) } };
  }

  // Wrong password → atomic increment via SQL function. Also pause ~500 ms before responding: the throughput of a
  // guessing run is what slows it, and a real user typing a wrong password notices nothing. `WRONG_PASSWORD_DELAY_MS`
  // is pinned so a regression to 0 cannot quietly reopen that window.
  await d.wait(WRONG_PASSWORD_DELAY_MS);
  const result = await d.bump(ip);
  if (!result) return { status: 503, body: { error: "unavailable" } };
  if (!known) {
    const spent = await d.bumpBudget().catch(() => null);
    if (spent === GLOBAL_WRONG_MAX) {
      await d.report("auth.budget", {
        message: `${spent} wrong passwords in an hour from addresses that have never signed in: sign-in is refused to such addresses until the hour's count falls`,
      }).catch(() => {});
    }
  }
  if (result.locked_out) {
    return { status: 429, body: { error: "locked", lockoutUntil: result.lockout_until_out ?? now + LOCKOUT_MS } };
  }
  const attempts = result.attempts_out ?? 0;
  return { status: 401, body: { error: "invalid", attempts, attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts) } };
}

// Guarded so tests can import the helpers above without spinning up
// the server. Supabase's runtime executes index.ts as the entry
// module, so `import.meta.main` is true in production.
if (import.meta.main) Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    // The site gate's public key: no credential, no body, before the method check (the gate reads it with a GET).
    const sk = await siteKeyResponse(req);
    if (sk) return sk;
    if (req.method !== "POST")    return json(405, { error: "method not allowed" });

    // The operator's viewer and check tokens, before anything of the password form: they read no body and touch no lockout row.
    const vt = await viewerTokenResponse(req, {
      cronSecret: CRON_SECRET, viewerPwd: VIEWER_PWD, roPwd: RO_PWD, adminPwd: ADMIN_PWD, secret: SECRET,
    });
    if (vt) return vt;

    const out = await signIn(req, {
      env: { adminPwd: ADMIN_PWD, roPwd: RO_PWD, secret: SECRET },
      now: () => Date.now(),
      state: readState, bump: bumpAttempt, bumpBudget, clear: clearAttempts,
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
      report: reportServerError,
    });
    return json(out.status, out.body);
  } catch (e) {
    // Unhandled exception — turn it into an ops_errors row so it's
    // visible in the admin badge, then return a generic 500.
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    await reportServerError("auth.unhandled", { message: msg });
    return json(500, { error: "internal" });
  }
});

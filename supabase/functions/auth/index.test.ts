// Pin tests for the auth Edge Function's pure helpers — HMAC token
// signing, base64url encoding, IP extraction. The Deno.serve(...)
// entry point is guarded by `import.meta.main`, so importing the
// helpers here does NOT bind a port.
//
// Run locally: `deno test --allow-env supabase/functions/auth/`
// CI runs the same via the deploy workflow.

import { assertEquals, assert, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  b64url,
  sign,
  makeToken,
  clientIpFromHeaders,
  WRONG_PASSWORD_DELAY_MS,
  VIEWER_TOKEN_TTL_MS,
  viewerToken,
  checkToken,
  makeSiteToken,
  siteKeyPair,
  siteKeyResponse,
  tokensFor,
  viewerTokenResponse,
  signIn,
  type SignInDeps,
  type SignInState,
  makeDeviceToken,
  isKnownDevice,
  GLOBAL_WRONG_MAX,
  BUSY_RETRY_MS,
  DEVICE_MAX_AGE_MS,
} from "./index.ts";
import { verifyToken } from "../data/index.ts";

Deno.test("b64url: url-safe alphabet, no padding", () => {
  const s = b64url("hello world!?");
  // base64url has no '+', '/', or '='. It uses '-' and '_' in their place.
  assert(!s.includes("+"));
  assert(!s.includes("/"));
  assert(!s.includes("="));
});

Deno.test("sign: deterministic HMAC-SHA256 — same payload + secret = same sig", async () => {
  const a = await sign("payload", "secret");
  const b = await sign("payload", "secret");
  assertEquals(a, b);
});

Deno.test("sign: different secret produces a different signature", async () => {
  const a = await sign("payload", "secret-1");
  const b = await sign("payload", "secret-2");
  assertNotEquals(a, b);
});

Deno.test("makeToken + verifyToken roundtrip with the same secret succeeds", async () => {
  const secret = "test-secret-1234";
  const token = await makeToken("admin", secret);
  const v = await verifyToken(token, secret);
  assertEquals(v?.role, "admin");
  // exp is "future" (now + 24h by default).
  assert((v?.exp ?? 0) > Date.now());
});

Deno.test("verifyToken: rejects token signed with a different secret", async () => {
  const token = await makeToken("admin", "secret-A");
  const v = await verifyToken(token, "secret-B");
  assertEquals(v, null);
});

Deno.test("verifyToken: rejects expired tokens", async () => {
  const secret = "test-secret-expired";
  // Negative TTL = exp is in the past → must be rejected even with valid signature.
  const token = await makeToken("admin", secret, -1);
  const v = await verifyToken(token, secret);
  assertEquals(v, null);
});

Deno.test("verifyToken: rejects malformed tokens (no dot, empty parts)", async () => {
  assertEquals(await verifyToken("",        "any"), null);
  assertEquals(await verifyToken("nodothere", "any"), null);
  assertEquals(await verifyToken(".",        "any"), null);
});

Deno.test("verifyToken: refuses to operate with an empty secret", async () => {
  // Edge Function bootstraps with SECRET="" if APP_AUTH_SECRET isn't set.
  // verifyToken must short-circuit rather than match an empty HMAC.
  assertEquals(await verifyToken("a.b", ""), null);
});

Deno.test("clientIpFromHeaders: cf-connecting-ip is IGNORED (Supabase-direct path, header is client-supplied)", () => {
  // Critical security pin: the browser calls *.supabase.co directly,
  // no Cloudflare in front, so `cf-connecting-ip` is whatever the
  // attacker wrote. Honouring it would let them rotate the value per
  // request and bypass per-IP lockout entirely. Only x-real-ip /
  // last-xff (both gateway-set) are trusted.
  const req = new Request("https://x", {
    headers: {
      "cf-connecting-ip": "1.2.3.4",       // attacker-supplied
      "x-real-ip":        "9.9.9.9",       // gateway-truth
      "x-forwarded-for":  "5.6.7.8",
    },
  });
  assertEquals(clientIpFromHeaders(req), "9.9.9.9");
});

Deno.test("clientIpFromHeaders: x-real-ip wins over x-forwarded-for when no cf header", () => {
  const req = new Request("https://x", {
    headers: { "x-real-ip": "9.9.9.9", "x-forwarded-for": "5.6.7.8" },
  });
  assertEquals(clientIpFromHeaders(req), "9.9.9.9");
});

Deno.test("clientIpFromHeaders: x-forwarded-for takes the LAST entry, not the first", () => {
  // Proxies append as they forward, so the last hop is the gateway's
  // truth. The first entry is what the original client sent and is
  // trivially spoofable — a per-IP limiter that keys off the first
  // entry can be bypassed by rotating `x-forwarded-for: 1.2.3.4`.
  const req = new Request("https://x", {
    headers: { "x-forwarded-for": "spoofed-by-client, 10.0.0.2, 172.16.0.5" },
  });
  assertEquals(clientIpFromHeaders(req), "172.16.0.5");
});

Deno.test("clientIpFromHeaders: x-forwarded-for with one entry returns that entry", () => {
  const req = new Request("https://x", { headers: { "x-forwarded-for": "10.0.0.1" } });
  assertEquals(clientIpFromHeaders(req), "10.0.0.1");
});

Deno.test("clientIpFromHeaders: missing headers → 'unknown' sentinel (limiter keys safely)", () => {
  assertEquals(clientIpFromHeaders(new Request("https://x")), "unknown");
});

Deno.test("WRONG_PASSWORD_DELAY_MS is on (regressions to 0 would re-open the brute-force window)", () => {
  // 4-digit numeric passwords have a 10⁴ keyspace; per-IP lockout
  // can be bypassed by IP rotation, so the response-latency throttle
  // is the secondary defense. Pin it on so a future refactor that
  // accidentally drops the await would break CI.
  assert(WRONG_PASSWORD_DELAY_MS >= 200);
});

// ---- The operator's viewer token (`?action=viewer-token`; Davies, 2026-10-29) --------------------------------------
// Invented secrets, as every fixture's.
const VT_ENV = { cronSecret: "cron-test-secret", viewerPwd: "ro-pass-test", roPwd: "ro-pass-test", adminPwd: "admin-pass-test", secret: "sign-test-secret" };
const leaks = (body: Record<string, unknown>) =>
  [VT_ENV.cronSecret, VT_ENV.viewerPwd, VT_ENV.roPwd, VT_ENV.adminPwd, VT_ENV.secret].filter((v) => JSON.stringify(body).includes(v));

Deno.test("viewerToken: only the cron bearer gets one; a missing, wrong or empty bearer is 401 and says nothing else", async () => {
  for (const auth of [null, "", "Bearer ", "Bearer wrong", "cron-test-secret", "Basic cron-test-secret", `Bearer ${VT_ENV.cronSecret}x`]) {
    const out = await viewerToken(auth, VT_ENV);
    assertEquals(out.status, 401, String(auth));
    assertEquals(out.body, { error: "unauthorised" });
  }
  // No CRON_SECRET configured: nothing, not even an empty bearer, opens it.
  assertEquals((await viewerToken("Bearer ", { ...VT_ENV, cronSecret: "" })).status, 503);
});

Deno.test("viewerToken: a read-only token of 30 minutes that the verifying functions accept, and never a password", async () => {
  const t0 = Date.now();
  const out = await viewerToken(`Bearer ${VT_ENV.cronSecret}`, VT_ENV);
  assertEquals(out.status, 200);
  assertEquals(Object.keys(out.body).sort(), ["exp", "role", "site", "token"]);
  assertEquals(out.body.role, "ro");
  const v = await verifyToken(out.body.token as string, VT_ENV.secret);
  assertEquals(v?.role, "ro");
  assertEquals(v?.exp, out.body.exp);
  assert(VIEWER_TOKEN_TTL_MS <= 30 * 60 * 1000);
  assert((out.body.exp as number) >= t0 + VIEWER_TOKEN_TTL_MS && (out.body.exp as number) <= Date.now() + VIEWER_TOKEN_TTL_MS);
  // Signed with the app's secret, so another secret's check refuses it.
  assertEquals(await verifyToken(out.body.token as string, "another-secret"), null);
  assertEquals(leaks(out.body), []);
});

Deno.test("viewerToken: no token unless the stored password IS the read-only one; never admin", async () => {
  const bearer = `Bearer ${VT_ENV.cronSecret}`;
  const admin = await viewerToken(bearer, { ...VT_ENV, viewerPwd: VT_ENV.adminPwd });
  assertEquals(admin.status, 409);
  const other = await viewerToken(bearer, { ...VT_ENV, viewerPwd: "something-else" });
  assertEquals(other.status, 409);
  const unset = await viewerToken(bearer, { ...VT_ENV, viewerPwd: "" });
  assertEquals(unset.status, 503);
  const unconfigured = await viewerToken(bearer, { ...VT_ENV, secret: "" });
  assertEquals(unconfigured.status, 500);
  for (const o of [admin, other, unset, unconfigured]) {
    assertEquals(o.body.token, undefined);
    assertEquals(leaks(o.body), []);
  }
});

Deno.test("viewer-token route: other requests go on to the password form; a refusal waits, nothing is cached", async () => {
  assertEquals(await viewerTokenResponse(new Request("https://x/auth", { method: "POST" }), VT_ENV), null);
  assertEquals(await viewerTokenResponse(new Request("https://x/auth?action=other", { method: "POST" }), VT_ENV), null);
  const t0 = Date.now();
  const refused = await viewerTokenResponse(new Request("https://x/auth?action=viewer-token", { method: "POST", headers: { authorization: "Bearer nope" } }), VT_ENV);
  assertEquals(refused?.status, 401);
  assert(Date.now() - t0 >= WRONG_PASSWORD_DELAY_MS - 5);
  assertEquals(refused?.headers.get("cache-control"), "no-store");
  await refused?.body?.cancel();
  const ok = await viewerTokenResponse(new Request("https://x/auth?action=viewer-token", { method: "POST", headers: { authorization: `Bearer ${VT_ENV.cronSecret}` } }), VT_ENV);
  assertEquals(ok?.status, 200);
  assertEquals(ok?.headers.get("cache-control"), "no-store");
  const body = await ok!.json();
  assertEquals(body.role, "ro");
  assertEquals(leaks(body), []);
});

// ---- The operator's check token (`?action=check-token`; Davies, 2026-11-05) -----------------------------------------
// The viewer's token no longer opens the Agents page; the operator's check of it on the real site needs its own kind.
Deno.test("checkToken: only the cron bearer gets one; a missing, wrong or empty bearer is 401 and says nothing else", async () => {
  for (const auth of [null, "", "Bearer ", "Bearer wrong", "cron-test-secret", `Bearer ${VT_ENV.cronSecret}x`]) {
    const out = await checkToken(auth, VT_ENV);
    assertEquals([out.status, out.body], [401, { error: "unauthorised" }], String(auth));
  }
  assertEquals((await checkToken("Bearer ", { ...VT_ENV, cronSecret: "" })).status, 503);
  assertEquals((await checkToken(`Bearer ${VT_ENV.cronSecret}`, { ...VT_ENV, secret: "" })).status, 500);
});

Deno.test("checkToken: a token of role check, 30 minutes, that the verifying functions accept; no password is read or returned", async () => {
  const out = await checkToken(`Bearer ${VT_ENV.cronSecret}`, { cronSecret: VT_ENV.cronSecret, secret: VT_ENV.secret });
  assertEquals(out.status, 200);
  assertEquals(Object.keys(out.body).sort(), ["exp", "role", "site", "token"]);
  const v = await verifyToken(out.body.token as string, VT_ENV.secret);
  assertEquals([v?.role, v?.exp], ["check", out.body.exp]);
  assert((out.body.exp as number) <= Date.now() + VIEWER_TOKEN_TTL_MS);
  assertEquals(leaks(out.body), []);
});

Deno.test("check-token route: answered beside viewer-token, never cached, a refusal after the wrong-password delay", async () => {
  const t0 = Date.now();
  const refused = await viewerTokenResponse(new Request("https://x/auth?action=check-token", { method: "POST", headers: { authorization: "Bearer nope" } }), VT_ENV);
  assertEquals(refused?.status, 401);
  assert(Date.now() - t0 >= WRONG_PASSWORD_DELAY_MS - 5);
  await refused?.body?.cancel();
  const ok = await viewerTokenResponse(new Request("https://x/auth?action=check-token", { method: "POST", headers: { authorization: `Bearer ${VT_ENV.cronSecret}` } }), VT_ENV);
  assertEquals([ok?.status, ok?.headers.get("cache-control")], [200, "no-store"]);
  assertEquals((await ok!.json()).role, "check");
});

// ---- The site gate's session (`site`; Davies, 2026-11-05: "任何人不登录应该任何东西都下载不了才行") ---------------------------
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0));
const gateKey = async (x: string) => await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x }, { name: "Ed25519" }, false, ["verify"]);

Deno.test("siteKeyPair: derived from the app secret alone, the same each time, another for another secret; the vector src/app/site_gate.test.js derives too", async () => {
  const a = await siteKeyPair(VT_ENV.secret), b = await siteKeyPair(VT_ENV.secret), c = await siteKeyPair("another-secret");
  assertEquals(a.x, b.x);
  assertNotEquals(a.x, c.x);
  // The same derivation in Node (site_gate.test.js) must find the same public key: the two halves agree.
  assertEquals(a.x, "adDDQi7Ctm1iYnq-wM4zd3Kyjh18PZ-HIgrtaXBifyY");
});

Deno.test("tokensFor: the app's token and the site's, one role and one expiry; the site's verifies with the public key alone", async () => {
  const t = await tokensFor("ro", 60_000, VT_ENV.secret);
  assertEquals((await verifyToken(t.token, VT_ENV.secret))?.role, "ro");
  const [p, s] = t.site.split(".");
  assertEquals(JSON.parse(new TextDecoder().decode(unb64(p))), { role: "ro", exp: t.exp, kind: "site" });
  const pub = await gateKey((await siteKeyPair(VT_ENV.secret)).x);
  assert(await crypto.subtle.verify({ name: "Ed25519" }, pub, unb64(s), new TextEncoder().encode(p)));
  // Another secret's key refuses it; and the site's token is no app token (the data functions refuse it).
  assert(!(await crypto.subtle.verify({ name: "Ed25519" }, await gateKey((await siteKeyPair("another-secret")).x), unb64(s), new TextEncoder().encode(p))));
  assertEquals(await verifyToken(t.site, VT_ENV.secret), null);
  assertEquals((await makeSiteToken("admin", 5, VT_ENV.secret)).split(".").length, 2);
});

Deno.test("the operator's tokens carry the site's session too, of their own role and expiry", async () => {
  const out = await checkToken(`Bearer ${VT_ENV.cronSecret}`, VT_ENV);
  const claims = JSON.parse(new TextDecoder().decode(unb64((out.body.site as string).split(".")[0])));
  assertEquals(claims, { role: "check", exp: out.body.exp, kind: "site" });
});

Deno.test("site-key route: the public key for anyone, by GET, cached a few minutes; no key without the app secret; others go on", async () => {
  assertEquals(await siteKeyResponse(new Request("https://x/auth", { method: "POST" }), VT_ENV.secret), null);
  const r = await siteKeyResponse(new Request("https://x/auth?action=site-key"), VT_ENV.secret);
  assertEquals([r?.status, r?.headers.get("cache-control")], [200, "public, max-age=300"]);
  assertEquals(await r!.json(), { keys: [{ kty: "OKP", crv: "Ed25519", x: (await siteKeyPair(VT_ENV.secret)).x }] });
  const none = await siteKeyResponse(new Request("https://x/auth?action=site-key"), "");
  assertEquals(none?.status, 500);
  await none?.body?.cancel();
});

// ---- The password form (signIn): the audit of 2026-11-21, A2. Until then the flow lived inside Deno.serve, untested. ----

const SECRET = "test-secret-for-the-password-form";
const ENVS = { adminPwd: "the-admin-password", roPwd: "the-viewer-password", secret: SECRET };
type Calls = { state: number; bump: number; budget: number; clear: number; waited: number[]; reports: string[] };
function signInDeps(o: {
  state?: SignInState | null; bump?: { attempts_out: number; lockout_until_out: number | null; locked_out: boolean } | null;
  budgetAfter?: number | null; now?: number;
} = {}): { d: SignInDeps; calls: Calls } {
  const calls: Calls = { state: 0, bump: 0, budget: 0, clear: 0, waited: [], reports: [] };
  const d: SignInDeps = {
    env: ENVS,
    now: () => o.now ?? 1_800_000_000_000,
    state: () => { calls.state++; return Promise.resolve(o.state === undefined ? { lockoutUntil: null, wrongHour: 0 } : o.state); },
    bump: () => { calls.bump++; return Promise.resolve(o.bump === undefined ? { attempts_out: 1, lockout_until_out: null, locked_out: false } : o.bump); },
    bumpBudget: () => { calls.budget++; return Promise.resolve(o.budgetAfter === undefined ? 1 : o.budgetAfter); },
    clear: () => { calls.clear++; return Promise.resolve(); },
    wait: (ms) => { calls.waited.push(ms); return Promise.resolve(); },
    report: (kind) => { calls.reports.push(kind); return Promise.resolve(); },
  };
  return { d, calls };
}
const form = (body: unknown) => new Request("https://x.supabase.co/functions/v1/auth", {
  method: "POST", headers: { "x-real-ip": "203.0.113.7", "content-type": "application/json" }, body: JSON.stringify(body),
});

Deno.test("signIn: the right password gives the app's token, the site's and a device proof; the address's count is cleared", async () => {
  const { d, calls } = signInDeps();
  const r = await signIn(form({ password: ENVS.adminPwd }), d);
  assertEquals([r.status, r.body.role], [200, "admin"]);
  assertEquals((await verifyToken(String(r.body.token), SECRET))?.role, "admin");
  assert(typeof r.body.site === "string");
  assertEquals(await isKnownDevice(r.body.device, SECRET, 1_800_000_000_000), true);
  assertEquals([calls.clear, calls.bump, calls.budget, calls.waited.length], [1, 0, 0, 0]);
  const ro = await signIn(form({ password: ENVS.roPwd }), signInDeps().d);
  assertEquals([ro.status, ro.body.role], [200, "ro"]);
});

Deno.test("signIn: a device that proves it signed in before gets no second proof", async () => {
  const device = await makeDeviceToken(SECRET, 1_800_000_000_000 - 86400e3);
  const r = await signIn(form({ password: ENVS.adminPwd, device }), signInDeps().d);
  assertEquals([r.status, "device" in r.body], [200, false]);
});

Deno.test("signIn: while the lockout state cannot be read nothing is judged, not even the right password (it failed open until 2026-11-21)", async () => {
  for (const password of [ENVS.adminPwd, "a wrong one"]) {
    const { d, calls } = signInDeps({ state: null });
    const r = await signIn(form({ password }), d);
    assertEquals([r.status, r.body], [503, { error: "unavailable" }]);
    assertEquals([calls.bump, calls.budget, calls.clear, calls.waited.length], [0, 0, 0, 0]);
  }
});

Deno.test("signIn: a wrong password that cannot be counted is 503, never \"attempt 0 of 3\"", async () => {
  const { d, calls } = signInDeps({ bump: null });
  const r = await signIn(form({ password: "a wrong one" }), d);
  assertEquals([r.status, r.body], [503, { error: "unavailable" }]);
  assertEquals(calls.waited, [WRONG_PASSWORD_DELAY_MS]);
});

Deno.test("signIn: a wrong password waits, counts for its address and in the hour's budget, and says what is left", async () => {
  const { d, calls } = signInDeps({ bump: { attempts_out: 2, lockout_until_out: null, locked_out: false } });
  const r = await signIn(form({ password: "a wrong one" }), d);
  assertEquals([r.status, r.body], [401, { error: "invalid", attempts: 2, attemptsLeft: 1 }]);
  assertEquals([calls.waited, calls.bump, calls.budget, calls.clear], [[WRONG_PASSWORD_DELAY_MS], 1, 1, 0]);
  // The third locks the address, as before.
  const locked = await signIn(form({ password: "a wrong one" }), signInDeps({ bump: { attempts_out: 0, lockout_until_out: 1_900_000_000_000, locked_out: true } }).d);
  assertEquals([locked.status, locked.body], [429, { error: "locked", lockoutUntil: 1_900_000_000_000 }]);
});

Deno.test("signIn: a locked address is refused before its password is read", async () => {
  const { d, calls } = signInDeps({ state: { lockoutUntil: 1_800_000_000_000 + 60_000, wrongHour: 0 } });
  const r = await signIn(form({ password: ENVS.adminPwd }), d);
  assertEquals([r.status, r.body.error], [429, "locked"]);
  assertEquals([calls.bump, calls.clear], [0, 0]);
  // A lockout that has lapsed holds nobody.
  assertEquals((await signIn(form({ password: ENVS.adminPwd }), signInDeps({ state: { lockoutUntil: 1_800_000_000_000 - 1, wrongHour: 0 } }).d)).status, 200);
});

Deno.test("signIn: with the hour's budget spent an unknown device is refused unjudged and uncounted, with a time to try again", async () => {
  const spent = { lockoutUntil: null, wrongHour: GLOBAL_WRONG_MAX };
  for (const password of [ENVS.adminPwd, "a wrong one"]) {
    const { d, calls } = signInDeps({ state: spent });
    const r = await signIn(form({ password }), d);
    assertEquals([r.status, r.body], [429, { error: "busy", lockoutUntil: 1_800_000_000_000 + BUSY_RETRY_MS }]);
    assertEquals([calls.bump, calls.budget, calls.clear, calls.waited.length], [0, 0, 0, 0]);
  }
  // One under the budget is still judged.
  assertEquals((await signIn(form({ password: ENVS.adminPwd }), signInDeps({ state: { lockoutUntil: null, wrongHour: GLOBAL_WRONG_MAX - 1 } }).d)).status, 200);
});

Deno.test("signIn: the budget never holds a device that has signed in before, so guessing from elsewhere cannot lock the owner out", async () => {
  const device = await makeDeviceToken(SECRET, 1_800_000_000_000 - 86400e3);
  const spent = { lockoutUntil: null, wrongHour: GLOBAL_WRONG_MAX * 50 };
  const ok = await signIn(form({ password: ENVS.adminPwd, device }), signInDeps({ state: spent }).d);
  assertEquals([ok.status, ok.body.role], [200, "admin"]);
  // Its own wrong password counts for its address and not in the budget.
  const { d, calls } = signInDeps({ state: spent });
  const wrong = await signIn(form({ password: "a wrong one", device }), d);
  assertEquals([wrong.status, calls.bump, calls.budget], [401, 1, 0]);
});

Deno.test("signIn: the wrong password that spends the budget is said in the errors box, once", async () => {
  const at = signInDeps({ budgetAfter: GLOBAL_WRONG_MAX });
  await signIn(form({ password: "a wrong one" }), at.d);
  assertEquals(at.calls.reports, ["auth.budget"]);
  for (const n of [GLOBAL_WRONG_MAX - 1, GLOBAL_WRONG_MAX + 1, null]) {
    const other = signInDeps({ budgetAfter: n });
    assertEquals((await signIn(form({ password: "a wrong one" }), other.d)).status, 401);
    assertEquals(other.calls.reports, []);
  }
});

Deno.test("isKnownDevice: only a proof this function signed, of the right kind and age", async () => {
  const now = 1_800_000_000_000;
  const good = await makeDeviceToken(SECRET, now);
  assertEquals(await isKnownDevice(good, SECRET, now), true);
  assertEquals(await isKnownDevice(good, "another-secret", now), false);
  assertEquals(await isKnownDevice(good, SECRET, now + DEVICE_MAX_AGE_MS + 1), false);
  assertEquals(await isKnownDevice(await makeDeviceToken(SECRET, now + 3600e3), SECRET, now), false);
  for (const bad of [undefined, null, 7, "", "a.b", good.slice(0, -2) + "zz", "x".repeat(600)]) assertEquals(await isKnownDevice(bad, SECRET, now), false);
  // An app token is not a device proof, and a device proof is not an app token.
  assertEquals(await isKnownDevice(await makeToken("admin", SECRET), SECRET, now), false);
  assertEquals(await verifyToken(good, SECRET), null);
});

Deno.test("signIn: unconfigured, or a body that is not JSON", async () => {
  const { d } = signInDeps();
  assertEquals((await signIn(form({ password: "x" }), { ...d, env: { ...ENVS, secret: "" } })).status, 500);
  const raw = new Request("https://x.supabase.co/functions/v1/auth", { method: "POST", body: "not json" });
  assertEquals((await signIn(raw, d)).status, 400);
});

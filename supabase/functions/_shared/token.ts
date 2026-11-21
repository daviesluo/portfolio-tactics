// Shared HMAC app-token verification for the Edge Functions: the one copy.
//
// Every function that checks the app token imports `verifyToken` from here
// (`data`, `trading212`, `ops-error`, `prices`, `chart`, `fundamentals`,
// `agents`, `overnight-fetch`), `auth` and `snapshot-record` sign with
// `sign`/`b64url`, and the cron-bearer checks use `constantTimeEqual`. The
// inline copies `data`, `trading212` and `ops-error` once carried, which
// had drifted apart, are gone; don't add another.
//
// Token format (issued by the `auth` function): `<b64url(payload)>.<b64url(sig)>`
// where payload is `{ role: "admin" | "ro" | "check", exp: <ms> }`, signed
// HMAC-SHA256 with APP_AUTH_SECRET. `check` is the operator's check of the real
// site (`auth?action=check-token`, cron bearer, 30 minutes, no password): every
// function that tests `role === "admin"` treats it as the viewer, and `agents`
// lets it read the Agents page, which it refuses the viewer (2026-11-05).

const SECRET = Deno.env.get("APP_AUTH_SECRET") ?? "";
const enc = new TextEncoder();

export function b64url(bytes: Uint8Array | string): string {
  const buf = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  const s = btoa(String.fromCharCode(...buf));
  return s.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return b64url(new Uint8Array(sig));
}

export type Role = "admin" | "ro" | "check";
export type Verified = { role: Role; exp: number };

// Constant-time string equality: a secret compared byte by byte with an
// early exit tells a caller, by how long the answer takes, how much of a
// guess was right. A length mismatch short-circuits only the length check
// (already-leaked information), not the per-byte content.
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * A shared secret, compared in constant time as SHA-256 digests: the digests are one length whatever was presented, so
 * neither a guess's length nor how much of it was right is told by the clock. A missing or empty secret on either side
 * is a refusal. The one copy (the audit of 2026-11-21, A16): `monitor` and the three desks' ingests each carried it.
 */
export async function secretMatches(given: string | null | undefined, secret: string): Promise<boolean> {
  if (!secret || !given) return false;
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(given)), crypto.subtle.digest("SHA-256", enc.encode(secret))]);
  const hex = (x: ArrayBuffer) => [...new Uint8Array(x)].map((v) => v.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(hex(a), hex(b));
}

/** `Authorization: Bearer <secret>`, the scheduler's bearer among them, compared in constant time. An empty secret refuses. */
export function bearerIs(authorization: string | null | undefined, secret: string): boolean {
  const auth = authorization ?? "";
  return secret !== "" && auth.startsWith("Bearer ") && constantTimeEqual(auth.slice(7).trim(), secret);
}

export async function verifyToken(token: string, secret = SECRET): Promise<Verified | null> {
  if (!secret) return null;
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return null;
  const expected = await sign(payloadB64, secret);
  if (!constantTimeEqual(expected, sigB64)) return null;
  try {
    const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded + "=".repeat((4 - padded.length % 4) % 4));
    const obj = JSON.parse(json);
    if (typeof obj?.exp !== "number" || obj.exp < Date.now()) return null;
    if (obj?.role !== "admin" && obj?.role !== "ro" && obj?.role !== "check") return null;
    return obj as Verified;
  } catch {
    return null;
  }
}

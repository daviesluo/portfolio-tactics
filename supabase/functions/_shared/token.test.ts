// Pins for the shared HMAC token verify. Mirrors the per-function
// token tests so the relocated helper can't silently regress.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sign, verifyToken, b64url, bearerIs, constantTimeEqual, secretMatches } from "./token.ts";

const SECRET = "test-secret-deadbeef-deadbeef-deadbeef";

async function makeToken(role: string, exp: number): Promise<string> {
  const payload = b64url(JSON.stringify({ role, exp }));
  const sig = await sign(payload, SECRET);
  return `${payload}.${sig}`;
}

Deno.test("verifyToken accepts a valid admin token", async () => {
  const v = await verifyToken(await makeToken("admin", Date.now() + 60_000), SECRET);
  assertEquals(v?.role, "admin");
});

Deno.test("verifyToken accepts a valid ro token", async () => {
  const v = await verifyToken(await makeToken("ro", Date.now() + 60_000), SECRET);
  assertEquals(v?.role, "ro");
});

Deno.test("verifyToken rejects an expired token", async () => {
  assertEquals(await verifyToken(await makeToken("admin", Date.now() - 1000), SECRET), null);
});

Deno.test("verifyToken rejects a tampered signature", async () => {
  const t = await makeToken("admin", Date.now() + 60_000);
  const bad = t.slice(0, -1) + (t.endsWith("A") ? "B" : "A");
  assertEquals(await verifyToken(bad, SECRET), null);
});

Deno.test("verifyToken rejects an unknown role", async () => {
  assertEquals(await verifyToken(await makeToken("superuser", Date.now() + 60_000), SECRET), null);
});

Deno.test("verifyToken rejects malformed and wrong-secret tokens", async () => {
  assertEquals(await verifyToken("", SECRET), null);
  assertEquals(await verifyToken("no-dot-here", SECRET), null);
  const t = await makeToken("admin", Date.now() + 60_000);
  assertEquals(await verifyToken(t, "the-wrong-secret"), null);
});

Deno.test("constantTimeEqual basic correctness", () => {
  assertEquals(constantTimeEqual("abc", "abc"), true);
  assertEquals(constantTimeEqual("abc", "abd"), false);
  assertEquals(constantTimeEqual("abc", "ab"), false);
  assertEquals(constantTimeEqual("", ""), true);
});

// The one copy of the two secret compares (the audit of 2026-11-21, A16): `monitor` and three desks' ingests each
// carried the first, and two recorders compared the scheduler's bearer with `!==`.
Deno.test("secretMatches: equal secrets only, whatever their lengths; a missing or empty one on either side refuses", async () => {
  const secret = "a".repeat(64);
  assertEquals(await secretMatches(secret, secret), true);
  assertEquals(await secretMatches("a".repeat(63) + "b", secret), false);
  assertEquals(await secretMatches("a".repeat(65), secret), false);
  assertEquals(await secretMatches("a", secret), false);
  for (const given of [null, undefined, ""]) assertEquals(await secretMatches(given, secret), false);
  assertEquals(await secretMatches("", ""), false);
  assertEquals(await secretMatches(secret, ""), false);
});

Deno.test("bearerIs: `Bearer <secret>` and nothing else; an empty secret refuses every header", () => {
  assertEquals(bearerIs("Bearer s3cret", "s3cret"), true);
  assertEquals(bearerIs("Bearer s3cret ", "s3cret"), true);
  for (const h of ["Bearer s3creT", "Bearer s3cre", "Bearer s3crett", "bearer s3cret", "s3cret", "Bearer", "", null, undefined]) assertEquals(bearerIs(h, "s3cret"), false);
  assertEquals(bearerIs("Bearer ", ""), false);
  assertEquals(bearerIs("Bearer x", ""), false);
});

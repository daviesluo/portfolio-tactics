// Pin the pure helpers in `trading212/index.ts`. The `Deno.serve(...)`
// entrypoint is guarded by `if (import.meta.main)` so importing the
// module here doesn't bind a port.
//
//   - `shapeT212Portfolio` — ticker allow-list + per-row finiteness
//     guard + cost-is-per-share-AC contract.
//   - `cacheIsFresh` — TTL predicate independent of system clock.
//   - `basicAuthHeader` — T212's two-key HTTP Basic encoding.

import { assert, assertEquals } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { shapeT212Portfolio, cacheIsFresh, basicAuthHeader } from "./index.ts";

Deno.test("shapeT212Portfolio — VUKEl_EQ / VMIDl_EQ map to Yahoo tickers; cost is per-share GBP", () => {
  // T212's averagePrice for VUKE.L / VMID.L is GBP per share (NOT
  // pence) — these are GBP-denominated UCITS ETFs and T212 reports
  // in the instrument's settle currency. The Edge Function passes
  // averagePrice through unchanged; lot.cost / h.cost is per-share
  // AC everywhere in the app (metrics.js multiplies h.shares * h.cost
  // for total cost; weightedAvgCost does shares * cost).
  const raw = [
    { ticker: "VUKEl_EQ", quantity: 12.5, averagePrice: 96.00 },
    { ticker: "VMIDl_EQ", quantity: 30,   averagePrice: 12.345 },
  ];
  const out = shapeT212Portfolio(raw);
  assertEquals(out["VUKE.L"].shares, 12.5);
  assertEquals(out["VUKE.L"].cost, 96.00);
  assertEquals(out["VMID.L"].shares, 30);
  assertEquals(out["VMID.L"].cost, 12.345);
});

Deno.test("shapeT212Portfolio — non-allowlisted tickers are dropped", () => {
  const raw = [
    { ticker: "KO_US_EQ", quantity: 10, averagePrice: 150 },
    { ticker: "VUKEl_EQ", quantity: 5,    averagePrice: 90.00 },
  ];
  const out = shapeT212Portfolio(raw);
  assert(!("KO" in out));
  assert(!("KO_US_EQ" in out));
  assertEquals(Object.keys(out), ["VUKE.L"]);
});

Deno.test("shapeT212Portfolio — non-positive quantity / averagePrice are dropped", () => {
  const raw = [
    { ticker: "VUKEl_EQ", quantity: 0,   averagePrice: 96 },
    { ticker: "VUKEl_EQ", quantity: -1,  averagePrice: 96 },
    { ticker: "VUKEl_EQ", quantity: 10,  averagePrice: 0 },
    { ticker: "VUKEl_EQ", quantity: 10,  averagePrice: -50 },
    { ticker: "VUKEl_EQ", quantity: NaN, averagePrice: 96 },
  ];
  const out = shapeT212Portfolio(raw);
  assertEquals(out, {});
});

Deno.test("shapeT212Portfolio — malformed input returns empty map (not throws)", () => {
  assertEquals(shapeT212Portfolio(null), {});
  assertEquals(shapeT212Portfolio(undefined), {});
  assertEquals(shapeT212Portfolio({}), {});
  assertEquals(shapeT212Portfolio("nope"), {});
  assertEquals(shapeT212Portfolio([null, undefined, "x", 42]), {});
  assertEquals(shapeT212Portfolio([{ ticker: 42 }, { quantity: 5 }]), {});
});

Deno.test("cacheIsFresh — within TTL is fresh", () => {
  const now = 1_700_000_000_000;
  const fiveSecAgo = new Date(now - 5_000).toISOString();
  assert(cacheIsFresh(fiveSecAgo, now, 120_000));
});

Deno.test("cacheIsFresh — beyond TTL is stale", () => {
  const now = 1_700_000_000_000;
  const twoMinAgo = new Date(now - 130_000).toISOString();
  assert(!cacheIsFresh(twoMinAgo, now, 120_000));
});

Deno.test("cacheIsFresh — null / malformed timestamps are stale", () => {
  const now = 1_700_000_000_000;
  assert(!cacheIsFresh(null, now, 120_000));
  assert(!cacheIsFresh("not-a-date", now, 120_000));
  assert(!cacheIsFresh("", now, 120_000));
});

Deno.test("basicAuthHeader — base64(keyId:secret) with `Basic ` prefix", () => {
  // T212's HTTP Basic uses the API key id as username and the API
  // secret as password, joined with a single colon and base64-encoded.
  assertEquals(basicAuthHeader("user", "pass"), "Basic dXNlcjpwYXNz");
  assertEquals(
    basicAuthHeader("abc123", "secret-with-dashes"),
    "Basic " + btoa("abc123:secret-with-dashes"),
  );
});

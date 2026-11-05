// Pins of what a read-only token is sent (./ro_view.ts). Every figure here is made up.
//
// The key sets are written out here, not read from the module's own lists: a field added to an allowlist (or a field
// the board starts carrying) fails these until it is consciously allowed in both places.
//
// Run locally: `npx --yes deno@1.46.3 test --allow-env supabase/functions/data/`

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { foldLedger, keptTickers, netRows, roAnswer, roBoard, roCutoff, roDividends, roOrders } from "./ro_view.ts";
import { loadAnswer } from "./index.ts";

// 12:00 UTC on 5 Nov 2026: 1 January is the earlier window start, so the cutoff is 18 Dec 2025.
const NOW = Date.UTC(2026, 10, 5, 12);

/** Every key found at one level of a list of objects, sorted. */
const keysOf = (rows: unknown[]) => [...new Set(rows.flatMap((r) => Object.keys(r as object)))].sort();

/** A board carrying every field the stored one does, and a few it never should send on. */
function board() {
  return {
    positions: {
      GK: { label: "GK", subtitle: "Cash", role: "GK", tickers: ["CASH"], note: "x" },
      CM: { label: "CM", subtitle: "", role: "MID", tickers: ["ACME", "NOVA"] },
      ST: { label: "ST", subtitle: "", role: "FWD", tickers: [] },
    },
    holdings: {
      CASH: { shares: 1, cost: 0, lastPrice: 50, dayPct: 0, isCash: true },
      // Synced: its ledger is folded.
      ACME: {
        shares: 6, cost: 9, currency: "USD", lastPrice: 30, prevClose: 29, dayPct: 3.4, extPrice: 31, extDayPct: 3.3,
        extPriceTrusted: true, t212Shares: 5, t212Cost: 9, memo: "never sent",
        lots: [
          { date: "2025-03-01", shares: 2, cost: 10, ts: 1 },
          { date: "2025-06-01", shares: 1, cost: 12, ts: 2 },
          { date: "2026-03-02", shares: 1, cost: 20, ts: 3 },
          { date: "2026-03-02", shares: 3, cost: 24, ts: 4 },
          { date: "2026-04-01", shares: 1, cost: 8, ts: 5, src: "other" },
        ],
        sells: [
          { date: "2025-09-01", shares: 1, price: 15, ts: 6 },
          { date: "2026-05-01", shares: 1, price: 26, ts: 7 },
        ],
      },
      // Not synced: its rows stay as they are, less `ts`.
      NOVA: { shares: 4, cost: 5, currency: "GBP", lastPrice: 6, prevClose: 6, dayPct: 0,
        lots: [{ date: "2025-01-02", shares: 4, cost: 5, ts: 8 }] },
      // Closed for good: not sent.
      GONE: { shares: 0, cost: 0, closed: true, currency: "USD", lastPrice: 7,
        lots: [{ date: "2025-02-01", shares: 3, cost: 4 }], sells: [{ date: "2025-04-01", shares: 3, price: 6 }] },
      // Closed, but Trading 212 can put it back on ST: sent, its round trip folded to nothing.
      ZETA: { shares: 0, cost: 0, closed: true, currency: "USD", lastPrice: 9, t212Shares: 0, t212Cost: 0, t212PositionKey: "ST",
        lots: [{ date: "2025-02-01", shares: 2, cost: 4 }], sells: [{ date: "2025-04-01", shares: 2, price: 5 }] },
    },
    snapshots: [{ date: "2026-01-01", prices: { ACME: 1 } }],
    depositFxRates: { GBP: 1.3 },
  };
}

Deno.test("roCutoff: two weeks before the earlier of 1 January (of the year two weeks ago) and 93 days back", () => {
  assertEquals(roCutoff(NOW), { cutoff: "2025-12-18", openDay: "2025-12-17" });
  // Early in a year 93 days back is the earlier start.
  assertEquals(roCutoff(Date.UTC(2026, 1, 10)), { cutoff: "2025-10-26", openDay: "2025-10-25" });
  // On New Year's morning in UTC a visitor west of it is still in the old year: its 1 January is the one counted.
  assertEquals(roCutoff(Date.UTC(2027, 0, 1, 3)), { cutoff: "2025-12-18", openDay: "2025-12-17" });
});

Deno.test("keptTickers: what a position names, the cash, and a holding Trading 212 can put back on its slot", () => {
  assertEquals([...keptTickers(board())].sort(), ["ACME", "CASH", "NOVA", "ZETA"]);
  assertEquals(keptTickers(null).size, 0);
});

Deno.test("roBoard: exactly these keys at every level; nothing else of the board", () => {
  const ro = roBoard(board(), NOW) as any;
  assertEquals(Object.keys(ro).sort(), ["holdings", "positions"]);
  assertEquals(keysOf(Object.values(ro.positions)), ["label", "role", "subtitle", "tickers"]);
  assertEquals(Object.keys(ro.holdings).sort(), ["ACME", "CASH", "NOVA", "ZETA"]);
  assertEquals(keysOf(Object.values(ro.holdings)), [
    "closed", "cost", "currency", "dayPct", "extDayPct", "extPrice", "extPriceTrusted", "isCash", "lastPrice", "lots",
    "prevClose", "sells", "shares", "t212Cost", "t212PositionKey", "t212Shares",
  ]);
  const lots = Object.values(ro.holdings).flatMap((h: any) => h.lots ?? []);
  const sells = Object.values(ro.holdings).flatMap((h: any) => h.sells ?? []);
  assertEquals(keysOf(lots), ["cost", "date", "shares", "src"]);
  assertEquals(keysOf(sells), ["date", "price", "shares"]);
});

Deno.test("roBoard: a synced ledger folded to one opening row and one row a day, net shares and net cash kept", () => {
  const ro = roBoard(board(), NOW) as any;
  // Before the cutoff: [•] @ [•] + [•] @ [•] − [•] @ [•] = [•] shares for [•] one lot at [•] the day before the cutoff. On
  // [•] March [•] @ [•] and [•] @ [•] are [•] @ [•]. The `src: 'other'` row keeps its own group and its own figures.
  assertEquals(ro.holdings.ACME.lots, [
    { date: "2025-12-17", shares: 2, cost: 8.5 },
    { date: "2026-03-02", shares: 4, cost: 23 },
    { date: "2026-04-01", shares: 1, cost: 8, src: "other" },
  ]);
  assertEquals(ro.holdings.ACME.sells, [{ date: "2026-05-01", shares: 1, price: 26 }]);
  // A holding not synced keeps its dates and costs; only `ts` goes.
  assertEquals(ro.holdings.NOVA.lots, [{ date: "2025-01-02", shares: 4, cost: 5 }]);
  // A round trip before the cutoff: no shares, net cash 8 − 10 = −2, as a buy of one at 1 and a sale of one at 3, so
  // its ledger still exists (the settle check and the rebuild ask whether it does).
  assertEquals(ro.holdings.ZETA.lots, [{ date: "2025-12-17", shares: 1, cost: 1 }]);
  assertEquals(ro.holdings.ZETA.sells, [{ date: "2025-12-17", shares: 1, price: 3 }]);
});

Deno.test("netRows: the net shares and the net cash, every price positive", () => {
  const net = (r: ReturnType<typeof netRows>) => ({
    n: r.buys.reduce((a, [s]) => a + s, 0) - r.sells.reduce((a, [s]) => a + s, 0),
    c: r.buys.reduce((a, [s, p]) => a + s * p, 0) - r.sells.reduce((a, [s, p]) => a + s * p, 0),
    ok: [...r.buys, ...r.sells].every(([s, p]) => s > 0 && p > 0),
  });
  assertEquals(netRows(2, 17), { buys: [[2, 8.5]], sells: [] });
  assertEquals(netRows(-2, -6), { buys: [], sells: [[2, 3]] });
  // Folded from rows that held a buy, the answer holds one too (a ledger with no lot reads differently).
  assertEquals(netRows(-2, -6, true).buys.length, 1);
  for (const [n, c, keep] of [[0, 5], [0, 0], [0, -5], [2, -4], [2, 0], [-2, 3], [1e-12, 4], [-2, -6, 1]]) {
    const r = net(netRows(n, c, !!keep));
    assertEquals(r.ok, true, `${n}, ${c}`);
    assertEquals(Math.abs(r.n - (Math.abs(n) < 1e-9 ? 0 : n)) < 1e-12 && Math.abs(r.c - c) < 1e-9, true, `${n}, ${c}: ${JSON.stringify(r)}`);
  }
});

Deno.test("foldLedger: a row the page would drop passes through as it is", () => {
  const f = foldLedger([{ date: "2027-01-01", shares: 1, cost: 2 }, { date: "bad", shares: 1, cost: 2 }, { date: "2026-01-05", shares: -1, cost: 2 }], [], NOW);
  assertEquals(f.lots.length, 3);
});

Deno.test("roBoard: a fold's opening sale is sent even for a holding that stored no sales", () => {
  // Two gifts at no cost before the cutoff: [•] shares for nothing, which no single buy at a positive price can say.
  const b = { positions: { CM: { tickers: ["GIFT"] } }, holdings: { GIFT: { shares: 3, cost: 0, t212Shares: 3,
    lots: [{ date: "2025-01-01", shares: 1, cost: 0 }, { date: "2025-02-01", shares: 2, cost: 0 }] } } };
  const h = (roBoard(b, NOW) as any).holdings.GIFT;
  assertEquals(h.lots, [{ date: "2025-12-17", shares: 4, cost: 1 }]);
  assertEquals(h.sells, [{ date: "2025-12-17", shares: 1, price: 4 }]);
});

Deno.test("roOrders: the kept tickers' fills, folded, at midnight, in these keys", () => {
  const rows = [
    { id: "a1", account: "invest", ticker: "ACME", side: "buy", shares: 2, price: 10, executed_at: "2025-03-01T14:30:00+00:00", currency: "USD" },
    { id: "a2", account: "isa", ticker: "ACME", side: "buy", shares: 1, price: 12, executed_at: "2025-06-01T15:00:00+00:00", currency: "USD" },
    { id: "a3", account: "invest", ticker: "ACME", side: "sell", shares: 1, price: 15, executed_at: "2025-09-01T16:00:00+00:00", currency: "USD" },
    { id: "a4", account: "invest", ticker: "ACME", side: "buy", shares: 1, price: 20, executed_at: "2026-03-02T14:31:00+00:00", currency: "USD" },
    { id: "a5", account: "isa", ticker: "ACME", side: "buy", shares: 3, price: 24, executed_at: "2026-03-02T18:02:00+00:00", currency: "USD" },
    { id: "g1", account: "invest", ticker: "GONE", side: "buy", shares: 3, price: 4, executed_at: "2026-02-01T14:30:00+00:00", currency: "USD" },
    { id: "a6", account: "invest", ticker: "ACME", side: "buy", shares: 0, price: 9, executed_at: "2026-06-01T14:30:00+00:00", currency: "USD" },
  ];
  const out = roOrders(rows, keptTickers(board()), NOW);
  assertEquals(keysOf(out), ["currency", "executed_at", "price", "shares", "side", "ticker"]);
  assertEquals(out, [
    { ticker: "ACME", side: "buy", shares: 2, price: 8.5, executed_at: "2025-12-17T00:00:00Z", currency: "USD" },
    { ticker: "ACME", side: "buy", shares: 4, price: 23, executed_at: "2026-03-02T00:00:00Z", currency: "USD" },
    // A fill the ledger maths skips passes through, trimmed: the settle check still counts what it can.
    { ticker: "ACME", side: "buy", shares: 0, price: 9, executed_at: "2026-06-01T14:30:00+00:00", currency: "USD" },
  ]);
});

Deno.test("roDividends: the kept tickers', one row a ticker and currency, summed in the order read", () => {
  const rows = [
    { id: "d1", account: "invest", ticker: "ACME", paid_on: "2026-02-01T15:00:00+00:00", quantity: 4, amount: 0.8, currency: "USD", amount_holding: 0.1, holding_currency: "USD", fx_rate: 1 },
    { id: "d2", account: "isa", ticker: "ACME", paid_on: "2026-02-01T15:04:00+00:00", quantity: 2, amount: 0.4, currency: "USD", amount_holding: 0.2, holding_currency: "USD", fx_rate: 1 },
    { id: "d3", account: "isa", ticker: "ACME", paid_on: "2026-08-01T15:04:00+00:00", quantity: 2, amount: 0.4, currency: "USD", amount_holding: null, holding_currency: "USD", fx_rate: null },
    { id: "d4", account: "isa", ticker: "GONE", paid_on: "2026-03-01T15:04:00+00:00", quantity: 2, amount: 3, currency: "USD", amount_holding: 3, holding_currency: "USD", fx_rate: 1 },
  ];
  const out = roDividends(rows, keptTickers(board()), NOW);
  assertEquals(keysOf(out), ["amount_holding", "holding_currency", "paid_on", "ticker"]);
  // 0 + 0.1 + 0.2, as the page adds them: 0.30000000000000004, the same double.
  assertEquals(out, [
    { ticker: "ACME", paid_on: "2026-02-01T15:04:00+00:00", amount_holding: 0 + 0.1 + 0.2, holding_currency: "USD" },
    { ticker: "ACME", paid_on: "2026-08-01T15:04:00+00:00", amount_holding: null, holding_currency: "USD" },
  ]);
});

Deno.test("roAnswer: the kept tickers' slices and prices, and the answer's flags", () => {
  const body = {
    holdings: { ACME: { shares: 5, cost: 9, previousShares: 4, previousCost: 8, extra: 1 }, OTHR: { shares: 1, cost: 2 } },
    prices: { ACME: 30, OTHR: 3 }, complete: true, updatedAt: "2026-11-05T12:00:00Z", source: "cache", debug: "x",
  };
  assertEquals(roAnswer(body, keptTickers(board())), {
    holdings: { ACME: { shares: 5, cost: 9, previousShares: 4, previousCost: 8 } },
    prices: { ACME: 30 }, complete: true, updatedAt: "2026-11-05T12:00:00Z", source: "cache",
  });
});

Deno.test("loadAnswer: an admin gets the stored board as it is; a read-only token gets roBoard of it", () => {
  const stored = board();
  const admin = loadAnswer("admin", [{ data: stored, version: 7 }], NOW);
  assertEquals(admin.version, 7);
  assertEquals(admin.data, stored);
  assertEquals(Object.keys(admin.data as object).sort(), ["depositFxRates", "holdings", "positions", "snapshots"]);
  const ro = loadAnswer("ro", [{ data: board(), version: 7 }], NOW);
  assertEquals(ro, { data: roBoard(board(), NOW), version: 7 });
  assertEquals(Object.keys(ro.data as object).sort(), ["holdings", "positions"]);
  assertEquals(loadAnswer("ro", [], NOW), { data: null, version: 0 });
});

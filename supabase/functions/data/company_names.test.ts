// Pins the company names the `load` answer sends (./company_names.ts). Run: npx --yes deno@1.46.3 test --allow-env supabase/functions/data/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { COMPANY_NAMES, namesFor } from "./company_names.ts";
import { loadAnswer } from "./index.ts";

// The site is English-only. A Chinese fund's own name (005827 shipped as its Chinese title) showed up in the holding list
// and the chart modal.
Deno.test("company names: English only", () => {
  const cjk = /[　-〿一-鿿＀-￯]/;
  assertEquals(Object.entries(COMPANY_NAMES).filter(([, n]) => cjk.test(n)), []);
  assertEquals(COMPANY_NAMES["005827"], "E Fund Blue Chip Select Mixed");
});

Deno.test("namesFor: the names of the tickers asked for that the map knows, no others", () => {
  assertEquals(namesFor(["NVDA", "ACME", "CASH"]), { NVDA: "NVIDIA Corporation" });
});

// Davies, 2026-11-09: "访客可以看不到历史记录". The bundle carried the whole map, every holding the book ever had.
Deno.test("load: names for the holdings sent; a viewer's never a closed holding's", () => {
  const board = {
    positions: { CM: { label: "CM", subtitle: "", role: "MID", tickers: ["NVDA"] } },
    holdings: {
      NVDA: { shares: 1, cost: 1, currency: "USD", lots: [{ date: "2026-03-02", shares: 1, cost: 1 }] },
      KO: { shares: 0, cost: 0, closed: true, currency: "USD", lots: [{ date: "2026-03-02", shares: 1, cost: 1 }],
        sells: [{ date: "2026-04-02", shares: 1, price: 2 }] },
    },
  };
  const rows = [{ data: board, version: 3 }];
  const now = Date.UTC(2026, 10, 5, 12);
  assertEquals(loadAnswer("admin", rows, now).names, { NVDA: "NVIDIA Corporation", KO: "The Coca-Cola Company" });
  assertEquals(loadAnswer("ro", rows, now).names, { NVDA: "NVIDIA Corporation" });
  // An alias carries no name.
  const sold = [{ ticker: "KO", alias: "ZABCDEFG", k: 2 }];
  assertEquals(loadAnswer("ro", rows, now, sold).names, { NVDA: "NVIDIA Corporation" });
});

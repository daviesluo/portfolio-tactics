// Pins the one Trading 212 → Yahoo ticker map (`t212_tickers.ts`): both tables whole, and the two rules on generic and
// made-up codes, their edges included. Each function that reads the map pins, in its own tests, that it reads this one
// and keeps no copy.
import { assert, assertEquals, assertStrictEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { T212_ALIASES, T212_DCA_ETFS, t212TickerToYahoo } from "./t212_tickers.ts";

Deno.test("t212_tickers: both tables, whole, and each entry is what the function answers", () => {
  assertEquals(T212_DCA_ETFS, { "IWDAl_EQ": "IWDA.L", "VWRLl_EQ": "VWRL.L" });
  assertEquals(T212_ALIASES, {
    "FB_US_EQ": "META",
    "YNDX_US_EQ": "NBIS",
    "IBM_US_EQ": "CVX",
    "VACQ_US_EQ": "RKLB",
    "LOKB_US_EQ": "NVTS",
    "MBGd_EQ": "MBG.SG",
    "AIRp_EQ": "AIR.PA",
    "SGLN_EQ": "SGLN.L",
  });
  for (const [code, ticker] of Object.entries({ ...T212_DCA_ETFS, ...T212_ALIASES })) {
    assertEquals(t212TickerToYahoo(code), ticker, code);
  }
});

// Davies holds Alphabet's class A line (every fill and dividend is `GOOGL_US_EQ`); until 2026-10-21 an alias put it on
// the board as GOOG, class C. It now maps by the US rule to its own ticker, and nothing maps to GOOG.
Deno.test("t212_tickers: GOOGL_US_EQ is GOOGL, class A, and no code maps to GOOG", () => {
  assertEquals(t212TickerToYahoo("GOOGL_US_EQ"), "GOOGL");
  assertEquals(t212TickerToYahoo("GOOG_US_EQ"), "GOOG");
  assertEquals(Object.values({ ...T212_DCA_ETFS, ...T212_ALIASES }).includes("GOOG"), false);
  assertEquals("GOOGL_US_EQ" in T212_ALIASES, false);
});

Deno.test("t212_tickers: the tables cannot be changed by a caller", () => {
  assert(Object.isFrozen(T212_DCA_ETFS));
  assert(Object.isFrozen(T212_ALIASES));
  assertThrows(() => {
    (T212_ALIASES as Record<string, string>)["ZZZ_US_EQ"] = "ZZZ";
  }, TypeError);
});

Deno.test("t212_tickers: the US rule, the symbol upper-cased and a one-letter share class hyphenated", () => {
  assertEquals(t212TickerToYahoo("KO_US_EQ"), "KO");
  assertEquals(t212TickerToYahoo("ABC_US_EQ"), "ABC");
  assertEquals(t212TickerToYahoo("Z_US_EQ"), "Z");
  assertEquals(t212TickerToYahoo("ko_US_EQ"), "KO");
  // T212 joins a share class with an underscore, Yahoo with a hyphen.
  assertEquals(t212TickerToYahoo("BF_B_US_EQ"), "BF-B");
  assertEquals(t212TickerToYahoo("bf_b_US_EQ"), "BF-B");
  // Only a one-letter class, and no digit in a US symbol.
  assertEquals(t212TickerToYahoo("ABC_DE_US_EQ"), null);
  assertEquals(t212TickerToYahoo("A_B_C_US_EQ"), null);
  assertEquals(t212TickerToYahoo("A1_US_EQ"), null);
  // The suffix is exact, case and all, with nothing around the code.
  assertEquals(t212TickerToYahoo("KO_us_eq"), null);
  assertEquals(t212TickerToYahoo("KO_US"), null);
  assertEquals(t212TickerToYahoo("_US_EQ"), null);
  assertEquals(t212TickerToYahoo("KO_US_EQ "), null);
  assertEquals(t212TickerToYahoo(" KO_US_EQ"), null);
});

Deno.test("t212_tickers: the LSE rule, a lowercase l before _EQ, digits allowed in the symbol", () => {
  assertEquals(t212TickerToYahoo("ABCl_EQ"), "ABC.L");
  assertEquals(t212TickerToYahoo("IS15l_EQ"), "IS15.L");
  assertEquals(t212TickerToYahoo("ABCLl_EQ"), "ABCL.L"); // a symbol ending in L keeps it
  assertEquals(t212TickerToYahoo("iwdal_EQ"), "IWDA.L");
  // The exchange letter is a lowercase l: an upper-case one is part of no rule.
  assertEquals(t212TickerToYahoo("VUAAL_EQ"), null);
  assertEquals(t212TickerToYahoo("VUAAl_eq"), null);
  assertEquals(t212TickerToYahoo("l_EQ"), null);
});

Deno.test("t212_tickers: no rule reads another exchange's letter; only an alias does", () => {
  assertEquals(t212TickerToYahoo("SOMEd_DE_EQ"), null);
  assertEquals(t212TickerToYahoo("ABCd_EQ"), null);
  assertEquals(t212TickerToYahoo("ABCp_EQ"), null);
  assertEquals(t212TickerToYahoo("ABCD_NL_EQ"), null);
  assertEquals(t212TickerToYahoo("ABCD_EQ"), null); // no exchange letter, and no alias
  assertEquals(t212TickerToYahoo("MBGd_EQ"), "MBG.SG");
  assertEquals(t212TickerToYahoo("AIRp_EQ"), "AIR.PA");
  assertEquals(t212TickerToYahoo("SGLN_EQ"), "SGLN.L");
});

Deno.test("t212_tickers: an alias answers only for T212's exact code", () => {
  // T212 sends the symbol upper-case. A lower-case code is not the alias's, and the rules read it as they read any.
  assertEquals(t212TickerToYahoo("fb_US_EQ"), "FB");
  assertEquals(t212TickerToYahoo("2dgd_EQ"), null);
  assertEquals(t212TickerToYahoo("sgln_EQ"), null);
});

Deno.test("t212_tickers: anything unknown or malformed is null, never something inherited from Object", () => {
  // The copies looked a code up as a plain property, so "constructor" returned the Object function as a ticker.
  for (const code of ["", "nonsense", "ZZZ", "WEIRD_SHAPE", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
    assertStrictEquals(t212TickerToYahoo(code), null, code);
  }
  for (const notAString of [null, undefined, 42, {}, [], true]) {
    assertStrictEquals(t212TickerToYahoo(notAString as unknown as string), null);
  }
});

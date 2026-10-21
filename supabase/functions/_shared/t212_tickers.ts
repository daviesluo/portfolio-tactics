// Trading 212's instrument codes, mapped to the Yahoo tickers the board uses. The `trading212` function and the two
// price recorders (`snapshot-record`, `overnight-record`) all read this one map.
//
// It was three copies until 2026-10-02 (improvement plan item 9), and the recorders' two had drifted from the
// function's: they stopped at six aliases and letters-only rules, so they never learned `MBGd_EQ`, `AIRp_EQ`,
// `SGLN_EQ`, a share class (`BF_B_US_EQ`) or a digit in an LSE symbol (`IS15l_EQ`). An unmapped code is not an error
// anywhere: its price simply drops out of what is recorded, which is why copies that drift apart are a defect.
//
// A code is the symbol, then the exchange: `KO_US_EQ` (US), `IWDAl_EQ` (LSE, a lowercase `l`). A code nothing here
// reads maps to null, and every caller leaves that position out.

/**
 * The two ETFs bought at Trading 212 every day, USD-denominated UCITS ETFs on the LSE (the client's `fx.js` overrides
 * the currency their suffix would suggest). `trading212` reports each in its holdings even when sold out, as an
 * explicit zero, so a sold-out position never reads as "no data". The LSE rule below would map both the same way; they
 * are looked up first so that a code added here maps whether or not a rule can read it.
 */
export const T212_DCA_ETFS: Readonly<Record<string, string>> = Object.freeze({
  "IWDAl_EQ": "IWDA.L",
  "VWRLl_EQ": "VWRL.L",
});

/**
 * Codes the rules cannot turn into the board's ticker. Trading 212 assigns a code when an instrument is first listed
 * and keeps it through a rename, a ticker swap or a SPAC merger, so the `_US_EQ` rule would give the old symbol, which
 * matches nothing on the board; and some listings carry an exchange letter no rule reads.
 */
export const T212_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "FB_US_EQ": "META", // Facebook, renamed Meta in 2022
  "YNDX_US_EQ": "NBIS", // Yandex N.V., relisted as Nebius Group in 2024
  "IBM_US_EQ": "CVX", // IBM, renamed Chevron in [•]
  "VACQ_US_EQ": "RKLB", // Vector Acquisition, the SPAC that became Rocket Lab in 2021
  "LOKB_US_EQ": "NVTS", // Live Oak Acquisition II, the SPAC that became Navitas in 2021
  "MBGd_EQ": "MBG.SG", // Mercedes-Benz on a German venue: the `d` letter has no rule
  "AIRp_EQ": "AIR.PA", // Airbus on Euronext Paris: nor has `p`
  "SGLN_EQ": "SGLN.L", // an LSE […] ETF whose code carries no exchange letter at all
});

/**
 * The board's Yahoo ticker for a Trading 212 instrument code, or null when nothing here reads it:
 *
 *   KO_US_EQ → KO US: the symbol, upper-cased
 *   BF_B_US_EQ → BF-B a share class, which T212 joins with an underscore and Yahoo with a hyphen
 *   IWDAl_EQ → IWDA.L LSE: the symbol, digits included (IS15l_EQ → IS15.L)
 *   FB_US_EQ    → META    a code in the tables above, which come first
 *
 * The tables answer only for their own keys, so a code such as "constructor" finds nothing inherited.
 */
export function t212TickerToYahoo(t212Ticker: string): string | null {
  if (typeof t212Ticker !== "string" || !t212Ticker) return null;
  if (Object.hasOwn(T212_DCA_ETFS, t212Ticker)) return T212_DCA_ETFS[t212Ticker];
  if (Object.hasOwn(T212_ALIASES, t212Ticker)) return T212_ALIASES[t212Ticker];
  const us = t212Ticker.match(/^([A-Za-z]+(?:_[A-Za-z])?)_US_EQ$/);
  if (us) return us[1].toUpperCase().replace("_", "-");
  const lse = t212Ticker.match(/^([A-Za-z0-9]+)l_EQ$/);
  if (lse) return lse[1].toUpperCase() + ".L";
  return null;
}

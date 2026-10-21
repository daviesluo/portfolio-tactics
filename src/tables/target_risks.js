// The "Target price" page's Key risks column: a few words per holding, kept by hand in this file (Davies, 2026-10-21,
// who gave the first five as the style, then asked for every holding). Keyed by the ticker the page shows (`displayTicker`: SAND, not MBG.SG).
//
// Each note is a string, or a function of the row for a figure that must stay true as the price moves (RKLB's lowest
// target against its price is computed, never written down). A note tied to a date carries `until` (a New York date,
// YYYY-MM-DD): it is shown through that day and drops out after it, so an investor day or an earnings date never
// lingers once it has passed. To change a note, edit this file; the page has no editor.

/**
 * @typedef {{ low: number | null, price: number | null, lowVsPrice: number | null }} RiskRow
 * @typedef {{ text: string | ((row: RiskRow) => string | null), until?: string }} RiskNote
 */

/** @param {number} n */
const usd = (n) => `$${n >= 100 ? Math.round(n).toLocaleString('en-US') : Number(n.toFixed(2)).toString()}`;

/**
 * RKLB's computed note: its lowest target against the price, from the row, so it stays true as the price moves. The
 * hand-kept file names it by the placeholder "@lowest-target".
 * @param {RiskRow} r
 */
export function lowestTargetNote(r) {
  if (r.low == null || r.lowVsPrice == null) return null;
  const pct = Math.round(Math.abs(r.lowVsPrice));
  return r.lowVsPrice >= 0 ? `lowest target ${usd(r.low)} still ${pct}% above price` : `lowest target ${usd(r.low)} ${pct}% below price`;
}

/**
 * Every holding on the board on [•]-[•]-[•] ([•]), researched that day: [•]–[•] items each, terse, factual and dated, in the
 * style of Davies's first five (which are kept, brought up to date). The source of each figure is in the comment above
 * it. An "est." date is a calendar's estimate, not the company's; it drops out after the latest estimate.
 * @type {Record<string, RiskNote[]>}
 */
export const TARGET_RISKS = {
  // https://www.aboutamazon.com/md/news/company-news/amazon-earnings-q3-2026-report (Q3 call 10/29)
  // https://www.mlex.com/mlex/articles/2536525/amazon-s-bid-to-delay-us-ftc-monopolization-trial-rejected-by-judge (10/9)
  AMZN: [{ text: 'earnings 10/29', until: '2026-10-29' }, { text: 'FTC monopoly trial 3/29/27; delay refused 10/9' }],
  // https://www.sec.gov/Archives/edgar/data/[•]/[•]/apldq127earningsrelease.htm (FQ1: net loss $[•], [•]/[•])
  // https://nasdaq.com/articles/applied-digital-just-borrowed-another-[•]-billion-its-biggest-customer-[•]-billion-debt ($[•] [•]% notes due [•])
  // https://finance.yahoo.com/markets/stocks/articles/applied-digital-under-debt-overhang-[•].html (~[•]% of pipeline CoreWeave)
  APLD: [{ text: 'CoreWeave ~70% of contracted pipeline' }, { text: '$2.15B 6.75% secured notes due 2031' }, { text: 'FQ1 net loss $184.1M (10/7)' }],
  // https://www.bloomenergy.com/news/bloom-energy-to-announce-third-quarter-2026-financial-results-on-october-22-2026/
  // https://www.businesswire.com/news/home/20251030033915/en/Bloom-Energy-Corporation-Announces-Proposed-Convertible-Senior-Notes-Offering (0% due 2030)
  BE: [{ text: 'earnings 10/22', until: '2026-10-22' }, { text: 'Converts due 2029 and 2030 (the 2030s 0%, 11/2025)' }],
  // https://www.prnewswire.com/es/comunicados-de-prensa/bitmine-immersion-technologies-bmnr-anuncia-que-sus-tenencias-de-eth-alcanzan-los-[•]-[•]-millones-de-tokens-[•].html ([•] ETH, [•]/[•])
  // https://www.stocktitan.net/sec-filings/BMNR/424b5-bit-mine-immersion-technologies-inc-prospectus-supplement-debt--3f3e53883683.html (ATM up to $[•])
  // https://www.vtmarkets.com/tr-mena/discover/bmnr-stock-what-is-bitmine-immersion-technologies-is-it-worth-watching/ ([•]% perpetual preferred, [•]/[•])
  BMNR: [{ text: 'A leveraged ETH proxy: 6.04M ETH (10/18), ~4.9% of supply' }, { text: 'funded by ATM share sales and a 9.50% perpetual preferred (6/2026)' }],
  // https://www.crowdfundinsider.com/2026/09/310572-spot-bitcoin-etfs-see-450m-outflows-after-senate-stalls-clarity-act/
  'BTC-USD': [{ text: 'CLARITY Act failed cloture 49–50 (9/2026): no US market-structure law this year' }, { text: 'spot ETF outflows $450M that day' }, { text: 'trades with rates and risk appetite' }],
  // https://www.sec.gov/Archives/edgar/data/0001652044/000165204426000071/goog-20260630.htm (search remedies under appeal)
  // https://www.relevantaudience.com/google-ads-en/brinkema-rejects-adx-divestiture-behavioural-remedies/ (9/2: no AdX sale, conduct remedies)
  // https://www.wallstreethorizon.com/alphabet-earnings-calendar (10/28 inferred)
  GOOGL: [{ text: 'Ad-tech remedies ordered 9/2 (no AdX sale)' }, { text: 'search judgment under appeal' }, { text: 'earnings ~10/28 (est.)', until: '2026-10-28' }],
  // https://www.globenewswire.com/news-release/2026/10/01/3373375/0/en/index.html (Q3 results 10/27)
  // https://www.webull.com/news/14052150590866432 (CFTC comment request on event contracts)
  HOOD: [{ text: 'earnings 10/27', until: '2026-10-27' }, { text: 'Prediction markets: CFTC weighing event-contract rules' }],
  // https://investor.atmeta.com/investor-news/press-release-details/[•]/Meta-to-Announce-Third-Quarter-[•]-Results/default.aspx ([•]/[•] after close)
  // https://www.tikr.com/blog/meta-now-owes-[•]-billion-more-than-it-holds-heres-why-that-matters ([•] capex guide up to $[•])
  // https://www.ifre.com/bonds/[•]/meta-hits-market-with-six-part-jumbo-amid-ai-push (Hyperion: $[•] JV with Blue Owl, residual value guarantee)
  META: [{ text: 'earnings 10/21', until: '2026-10-21' }, { text: '2026 capex guide up to $145B' }, { text: 'Hyperion $27B off-balance-sheet JV, Meta guarantees residual value' }],
  // https://finviz.com/news/400058/microsoft-announces-quarterly-earnings-release-date (FQ1 results 10/28)
  // https://www.nasdaq.com/articles/microsofts-biggest-ai-customer-also-its-biggest-risk (OpenAI ~45% of RPO)
  MSFT: [{ text: 'earnings 10/28', until: '2026-10-28' }, { text: 'OpenAI ~45% of commercial backlog (analyst est.)' }, { text: 'capacity-constrained' }],
  // https://www.strategy.com/press/strategy-announces-earnings-release-date-and-live-video-webinar-for-third-quarter-2026-financial-results_10-08-2026 (10/29)
  // https://www.sec.gov/Archives/edgar/data/0001050446/000119312526363557/d431748dfwp.htm (mNAV 1.01x on 8/21; common below all debt and preferred)
  MSTR: [{ text: 'earnings 10/29', until: '2026-10-29' }, { text: 'mNAV ~1.0x (8/21)' }, { text: 'common ranks below converts and four preferred series' }],
  // https://www.sec.gov/Archives/edgar/data/[•]/[•]/a2026q4ex991-pressrelease.htm (FQ4 revenue $[•] vs $[•] a year earlier)
  // https://www.wallstreethorizon.com/micron-earnings-calendar ([•]/[•] inferred)
  MU: [{ text: 'Memory peak-cycle risk: FQ4 revenue $54.2B vs $11.3B a year earlier' }, { text: 'earnings ~12/16 (est.)', until: '2026-12-16' }],
  // https://nebius.com/newsroom/nebius-group-announces-closing-of-private-offering-of-convertible-senior-notes-with-aggregate-gross-proceeds-of-approximately-5-75-billion (8/24)
  // https://nebius.com/newsroom/nebius-group-announces-closing-of-private-offering-of-convertible-senior-notes-with-aggregate-gross-proceeds-of-approximately-4-3-billion (3/20)
  // https://beta.earningswhispers.com/go/x/NBIS (Q3 ~11/11, unconfirmed)
  NBIS: [{ text: 'Average target inflated by stale targets' }, { text: 'converts ~$4.3B (3/2026) + ~$5.75B (8/2026)' }, { text: 'earnings ~11/11 (est.)', until: '2026-11-11' }],
  // https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm (H200 China licence; 25% to the US government; guidance assumes no China DC revenue)
  // https://www.wallstreethorizon.com/nvidia-earnings-calendar (11/18 inferred)
  NVDA: [{ text: 'China: H200 sales only under licence, 25% to the US government' }, { text: 'earnings ~11/18 (est.)', until: '2026-11-18' }],
  // https://www.itiger.com/hans/news/2675626273 (Q3 results 11/3, announced 10/13; Q3 revenue guide $13–14M)
  NVTS: [{ text: 'earnings 11/3', until: '2026-11-03' }, { text: 'Q3 revenue guide $13–14M' }, { text: 'restructuring, history of capital raises' }],
  // https://www.sec.gov/Archives/edgar/data/[•]/[•]/a2026q2ex991pressrelease.htm (Q2: US government $[•] of $[•] = [•]%)
  // https://www.benzinga.com/quote/PLTR/earnings (Q3 ~[•]/[•] unconfirmed)
  PLTR: [{ text: 'US government 42% of Q2 revenue' }, { text: 'earnings ~11/2 (est.)', until: '2026-11-02' }],
  // https://www.sec.gov/Archives/edgar/data/[•]/[•]/rklb-08102026ex991.htm (cash $[•], [•]/[•])
  // https://pro.thestreet.com/trade-ideas/after-rocket-lab-fires-off-solid-earnings-im-pulling-the-trigger (long-term debt ~$[•])
  // https://beta.earningswhispers.com/go/x/RKLB ([•]/[•]) and https://www.earningswhispers.com/stocks/RKLB ([•]/[•]): unconfirmed
  RKLB: [
    { text: 'Net cash' },
    // Davies's words: "lowest target $[•] still [•]% above price", worked out from the row instead of written down.
    { text: lowestTargetNote },
    { text: 'earnings ~11/9–11/12 (est.)', until: '2026-11-12' },
  ],
  // https://fool.com/investing/2026/09/15/spacexs-next-share-unlock-is-coming-history-says-t (328.4M on 10/24; ~1.3B after the Q3 report; ~800M on 12/8)
  // https://teslanorth.com/2026/10/16/spacex-q3-2026-results-webcast/ (Q3 results 10/20)
  // The ~1.3B note runs to 2026-11-22 for now: Davies is asked for its end (coordinator, 2026-10-21).
  SPCX: [
    { text: 'Lock-up: up to 328.4M shares 10/24', until: '2026-10-24' },
    { text: '~1.3B more unlock after the Q3 report (10/20)', until: '2026-11-22' },
    { text: '~800M more 12/8', until: '2026-12-08' },
  ],
  // https://www.sec.gov/Archives/edgar/data/0001046179/000104617926000726/a3q26e_withguidancexfinal.htm (Q3 reported 10/15; Q4 guide $52.3–54.3B)
  TSM: [{ text: 'Taiwan concentration and cross-strait risk' }, { text: 'US chip tariffs unsettled' }, { text: 'Q4 guide $52.3–54.3B (10/15)' }],
};

/**
 * Today's date in New York, YYYY-MM-DD.
 * @param {number} nowMs
 */
export function nyDate(nowMs) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(nowMs);
}

/**
 * The notes for one holding as shown on `nowMs`, joined with "; ", or "" when it has none.
 * @param {string} display @param {RiskRow} row @param {number} nowMs @param {Record<string, RiskNote[]>} [map]
 */
export function risksFor(display, row, nowMs, map = TARGET_RISKS) {
  const today = nyDate(nowMs);
  const parts = [];
  for (const n of map[display] || []) {
    if (n.until && today > n.until) continue;
    const t = typeof n.text === 'function' ? n.text(row) : n.text;
    if (t) parts.push(t);
  }
  return parts.join('; ');
}

/**
 * The Key risks the `targets` GET serves from the `hand-targets` branch (`{TICKER: [{text, until?}]}`, checked by the
 * function, hand.ts), as notes for `risksFor`: the "@lowest-target" placeholder becomes RKLB's computed note. Null for
 * anything not that shape, and the bundled TARGET_RISKS stand.
 * @param {unknown} served
 * @returns {Record<string, RiskNote[]> | null}
 */
export function risksFromServed(served) {
  if (!served || typeof served !== 'object' || Array.isArray(served)) return null;
  /** @type {Record<string, RiskNote[]>} */
  const out = {};
  for (const [ticker, notes] of Object.entries(served)) {
    if (!Array.isArray(notes)) return null;
    out[ticker] = [];
    for (const n of notes) {
      if (!n || typeof n.text !== 'string') return null;
      /** @type {RiskNote} */
      const note = { text: n.text === '@lowest-target' ? lowestTargetNote : n.text };
      if (typeof n.until === 'string') note.until = n.until;
      out[ticker].push(note);
    }
  }
  return Object.keys(out).length ? out : null;
}


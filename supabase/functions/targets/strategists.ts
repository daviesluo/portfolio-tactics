// Bitcoin's analyst targets, kept by hand: no API serves bank or research-house targets for a crypto asset (Yahoo's
// quoteSummary answers "No fundamentals data found" for BTC-USD; checked 2026-10-21). Each row is one firm's latest
// published target that a session read in its source, with the day it was published, its horizon and the source.
// Nothing here is from memory: every figure was read on its page on 2026-10-21.
//
// AS OF 2026-10-21. A session refreshes this table (a new target replaces its firm's row; a firm whose newest target is
// over a year old leaves): the page shows the rows' dates, and its fresh window counts only the last 30 days.
//
// Left out on purpose: JPMorgan (its widely quoted figures are a long-run gold-parity value, not a dated target), and
// Fidelity and Fundstrat (ranges, not one target).

export const STRATEGIST_AS_OF = "2026-10-21";

export const STRATEGIST_TARGETS: Record<string, Array<{ firm: string; target: number; date: string; horizon: string; url: string }>> = {
  "BTC-USD": [
    // "end year forecasts of $[•]", "a further downgrade from $[•]" (The Block, [•]-[•]-[•]).
    { firm: "Standard Chartered", target: 100_000, date: "2026-02-12", horizon: "end-2026", url: "https://www.theblock.co/post/389609/standard-chartered-bitcoin-50000-ether-1400-rebound" },
    // "sees bitcoin at $[•] a year out", "down from $[•]" (Bitcoin Magazine, [•]-[•]-[•]).
    { firm: "Citi", target: 82_000, date: "2026-07-01", horizon: "12 months", url: "https://bitcoinmagazine.com/news/citi-slashes-bitcoin-target-to-82000" },
    // "a new all-time high of $[•] by mid-[•]" in its base case (The Block, [•]-[•]-[•]).
    { firm: "Bernstein", target: 150_000, date: "2026-08-26", horizon: "mid-2027", url: "https://theblock.co/news/markets/2026-08-26-bernstein-sees-bitcoin-reaching-150000-by-mid-2027-amid-debasement-trade-but-cuts-strategy-target-to-350-412778" },
  ],
};

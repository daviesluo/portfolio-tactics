// Company names for the Holding list's secondary line, the sector list and the ticker modal (`COMPANY_NAMES`,
// src/tables/holdings_list.jsx, which the `load` answer fills: `namesFor`). The app has no client-side name source for
// equities; a ticker not here shows "--". Extend this map as holdings change.
//
// Here, not in the page's bundle, since 2026-11-09 (Davies: "再研究下有没有办法访客可以看不到历史记录"): the map names every
// holding the book ever had, and the bundle carried it to every visitor. `load` sends the names of the holdings it sends:
// an admin the whole book's, a read-only token its board's alone (never a sold holding's, never an alias's).

export const COMPANY_NAMES: Record<string, string> = {
  'NVDA': 'NVIDIA Corporation',
  'ABT': 'Abbott Laboratories',
  'APLD': 'Applied Digital Corporation',
  'NBIS': 'Nebius Group',
  'GOOGL': 'Alphabet Inc. (Class A)',
  'SPAX.PVT': 'SpaceX',
  'SYK': 'Stryker Corporation',
  'META': 'Meta Platforms, Inc.',
  'KO': 'The Coca-Cola Company',
  'AMGN': 'Amgen Inc.',
  'HD': 'The Home Depot',
  'MSFT': 'Microsoft Corporation',
  'MSTR': 'Strategy (MicroStrategy)',
  'AMZN': 'Amazon.com, Inc.',
  'DIS': 'The Walt Disney Company',
  'RKLB': 'Rocket Lab Corporation',
  'NEE': 'NextEra Energy, Inc.',
  'BTC-USD': 'Bitcoin',
  'ADBE': 'Adobe Inc.',
  'XOM': 'Exxon Mobil Corporation',
  'HOOD': 'Robinhood Markets',
  'TSM': 'Taiwan Semiconductor',
  'WMT': 'Walmart Inc.',
  'NVTS': 'Navitas Semiconductor',
  'MU': 'Micron Technology',
  'INTU': 'Intuit Inc.',
  'MCD': 'McDonald’s Corporation',
  'UNP': 'Union Pacific Corporation',
  'HON': 'Honeywell International',
  'PEP': 'PepsiCo, Inc.',
  'BMNR': 'Bitmine Immersion',
  'CAT': 'Caterpillar Inc.',
  'ORLY': 'O’Reilly Automotive',
  'BF-B': 'Brown-Forman Corporation',
  'SPCX': 'Space Exploration Technologies Corp.',
  'PLTR': 'Palantir Technologies Inc.',
  'BE': 'Bloom Energy Corporation',
  'NKE': 'NIKE, Inc.',
  'NSRGY': 'Nestlé S.A.',
  'CVX': 'Chevron Corporation',
  'VWRL.L': 'Vanguard FTSE All-World UCITS ETF',
  'IWDA.L': 'iShares Core MSCI World UCITS ETF (Acc)',
  '005827': 'E Fund Blue Chip Select Mixed',
};

/** The names of `tickers` this map knows, for the `load` answer. */
export function namesFor(tickers: Iterable<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tickers) if (Object.prototype.hasOwnProperty.call(COMPANY_NAMES, t)) out[t] = COMPANY_NAMES[t];
  return out;
}

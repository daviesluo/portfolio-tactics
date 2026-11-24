// The ticker modal's own quote for a ticker the board does not quote (Davies, 2026-11-23: "已经清仓的ticker里点进去看价格不对"). A
// holding sold out, no shares left, gets no quote on the board's refresh (yahoo_fetch.js `refreshPrices` leaves it out), so the modal
// read its stored lastPrice, the price of its last quote (its sale), as today's, and drew the chart's right edge there. Opening such
// a ticker asks for its quote once (`fetchTickers`), and the modal reads that as any other; until it lands the modal draws the
// chart's own last close (ticker_chart_modal.jsx, a sold-out holding's stored prices are never live).

/**
 * Whether the modal must ask for `ticker`'s quote itself: the board has none for it, and it is a market's ticker (not cash, a private
 * holding or a board strategy, which have no quote anywhere). A holding the board quotes (one with shares) never: the board's quote is
 * the one every surface reads, with what the board lays over it (Trading 212's overnight price, the LSE ETFs' broker price). On
 * 2026-11-24 at 03:52 London (Davies: "有大问题 主页每个个股显示的和点开后显示的不一样") every held ticker's modal asked for its own
 * quote, because `marketData` (the Market Conditions quotes) never holds a holding: MSTR's tile read −2.37 % (Trading 212's 82.39
 * overnight against Monday's close of 84.40) while its modal read +0.58 % (Yahoo's after-hours close of 84.89, eight hours old).
 * @param {string | null | undefined} ticker
 * @param {any} holding
 * @param {Record<string, unknown> | null | undefined} marketData
 */
export function needsViewQuote(ticker, holding, marketData) {
  if (!ticker || marketData?.[ticker]) return false;
  if (ticker === 'CASH' || ticker.endsWith('.PVT') || holding?.isCash || holding?.strategy) return false;
  if (holding && !soldOut(holding)) return false;
  return true;
}

/**
 * The market data the modal reads: the board's, with the modal's own quote for `ticker` where the board has none (the board's
 * quote, when it has one, always wins).
 * @param {Record<string, unknown>} marketData
 * @param {string | null | undefined} ticker
 * @param {unknown} quote
 */
export function withViewQuote(marketData, ticker, quote) {
  return ticker && quote && !marketData?.[ticker] ? { ...marketData, [ticker]: quote } : marketData;
}

/** A holding sold out: closed, no shares left. Its stored prices are its last quote's, not today's. @param {any} holding */
export function soldOut(holding) {
  return !!holding?.closed && !(Number(holding?.shares) > 0);
}

// The ticker modal's own quote for a ticker the board does not quote (src/app/view_quote.js; Davies, 2026-11-23:
// "已经清仓的ticker里点进去看价格不对"). Made-up tickers and prices.
import { describe, expect, it } from 'vitest';
import { needsViewQuote, soldOut, withViewQuote } from './view_quote.js';

describe('the ticker modal\'s own quote', () => {
  const gone = { shares: 0, cost: 0, closed: true, lastPrice: 65 };
  it('asks for a sold-out holding\'s quote, never for one the board quotes, cash, a private holding or a strategy', () => {
    expect(needsViewQuote('GONE', gone, {})).toBe(true);
    expect(needsViewQuote('GONE', gone, { GONE: { lastPrice: 72 } })).toBe(false);
    expect(needsViewQuote('CASH', { isCash: true }, {})).toBe(false);
    expect(needsViewQuote('ACME.PVT', {}, {})).toBe(false);
    expect(needsViewQuote('a private slot', { strategy: 'A' }, {})).toBe(false);
    expect(needsViewQuote(null, null, {})).toBe(false);
  });
  it('adds its quote where the board has none, and never over the board\'s', () => {
    const md = { ACME: { lastPrice: 240 } };
    expect(withViewQuote(md, 'GONE', { lastPrice: 72 })).toEqual({ ACME: { lastPrice: 240 }, GONE: { lastPrice: 72 } });
    expect(withViewQuote(md, 'ACME', { lastPrice: 1 })).toBe(md);
    expect(withViewQuote(md, 'GONE', null)).toBe(md);
  });
  it('a holding is sold out when closed with no shares left', () => {
    expect(soldOut(gone)).toBe(true);
    expect(soldOut({ ...gone, shares: 2 })).toBe(false);
    expect(soldOut({ shares: 0 })).toBe(false);
    expect(soldOut(null)).toBe(false);
  });
});

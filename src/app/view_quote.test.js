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

  it('never for a holding the board quotes: the board\'s quote, its overnight price laid over it, is the modal\'s (2026-11-24, MSTR)', () => {
    // MSTR held, extended hours on overnight: the board's quote has Monday's close as lastPrice and Trading 212's overnight price as
    // extPrice (made-up: 100.00 and 97.63, -2.37 %); Yahoo's own quote for it still carries the after-hours close (100.58, +0.58 %).
    const held = { shares: 10, cost: 90, lastPrice: 100, extPrice: 97.63, extPriceTrusted: true };
    expect(needsViewQuote('MSTR', held, {})).toBe(false);
    const yahoo = { lastPrice: 100, extPrice: 100.58, prevClose: 95 };
    const md = needsViewQuote('MSTR', held, {}) ? withViewQuote({}, 'MSTR', yahoo) : {};
    const ext = /** @type {any} */ (md).MSTR?.extPrice ?? held.extPrice;
    expect(((ext - held.lastPrice) / held.lastPrice) * 100).toBeCloseTo(-2.37, 9);
    // a holding closed but with shares again (bought back) is quoted by the board too; one sold out is not
    expect(needsViewQuote('MSTR', { ...held, closed: true }, {})).toBe(false);
    expect(needsViewQuote('MSTR', { ...held, closed: true, shares: 0 }, {})).toBe(true);
    // a ticker not on the board at all (opened from a list) still asks
    expect(needsViewQuote('NVDA', undefined, {})).toBe(true);
  });
});

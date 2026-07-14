// Pin test for the heatmap tile's display-label helper. The label drops
// the Yahoo exchange suffix so tight tiles aren't cluttered by ".PA" /
// ".L"; the FULL symbol still rides on tile.ticker for clicks + the
// chart-open title, so this strip must never touch anything that would
// change which instrument the click resolves.

import { describe, it, expect } from 'vitest';
import { displayTicker } from './heatmap.jsx';

describe('displayTicker', () => {
  it('strips the exchange suffix from foreign-listed tickers', () => {
    expect(displayTicker('AIR.PA')).toBe('AIR'); // Euronext Paris
    expect(displayTicker('VUKE.L')).toBe('VUKE');   // London
    expect(displayTicker('0700.HK')).toBe('0700');  // Hong Kong
    expect(displayTicker('HEIA.AS')).toBe('HEIA');  // Amsterdam
    expect(displayTicker('SAP.DE')).toBe('SAP');    // XETRA
  });

  it('leaves US equities, indices and bare fund codes untouched', () => {
    expect(displayTicker('NVDA')).toBe('NVDA');
    expect(displayTicker('^GSPC')).toBe('^GSPC');
    expect(displayTicker('005827')).toBe('005827'); // CN fund code
  });

  it('does not strip hyphenated symbols (no exchange dot)', () => {
    // The dot-suffix shape is what we strip — BF-B / BTC-USD use a
    // hyphen, so the part after it is NOT an exchange and must stay.
    expect(displayTicker('BF-B')).toBe('BF-B');
    expect(displayTicker('BTC-USD')).toBe('BTC-USD');
  });

  it('maps aliased foreign-listing codes to the home-market symbol (MBG → SAND)', () => {
    // Mercedes-Benz Group’s German listing — heatmap tiles show the
    // Stockholm home symbol. Applied after the suffix strip so every
    // listing variant maps; everywhere else in the app keeps MBG.
    expect(displayTicker('MBG')).toBe('SAND');
    expect(displayTicker('MBG.F')).toBe('SAND');
    expect(displayTicker('MBG.DE')).toBe('SAND');
  });
});

// Pin tests for detectCurrency. Especially the TICKER_CURRENCY_OVERRIDES
// branch — if the override map regresses, USD-denominated UCITS ETFs
// on LSE (IWDA.L / VWRL.L, the two the T212 sync currently mirrors)
// get classified as GBP and the FX path mis-converts them by ~1.27×
// (the GBPUSD rate), inflating cost basis + market value by the same
// factor. The suffix-fallback cases are pinned for completeness so
// a future "simplify the regex" refactor doesn't quietly drop CN /
// HK detection.

import { describe, it, expect } from 'vitest';
import { detectCurrency } from './fx.js';

describe('detectCurrency', () => {
  it('per-ticker overrides win over suffix rules — USD-denominated LSE ETFs', () => {
    // These would default to GBP under the .L suffix rule. The
    // override exists because T212 reports their averagePrice in USD
    // (they're USD-denominated UCITS) and Yahoo's quote feed prices
    // them in USD too — so the holding currency MUST agree with what
    // both upstreams report, otherwise the FX path applies GBPUSD on
    // top of an already-USD number.
    expect(detectCurrency('IWDA.L')).toBe('USD');
    expect(detectCurrency('VWRL.L')).toBe('USD');
  });

  it('falls back to the suffix rules for non-overridden tickers', () => {
    // GBP-denominated LSE listings (the historical T212 allow-list +
    // anything else the user adds manually) still hit the .L → GBP
    // path.
    expect(detectCurrency('VUKE.L')).toBe('GBP');
    expect(detectCurrency('VMID.L')).toBe('GBP');
    expect(detectCurrency('TSCO.L')).toBe('GBP');
  });

  it('6-digit numeric → CNY (Chinese mutual fund codes)', () => {
    expect(detectCurrency('005827')).toBe('CNY');
    expect(detectCurrency('512880')).toBe('CNY');
  });

  it('.HK suffix → HKD', () => {
    expect(detectCurrency('0700.HK')).toBe('HKD');
  });

  it('default → USD (US equities, crypto, indices, FX pairs)', () => {
    expect(detectCurrency('NVDA')).toBe('USD');
    expect(detectCurrency('BTC-USD')).toBe('USD');
    expect(detectCurrency('^GSPC')).toBe('USD');
    expect(detectCurrency('GBPUSD=X')).toBe('USD');
  });
});

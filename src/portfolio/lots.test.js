import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanLots, totalShares, weightedAvgCost, localToday, latestRowDate } from './lots.js';
import { cleanSells, cleanDividends } from './transactions.js';

describe('cleanLots', () => {
  it('passes through valid lots and sorts ascending by date', () => {
    expect(cleanLots([
      { date: '2026-03-01', shares: 5,  cost: 100 },
      { date: '2026-01-15', shares: 10, cost:  90 },
    ])).toEqual([
      { date: '2026-01-15', shares: 10, cost:  90 },
      { date: '2026-03-01', shares:  5, cost: 100 },
    ]);
  });

  it('coerces string inputs to finite numbers', () => {
    expect(cleanLots([{ date: '2026-01-15', shares: '10', cost: '90.5' }]))
      .toEqual([{ date: '2026-01-15', shares: 10, cost: 90.5 }]);
  });

  it('rejects shares ≤ 0 (zero shares = no holding)', () => {
    expect(cleanLots([
      { date: '2026-01-15', shares: 0,    cost: 100 },
      { date: '2026-01-16', shares: -5,   cost: 100 },
    ])).toEqual([]);
  });

  it('rejects negative cost (data corruption — was silently kept)', () => {
    // `Number("-50") || 0` evaluates to -50, not 0 — the previous
    // inline `Number(l.cost) || 0` let -50 through unchanged.
    expect(cleanLots([{ date: '2026-01-15', shares: 10, cost: -50 }])).toEqual([]);
  });

  it('allows cost = 0 (gifts / spinoffs / cost-basis-unknown lots)', () => {
    expect(cleanLots([{ date: '2026-01-15', shares: 10, cost: 0 }]))
      .toEqual([{ date: '2026-01-15', shares: 10, cost: 0 }]);
  });

  it('rejects NaN / Infinity / non-numeric inputs', () => {
    expect(cleanLots([
      { date: '2026-01-15', shares: NaN,         cost: 100 },
      { date: '2026-01-15', shares: 'abc',       cost: 100 },
      { date: '2026-01-15', shares: 10,          cost: NaN },
      { date: '2026-01-15', shares: Infinity,    cost: 100 },
      { date: '2026-01-15', shares: 10,          cost: Infinity },
    ])).toEqual([]);
  });

  it('rejects empty / malformed dates (must be YYYY-MM-DD)', () => {
    expect(cleanLots([
      { date: '',           shares: 10, cost: 100 },
      { date: '2026-1-15',  shares: 10, cost: 100 },  // missing zero pad
      { date: 'yesterday',  shares: 10, cost: 100 },
      { shares: 10, cost: 100 },                       // no date at all
    ])).toEqual([]);
  });

  it('non-array input → []', () => {
    expect(cleanLots(/** @type {any} */ (null))).toEqual([]);
    expect(cleanLots(/** @type {any} */ ('not-a-list'))).toEqual([]);
  });

  it('preserves an entry timestamp (ts) when present, omits it otherwise', () => {
    const out = cleanLots([
      { date: '2026-01-10', shares: 1, cost: 100, ts: 1717000000000 },
      { date: '2026-01-11', shares: 2, cost: 90 },
    ]);
    expect(out[0]).toEqual({ date: '2026-01-10', shares: 1, cost: 100, ts: 1717000000000 });
    expect(out[1]).toEqual({ date: '2026-01-11', shares: 2, cost: 90 }); // no ts key
  });

  it('returns a fresh sorted copy — does not mutate the input', () => {
    const input = [
      { date: '2026-03-01', shares: 5, cost: 100 },
      { date: '2026-01-15', shares: 10, cost:  90 },
    ];
    const before = JSON.stringify(input);
    cleanLots(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('totalShares', () => {
  it('sums clean lot shares', () => {
    expect(totalShares([{ shares: 10 }, { shares: 5 }])).toBe(15);
  });

  it('empty → 0', () => {
    expect(totalShares([])).toBe(0);
  });
});

describe('weightedAvgCost', () => {
  it('share-weighted average of cost basis', () => {
    // (10 × 90 + 5 × 100) / 15 = 1400 / 15 = 93.333...
    expect(weightedAvgCost([
      { shares: 10, cost:  90 },
      { shares:  5, cost: 100 },
    ])).toBeCloseTo(1400 / 15, 6);
  });

  it('single lot — AC = cost', () => {
    expect(weightedAvgCost([{ shares: 10, cost: 100 }])).toBe(100);
  });

  it('no lots / zero shares → 0 (avoids /0 NaN)', () => {
    expect(weightedAvgCost([])).toBe(0);
  });
});

// Improvement plan item 17 (2026-11-21). "Today" came from `toISOString()`, the UTC date, in the modals and in the
// guards that drop a future-dated row: in the first hour of a British summer day the picker's today is a day ahead of
// it, and a row dated that day was dropped on save without a word.
describe('a row dated the local today is kept, whatever the UTC date', () => {
  const tz = process.env.TZ;
  const at = (/** @type {string} */ zone, /** @type {string} */ iso) => {
    process.env.TZ = zone;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  };
  afterEach(() => {
    vi.useRealTimers();
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  });

  it('00:30 in London in July: local 07-15, UTC still 07-14', () => {
    at('Europe/London', '2026-07-14T23:30:00Z');
    expect(localToday()).toBe('2026-07-15');
    expect(latestRowDate()).toBe('2026-07-15');
    const row = { date: '2026-07-15', shares: 1, cost: 10 };
    expect(cleanLots([row])).toHaveLength(1);
    expect(cleanSells([{ date: '2026-07-15', shares: 1, price: 10 }])).toHaveLength(1);
    expect(cleanDividends([{ date: '2026-07-15', amount: 3 }])).toHaveLength(1);
    // Tomorrow is still the future.
    expect(cleanLots([{ ...row, date: '2026-07-16' }])).toEqual([]);
    expect(cleanSells([{ date: '2026-07-16', shares: 1, price: 10 }])).toEqual([]);
    expect(cleanDividends([{ date: '2026-07-16', amount: 3 }])).toEqual([]);
  });

  it('21:00 in New York: local 07-14 is the picker\'s today, and a fill dated by its UTC day (07-15) is kept too', () => {
    at('America/New_York', '2026-07-15T01:00:00Z');
    expect(localToday()).toBe('2026-07-14');
    expect(latestRowDate()).toBe('2026-07-15');
    expect(cleanLots([{ date: '2026-07-15', shares: 1, cost: 10 }])).toHaveLength(1);
    expect(cleanLots([{ date: '2026-07-16', shares: 1, cost: 10 }])).toEqual([]);
  });

  it('at noon UTC the two dates are one', () => {
    at('UTC', '2026-07-15T12:00:00Z');
    expect([localToday(), latestRowDate()]).toEqual(['2026-07-15', '2026-07-15']);
  });
});

// Pin test for the heatmap tile's display-label helper. The label drops
// the Yahoo exchange suffix so tight tiles aren't cluttered by ".PA" /
// ".L"; the FULL symbol still rides on tile.ticker for clicks + the
// chart-open title, so this strip must never touch anything that would
// change which instrument the click resolves.

import { describe, it, expect } from 'vitest';
import { displayTicker, fitTicker, heatmapItems, treemap, SIX_MIN_RATIO, STACK_MIN_RATIO, STACK_MAX_RATIO } from './heatmap.jsx';

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

// displayTicker now lives in formatters.js because three surfaces label
// tickers the same way — heatmap tiles, tactics-board chips and Top
// Movers rows. The chart modal is deliberately the ONE place that keeps
// showing the true Yahoo symbol, so a tap still resolves the right
// instrument and the user can see which listing they actually hold.
describe('displayTicker — shared across heatmap / pitch / top movers', () => {
  it('maps every MBG listing variant to SAND, including .SG', () => {
    expect(displayTicker('MBG.SG')).toBe('SAND'); // Stuttgart
    expect(displayTicker('MBG.F')).toBe('SAND');  // Frankfurt
    expect(displayTicker('MBG.DE')).toBe('SAND'); // XETRA
    expect(displayTicker('MBG')).toBe('SAND');
  });

  it('is null/undefined-safe (chips render before data lands)', () => {
    expect(displayTicker(/** @type {any} */ (undefined))).toBe('');
    expect(displayTicker(/** @type {any} */ (null))).toBe('');
    expect(displayTicker('')).toBe('');
  });
});

// The VWRL / IWDA bug: a four-character ticker on a narrow tile kept its
// 11px, overflowed, and `word-break: break-all` wrapped it 3 + 1 — a
// lone "M" under "SAE", with the % pressed against the bottom edge.
//
// Closed-form: a glyph costs 0.64 x fontSize (0.6em advance + 0.04em
// tracking) and `.hm-ticker` eats 2px of padding per side, so a label of
// `n` characters fits one line iff  n x 0.64 x fs <= tw - 4.
describe('fitTicker — a ticker fits its tile, or breaks in the middle', () => {
  const fitsOneLine = (label, tw, fs) => label.length * 0.64 * fs <= tw - 4;

  it('shrinks a 4-char ticker until it fits the tile on one line', () => {
    // The tile from the screenshot: ~62px wide. 11px would need
    // 4 x 0.64 x 11 = 28.2px — that fits, so the old size was fine here…
    expect(fitsOneLine('VWRL', 62, fitTicker('VWRL', 62, 62).fontSize)).toBe(true);
    // …but the narrow ones are where it broke. 30px wide leaves 26px:
    // 4 x 0.64 x 11 = 28.2 > 26, so 11px cannot work and the old code
    // used it anyway.
    const tight = fitTicker('VWRL', 30, 40);
    expect(tight.fontSize).toBeLessThan(11);
    expect(fitsOneLine('VWRL', 30, tight.fontSize)).toBe(true);
  });

  it('never orphans a single character — the only break is the midpoint', () => {
    expect(fitTicker('VWRL', 40, 40).mid).toBe(2);   // SA / […]
    expect(fitTicker('IWDA', 40, 40).mid).toBe(2);   // VU / AA
    expect(fitTicker('NVDA', 40, 40).mid).toBe(2);
    expect(fitTicker('BMNR', 40, 40).mid).toBe(2);
    expect(fitTicker('SAND', 40, 40).mid).toBe(2);
    // Odd lengths lean the extra character to the TOP line, never
    // leaving one alone at the bottom.
    expect(fitTicker('CRWV1', 40, 40).mid).toBe(3);  // CRW / V1
    expect(fitTicker('MU', 40, 40).mid).toBe(1);
  });

  it('leaves a short ticker on a roomy tile at full size', () => {
    expect(fitTicker('MU', 90, 90).fontSize).toBe(11);
    expect(fitTicker('NVDA', 90, 90).fontSize).toBe(11);
  });

  it('reserves room under the ticker for the % line', () => {
    // A 22px-tall tile: (22 - 3) * 0.55 / 1.05 = 9.95 -> 9px, so the
    // ticker cannot eat the height the % needs. At 11px the two lines
    // would have been 11.55 + 3 + 10 = 24.5px inside a 22px tile.
    expect(fitTicker('MU', 90, 22).fontSize).toBe(9);
    expect(fitTicker('MU', 90, 60).fontSize).toBe(11);
  });

  it('fits a 4-char ticker on one line at EVERY width the tile shows one', () => {
    // `showTicker` renders the label from 22px up. The old sizing was
    // `max(8, min(11, floor(min(tw, th) / 3)))`, and that 8px floor is
    // the bug: below ~25px it stopped shrinking while the tile kept
    // getting narrower, so the label overflowed and `break-all` wrapped
    // it 3 + 1. Sweep the whole range rather than trusting one tile —
    // the squarify layout will not reliably hand you a 23px tile.
    const oldFs = (tw, th) => Math.max(8, Math.min(11, Math.floor(Math.min(tw, th) / 3)));
    const overflowed = [];
    for (let tw = 22; tw <= 60; tw++) {
      const fs = fitTicker('VWRL', tw, 80).fontSize;
      expect(fitsOneLine('VWRL', tw, fs)).toBe(true);
      if (!fitsOneLine('VWRL', tw, oldFs(tw, 80))) overflowed.push(tw);
    }
    // Measured, not predicted: the old sizing overflowed at 22, 23, 24
    // (the 8px floor) and again at 27, where floor(27/3) = 9 needs
    // 23.04px of a 23px line. Every one of those tiles wrapped 3 + 1.
    expect(overflowed).toEqual([22, 23, 24, 27]);
  });

  it('never goes below 7px, however small the tile', () => {
    expect(fitTicker('LONGEST', 24, 22).fontSize).toBe(7);
    expect(fitTicker('', 24, 22).fontSize).toBeGreaterThanOrEqual(7);
  });
});

describe('heatmapItems — no tile while the exchange rates are loading (review batch 5)', () => {
  // A tile's size is its share of the book: before the first market data, one GBP holding at 1:1 sizes every tile
  // wrong, so the map waits empty (its own empty state) until the rates land.
  const metrics = { positions: {
    CB: { players: [{ ticker: 'BRIT.L', marketValue: 250, dayPct: 4.17, fxMissing: true }] },
    CM: { players: [{ ticker: 'ACME', marketValue: 1440, dayPct: 0.84 }, { ticker: 'CASH', isCash: true, marketValue: 500 }] },
  } };

  it('draws nothing while pending', () => {
    expect(heatmapItems(metrics, true)).toEqual([]);
  });

  it('draws every non-cash holding, largest first, once the rates are in', () => {
    expect(heatmapItems(metrics).map((i) => [i.ticker, i.value, i.pct])).toEqual([['ACME', 1440, 0.84], ['BRIT.L', 250, 4.17]]);
  });
});

// ── The desktop map's top four on the right: one column, as the phone draws them (Davies, 2026-10-20) ──────────────
//
// The weights are the tile areas measured off his desktop screenshot of that day, in px² of the 530 × 810 canvas
// (`.heatmap` 560 × 840 less its 14px padding and 1px border), so they are shares of the book, not amounts. Fed
// through the old split they reproduce that screenshot tile for tile: MSFT/NVDA over SPCX/AMZN on the left, PLTR/RKLB
// over MSTR/SYK on the right (a 4 × 2 block), GOOGL/NBIS/KO over META/BTC-USD/BE, TSM/BMNR beside APLD/HOOD, MU
// over ADBE, and NVTS over SAND (MBG) beside VWRL over IWDA.
const OCT20 = [
  ['MSFT', 34484], ['NVDA', 33785], ['SPCX', 30450], ['AMZN', 29029], ['PLTR', 27816], ['RKLB', 26220],
  ['MSTR', 26208], ['SYK', 23088], ['GOOGL', 23000], ['NBIS', 21000], ['KO', 19000], ['META', 18759],
  ['BTC-USD', 16224], ['BE', 16055], ['TSM', 13334], ['BMNR', 12862], ['APLD', 12765], ['HOOD', 12765],
  ['MU', 11830], ['ADBE', 8300], ['NVTS', 8000], ['MBG', 5100], ['VWRL', 1400], ['IWDA', 1360],
].map(([ticker, value]) => ({ ticker: String(ticker), value: Number(value) }));
const DESKTOP = [530, 810];
const PHONE = [336, 610]; // a 390px-wide phone: `.heatmap` is 100% wide there and 640px tall

// The split as it was before 2026-10-20, kept here as the reference every other layout must still match.
function oldTreemap(nodes, x, y, w, h) {
  if (!nodes.length) return [];
  if (nodes.length === 1) return [{ ...nodes[0], x, y, w, h }];
  const total = nodes.reduce((s, n) => s + n.value, 0);
  let acc = 0, split = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    acc += nodes[i].value;
    split = i;
    if (acc * 2 >= total) break;
  }
  const g1 = nodes.slice(0, split + 1);
  const g2 = nodes.slice(split + 1);
  const frac = g1.reduce((s, n) => s + n.value, 0) / total;
  if (w >= h) {
    const w1 = Math.max(1, Math.round(w * frac));
    return [...oldTreemap(g1, x, y, w1, h), ...oldTreemap(g2, x + w1, y, w - w1, h)];
  }
  const h1 = Math.max(1, Math.round(h * frac));
  return [...oldTreemap(g1, x, y, w, h1), ...oldTreemap(g2, x, y + h1, w, h - h1)];
}
const rects = (tiles) => Object.fromEntries(tiles.map((t) => [t.ticker, [t.x, t.y, t.w, t.h]]));
const changed = (a, b) => Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
const RIGHT4 = ['PLTR', 'RKLB', 'MSTR', 'SYK'];
// The map's six largest, which the 2026-11-16 rule (below) re-lays when they alone fill its top block: with 12 to 15
// holdings of these books, never with all of them.
const OCT20_TOP6 = 'MSFT NVDA SPCX AMZN PLTR RKLB';
/** @param {number[]} values */
const nodes = (values) => values.map((value, i) => ({ ticker: `T${i}`, value }));

describe('treemap — a 2×2 beside a 2×2 stacks its right half into one column (2026-10-20)', () => {
  it('reproduces the old desktop shape first: PLTR/RKLB over MSTR/SYK, a 2×2 on the right', () => {
    const old = rects(oldTreemap(OCT20, 0, 0, DESKTOP[0], DESKTOP[1]));
    expect(RIGHT4.map((t) => old[t])).toEqual([
      [293, 0, 122, 226], [415, 0, 115, 226],
      [293, 226, 126, 206], [419, 226, 111, 206],
    ]);
  });

  it('stacks PLTR, RKLB, MSTR, SYK in one column on the desktop map, as the phone does', () => {
    const now = rects(treemap(OCT20, 0, 0, DESKTOP[0], DESKTOP[1]));
    expect(RIGHT4.map((t) => now[t])).toEqual([
      [293, 0, 237, 116],
      [293, 116, 237, 110],
      [293, 226, 237, 110],
      [293, 336, 237, 96],
    ]);
    // The column fills exactly the block the 2×2 filled: x 293..530, y 0..432.
    // Each tile as drawn (3px gap off each side) is wider than tall and no flatter than 3 : 1: [•] at most (SYK).
    for (const t of RIGHT4) {
      const [, , w, h] = now[t];
      expect((w - 3) / (h - 3)).toBeGreaterThanOrEqual(STACK_MIN_RATIO);
      expect((w - 3) / (h - 3)).toBeLessThanOrEqual(STACK_MAX_RATIO);
    }
  });

  it('leaves every other tile of that map where it was', () => {
    const now = rects(treemap(OCT20, 0, 0, DESKTOP[0], DESKTOP[1]));
    const old = rects(oldTreemap(OCT20, 0, 0, DESKTOP[0], DESKTOP[1]));
    // GOOGL and NBIS: the bottom-left six stacking their first two since 2026-10-21 (below), the shape he chose then.
    expect(changed(now, old)).toEqual([...RIGHT4, 'GOOGL', 'NBIS']);
  });

  it('changes nothing on the phone, which already stacks them, but the top six of 2026-11-16 (below)', () => {
    const differs = [];
    for (let n = 1; n <= OCT20.length; n++) {
      const set = OCT20.slice(0, n);
      const d = changed(rects(treemap(set, 0, 0, PHONE[0], PHONE[1])), rects(oldTreemap(set, 0, 0, PHONE[0], PHONE[1])));
      if (d.length) differs.push(`${n}: ${d.join(' ')}`);
    }
    expect(differs).toEqual([14, 15].map((n) => `${n}: ${OCT20_TOP6}`));
    expect(rects(treemap(OCT20, 0, 0, PHONE[0], PHONE[1])).SYK).toEqual([186, 253, 150, 73]);
  });

  it('changes only that case across the book\'s every prefix at five canvas sizes', () => {
    const differs = [];
    for (let n = 1; n <= OCT20.length; n++) {
      for (const [w, h] of [DESKTOP, PHONE, [530, 610], [400, 810], [300, 610]]) {
        const set = OCT20.slice(0, n);
        const d = changed(rects(treemap(set, 0, 0, w, h)), rects(oldTreemap(set, 0, 0, w, h)));
        if (d.length) differs.push(`${n}@${w}x${h}: ${d.join(' ')}`);
      }
    }
    // [•] to [•] holdings: the top block as above. [•] holdings: the same shape one level down, KO/META over
    // BTC-USD/BE beside MSTR/SYK over GOOGL/NBIS, now KO, META, BTC-USD, BE in one column ([•] wide, [•] to [•] tall).
    // 22 to 24 also stack GOOGL over NBIS, the 2026-10-21 rule below. 12 to 15: the top six of 2026-11-16, below.
    expect(differs).toEqual([
      `12@530x810: ${OCT20_TOP6}`,
      `13@530x810: ${OCT20_TOP6}`,
      `14@530x810: ${OCT20_TOP6} KO META BTC-USD BE`,
      `14@336x610: ${OCT20_TOP6}`,
      `15@336x610: ${OCT20_TOP6}`,
      ...[20, 21].map((n) => `${n}@530x810: ${RIGHT4.join(' ')}`),
      ...[22, 23, 24].map((n) => `${n}@530x810: ${RIGHT4.join(' ')} GOOGL NBIS`),
    ]);
  });

  it('leaves other books alone: equal weights, a steep book, one dominant holding — all but sixteen equal tiles', () => {
    const books = [
      nodes([1, 1, 1, 1]), nodes([1, 1, 1, 1, 1, 1, 1, 1]), nodes(Array(16).fill(1)),
      nodes(Array.from({ length: 12 }, (_, i) => 100 * 0.8 ** i)),
      nodes([60, 10, 9, 8, 7, 6]),
    ];
    const differs = [];
    books.forEach((book, i) => {
      for (const [w, h] of [DESKTOP, PHONE, [530, 610], [800, 400]]) {
        const d = changed(rects(treemap(book, 0, 0, w, h)), rects(oldTreemap(book, 0, 0, w, h)));
        if (d.length) differs.push(`${i}@${w}x${h}: ${d.join(' ')}`);
      }
    });
    // Sixteen equal holdings are the one book here with the same shape: a 4 × 4 grid is two 2×2 pairs per half,
    // and each right-hand 2×2 now stacks (T4-T7, T12-T15), at the desktop and phone sizes and the wide one alike.
    expect(differs).toEqual(['2@530x810', '2@336x610', '2@800x400'].map((k) => `${k}: T4 T5 T6 T7 T12 T13 T14 T15`));
  });

  it('keeps the 2×2 when stacking would flatten a tile past 3 : 1', () => {
    // Left and right are each 70 × 100, cut 60 / 40 into pairs 70 wide: both 2×2. Stacked, the right's 10 would
    // be 70 × 10 (7 : 1), so it stays put; with near-equal weights the column reads 2.7 to 2.9 : 1 and stacks.
    const flat = nodes([30, 30, 30, 10, 30, 30, 30, 10]);
    expect(treemap(flat, 0, 0, 140, 100)).toEqual(oldTreemap(flat, 0, 0, 140, 100));
    const even = nodes([26, 25, 25, 24, 26, 25, 25, 24]);
    expect(rects(treemap(even, 0, 0, 140, 100))).toMatchObject({
      T4: [70, 0, 70, 26], T5: [70, 26, 70, 25], T6: [70, 51, 70, 25], T7: [70, 76, 70, 24],
    });
    // The book's own boundary: at h [•] the column's SYK would pass 3 : 1 from a 648px-wide canvas on, and the
    // 2×2 stays. (`.heatmap` caps at 560px, a 530px canvas, so the desktop map never gets there.)
    expect(rects(treemap(OCT20, 0, 0, 647, 810)).SYK[2]).toBe(647 - 358);
    const at648 = rects(treemap(OCT20, 0, 0, 648, 810)), old648 = rects(oldTreemap(OCT20, 0, 0, 648, 810));
    expect(RIGHT4.map((t) => at648[t])).toEqual(RIGHT4.map((t) => old648[t]));
  });

  it('keeps the right 2×2 when the left half is not a 2×2 as well', () => {
    // Seven tiles: the left half is three (35, 35, 30), so the right four keep the split's own 2×2.
    const book = nodes([35, 35, 30, 26, 25, 25, 24]);
    expect(treemap(book, 0, 0, 140, 100)).toEqual(oldTreemap(book, 0, 0, 140, 100));
  });
});

// ── The bottom-left six: two stacked beside one tall over a row of three, not a plain 2 × 3 (Davies, 2026-10-21) ──
//
// Weights measured off his two desktop screenshots of 10-21 as OCT20's were (tile areas in px² of the 530 × 810
// canvas, shares of the book, not amounts). PLAIN is the moment he did not like: through the 10-20 split its
// bottom-left six come out SYK NBIS KO over META BE BTC-USD, a plain 2 × 3. PREFERRED is the other moment: SYK
// over NBIS beside a tall KO, then META BE BTC-USD in a row. Everything else of both reproduces its screenshot:
// NVDA/MSFT (MSFT/NVDA) over SPCX/MSTR, AMZN PLTR RKLB GOOGL in a column, BMNR over APLD beside TSM over HOOD, MU
// over NVTS beside ADBE over SAND over VWRL|IWDA.
const weights = (pairs) => pairs.map(([ticker, value]) => ({ ticker: String(ticker), value: Number(value) }));
const PLAIN = weights([
  ['NVDA', 33336], ['MSFT', 32989], ['SPCX', 31575], ['MSTR', 28733], ['AMZN', 27766], ['PLTR', 27524],
  ['RKLB', 26796], ['GOOGL', 24856], ['SYK', 19355], ['NBIS', 19061], ['KO', 18670], ['META', 17903],
  ['BE', 16112], ['BTC-USD', 15771], ['BMNR', 13315], ['APLD', 13074], ['TSM', 12763], ['HOOD', 12532],
  ['MU', 11243], ['NVTS', 7956], ['ADBE', 7576], ['MBG', 5068], ['VWRL', 1286], ['IWDA', 1262],
]);
const PREFERRED = weights([
  ['MSFT', 33336], ['NVDA', 32989], ['SPCX', 31786], ['MSTR', 28523], ['AMZN', 27766], ['PLTR', 27524],
  ['RKLB', 26796], ['GOOGL', 24856], ['SYK', 19310], ['NBIS', 19300], ['KO', 19150], ['META', 17356],
  ['BE', 15923], ['BTC-USD', 15755], ['BMNR', 13436], ['APLD', 12954], ['TSM', 12873], ['HOOD', 12640],
  ['MU', 11243], ['NVTS', 7956], ['ADBE', 7649], ['MBG', 5117], ['VWRL', 1286], ['IWDA', 1286],
]);
const SIX = ['SYK', 'NBIS', 'KO', 'META', 'BE', 'BTC-USD'];

// The split as it stood from 2026-10-20 (its right-hand 2×2 stacking included), the reference for this change.
function oct20Treemap(ns, x, y, w, h, column = false) {
  if (!ns.length) return [];
  if (ns.length === 1) return [{ ...ns[0], x, y, w, h }];
  const halve = (list) => {
    const total = list.reduce((s, n) => s + n.value, 0);
    let acc = 0, split = 0;
    for (let i = 0; i < list.length - 1; i++) {
      acc += list[i].value;
      split = i;
      if (acc * 2 >= total) break;
    }
    const a = list.slice(0, split + 1);
    return { g1: a, g2: list.slice(split + 1), frac: a.reduce((s, n) => s + n.value, 0) / total };
  };
  const twoByTwo = (list, w0, h0) => {
    if (list.length !== 4 || w0 >= h0) return false;
    const { g1, frac } = halve(list);
    if (g1.length !== 2) return false;
    const h1 = Math.max(1, Math.round(h0 * frac));
    return w0 >= h1 && w0 >= h0 - h1;
  };
  const { g1, g2, frac } = halve(ns);
  if (w >= h && !column) {
    const w1 = Math.max(1, Math.round(w * frac));
    const total = g2.reduce((s, n) => s + n.value, 0);
    const stack = twoByTwo(g1, w1, h) && twoByTwo(g2, w - w1, h)
      && g2.every((n) => { const r = (w - w1) / ((h * n.value) / total); return r >= 1 && r <= 3; });
    return [...oct20Treemap(g1, x, y, w1, h), ...oct20Treemap(g2, x + w1, y, w - w1, h, stack)];
  }
  const h1 = Math.max(1, Math.round(h * frac));
  return [...oct20Treemap(g1, x, y, w, h1, column), ...oct20Treemap(g2, x, y + h1, w, h - h1, column)];
}

describe('treemap — the bottom-left six stack their first two beside the third (2026-10-21)', () => {
  /** The six as image 10 draws them: first over second, beside a third as tall as both, over three in a row. */
  const preferredShape = (r) => {
    const [a, b, c, d, e, f] = SIX.map((t) => r[t]);
    return a[0] === b[0] && a[2] === b[2] && b[1] === a[1] + a[3] && c[0] === a[0] + a[2] && c[1] === a[1]
      && c[3] === a[3] + b[3] && d[1] === e[1] && e[1] === f[1] && d[1] === c[1] + c[3] && a[2] >= a[3] && b[2] >= b[3];
  };

  it('reproduces his plain 2 × 3 under the split as it stood, and his preferred shape on the other day', () => {
    const plain = rects(oct20Treemap(PLAIN, 0, 0, DESKTOP[0], DESKTOP[1]));
    expect(SIX.map((t) => plain[t])).toEqual([
      [0, 444, 100, 196], [100, 444, 98, 196], [198, 444, 96, 196],
      [0, 640, 106, 170], [106, 640, 95, 170], [201, 640, 93, 170],
    ]);
    expect(preferredShape(plain)).toBe(false);
    const preferred = rects(oct20Treemap(PREFERRED, 0, 0, DESKTOP[0], DESKTOP[1]));
    expect(preferredShape(preferred)).toBe(true);
    expect(preferred.SYK).toEqual([0, 443, 196, 99]);
  });

  it('draws the plain day as the preferred one: SYK over NBIS beside a tall KO, META BE BTC-USD below', () => {
    const now = rects(treemap(PLAIN, 0, 0, DESKTOP[0], DESKTOP[1]));
    expect(SIX.map((t) => now[t])).toEqual([
      [0, 444, 198, 99], [0, 543, 198, 97], [198, 444, 96, 196],
      [0, 640, 106, 170], [106, 640, 95, 170], [201, 640, 93, 170],
    ]);
    expect(preferredShape(now)).toBe(true);
    // As drawn (3px gap), SYK [•] × [•] and NBIS [•] × [•]: about 2 : 1, inside the stack bounds.
    for (const t of ['SYK', 'NBIS']) {
      const [, , w, h] = now[t];
      expect((w - 3) / (h - 3)).toBeGreaterThanOrEqual(STACK_MIN_RATIO);
      expect((w - 3) / (h - 3)).toBeLessThanOrEqual(STACK_MAX_RATIO);
    }
  });

  it('moves nothing else on either day: only SYK and NBIS on the plain one, nothing on the preferred one', () => {
    expect(changed(rects(treemap(PLAIN, 0, 0, DESKTOP[0], DESKTOP[1])), rects(oct20Treemap(PLAIN, 0, 0, DESKTOP[0], DESKTOP[1]))))
      .toEqual(['SYK', 'NBIS']);
    expect(treemap(PREFERRED, 0, 0, DESKTOP[0], DESKTOP[1])).toEqual(oct20Treemap(PREFERRED, 0, 0, DESKTOP[0], DESKTOP[1]));
  });

  it('changes nothing on the phone, whose six already stack, but the top six of 2026-11-16 (below)', () => {
    const differs = [];
    for (const [name, b] of /** @type {[string, any[]][]} */ ([['OCT20', OCT20], ['PLAIN', PLAIN], ['PREFERRED', PREFERRED]])) {
      for (let n = 1; n <= b.length; n++) {
        const set = b.slice(0, n);
        const d = changed(rects(treemap(set, 0, 0, PHONE[0], PHONE[1])), rects(oct20Treemap(set, 0, 0, PHONE[0], PHONE[1])));
        if (d.length) differs.push(`${name} ${n}: ${d.join(' ')}`);
      }
    }
    const top6 = (b) => b.slice(0, 6).map((t) => t.ticker).join(' ');
    expect(differs).toEqual([
      ...[14, 15].map((n) => `OCT20 ${n}: ${top6(OCT20)}`),
      ...[14, 15].map((n) => `PLAIN ${n}: ${top6(PLAIN)}`),
      ...[14, 15].map((n) => `PREFERRED ${n}: ${top6(PREFERRED)}`),
    ]);
  });

  it('changes only that six across three books\' every prefix at five canvas sizes', () => {
    const differs = [];
    for (const [name, b] of /** @type {[string, any[]][]} */ ([['OCT20', OCT20], ['PLAIN', PLAIN], ['PREFERRED', PREFERRED]])) {
      for (let n = 1; n <= b.length; n++) {
        for (const [w, h] of [DESKTOP, PHONE, [530, 610], [400, 810], [300, 610]]) {
          const set = b.slice(0, n);
          const d = changed(rects(treemap(set, 0, 0, w, h)), rects(oct20Treemap(set, 0, 0, w, h)));
          if (d.length) differs.push(`${name} ${n}@${w}x${h}: ${d.join(' ')}`);
        }
      }
    }
    // OCT20's own bottom-left six (GOOGL NBIS KO over META BTC-USD BE) were the same plain 2 × 3, and stack too.
    // PREFERRED's 24 already stack, as on his screen; with 21 to 23 of them the six come out plain and stack.
    // And with 12 to 15 holdings, each book's top six alone: the 2026-11-16 rule below.
    const top6 = (name, b, n, size) => `${name} ${n}@${size}: ${b.slice(0, 6).map((t) => t.ticker).join(' ')}`;
    const sixAt = (name, b, desk) => [
      ...desk.map((n) => top6(name, b, n, '530x810')), top6(name, b, 14, '336x610'), top6(name, b, 15, '336x610'),
    ].sort((a, c) => parseInt(a.split(' ')[1]) - parseInt(c.split(' ')[1]));
    expect(differs).toEqual([
      ...sixAt('OCT20', OCT20, [12, 13, 14]),
      ...[22, 23, 24].map((n) => `OCT20 ${n}@530x810: GOOGL NBIS`),
      ...sixAt('PLAIN', PLAIN, [13, 14]),
      ...[21, 22, 23, 24].map((n) => `PLAIN ${n}@530x810: SYK NBIS`),
      ...sixAt('PREFERRED', PREFERRED, [13, 14]),
      ...[21, 22, 23].map((n) => `PREFERRED ${n}@530x810: SYK NBIS`),
    ]);
  });

  it('leaves the synthetic books alone', () => {
    const books = [
      nodes([1, 1, 1, 1]), nodes([1, 1, 1, 1, 1, 1]), nodes([1, 1, 1, 1, 1, 1, 1, 1]), nodes(Array(16).fill(1)),
      nodes(Array.from({ length: 12 }, (_, i) => 100 * 0.8 ** i)), nodes([60, 10, 9, 8, 7, 6]),
    ];
    for (const b of books) {
      for (const [w, h] of [DESKTOP, PHONE, [530, 610], [800, 400]]) expect(treemap(b, 0, 0, w, h)).toEqual(oct20Treemap(b, 0, 0, w, h));
    }
  });

  it('keeps the plain 2 × 3 when stacking would flatten a tile past 3 : 1', () => {
    // A 90 × 100 six on the left of a 174 × 100 book: 40 21 20 over 20 19 19, each three a row. Stacked, the 21
    // would be 68 × 20 (3.4 : 1), so the six stay plain; with 30 26 25 on top the pair reads about 2 : 1 and stacks.
    const flat = nodes([40, 21, 20, 20, 19, 19, 19, 19, 19, 19, 19, 19, 15]);
    expect(treemap(flat, 0, 0, 174, 100)).toEqual(oct20Treemap(flat, 0, 0, 174, 100));
    const even = nodes([30, 26, 25, 20, 19, 19, 19, 19, 19, 19, 19, 19, 15]);
    const now = rects(treemap(even, 0, 0, 174, 100)), was = rects(oct20Treemap(even, 0, 0, 174, 100));
    expect(changed(now, was)).toEqual(['T0', 'T1']);
    expect(now.T1[0]).toBe(now.T0[0]);
    expect(now.T1[1]).toBe(now.T0[1] + now.T0[3]);
  });

  it('keeps the six as the split lays them when no side-by-side cut puts them on the left', () => {
    const six = PLAIN.filter((n) => SIX.includes(n.ticker));
    expect(treemap(six, 0, 0, 293, 366)).toEqual(oct20Treemap(six, 0, 0, 293, 366));
  });
});

// ── The map's top six: a 2 × 2 beside a column of two, not a plain 2 × 3 (Davies, 2026-11-16) ──────────────────────
//
// "上面6个都是2*3太单调了": on his phone the six largest filled the map's top block as two columns of three. He prefers
// the shape of another day, a 2 × 2 beside a column. Weights are the tile areas measured off that phone screenshot (px²
// of the image, rounded), shares of the book and not amounts; T16 and T19 stand for two rows that are not tickers or
// were cut off. Through the split as it stood they reproduce the screenshot: SPCX AMZN NVDA in the left column, RKLB
// GOOGL MSTR in the right, then PLTR/TSM over META, NBIS/MU, BE over APLD beside HOOD, and the small ones.
const NOV16 = weights([
  ['SPCX', 112], ['AMZN', 90], ['NVDA', 89], ['RKLB', 83], ['GOOGL', 80], ['MSTR', 70], ['PLTR', 63], ['TSM', 58],
  ['META', 54], ['NBIS', 50], ['MU', 46], ['BE', 45], ['APLD', 42], ['HOOD', 38], ['BTC-USD', 32], ['T16', 27],
  ['BMNR', 25], ['NVTS', 24], ['T19', 5],
]);
const NOV16_TOP6 = ['SPCX', 'AMZN', 'NVDA', 'RKLB', 'GOOGL', 'MSTR'];

describe('treemap — the top six as a 2 × 2 beside a column of two (2026-11-16)', () => {
  it('reproduces his two columns of three under the split as it stood', () => {
    const was = rects(oct20Treemap(NOV16, 0, 0, PHONE[0], PHONE[1]));
    expect(NOV16_TOP6.map((t) => was[t])).toEqual([
      [0, 0, 187, 119], [0, 119, 187, 95], [0, 214, 187, 95],
      [187, 0, 149, 110], [187, 110, 149, 106], [187, 216, 149, 93],
    ]);
  });

  it('drew SPCX AMZN over NVDA RKLB beside GOOGL over MSTR until 2026-11-18, now the nested shape of that day (below)', () => {
    // The 2026-11-16 layout, which he then found as plain as the grid it replaced; superseded by `sixAsTwoBesideFour`.
    // Now: SPCX over AMZN on the left, NVDA over RKLB as wide tiles on the right, GOOGL beside MSTR beneath them.
    const now = rects(treemap(NOV16, 0, 0, PHONE[0], PHONE[1]));
    expect(NOV16_TOP6.map((t) => now[t])).toEqual([
      [0, 0, 130, 171], [0, 171, 130, 138], [130, 0, 206, 85],
      [130, 85, 206, 80], [130, 165, 110, 144], [240, 165, 96, 144],
    ]);
    // The block is the one the grid filled: x 0..336, y 0..309. No skinny strip, nothing flatter than 3 : 1.
    for (const t of NOV16_TOP6) {
      const [, , w, h] = now[t];
      expect(w / h).toBeGreaterThanOrEqual(SIX_MIN_RATIO);
      expect(w / h).toBeLessThanOrEqual(STACK_MAX_RATIO);
    }
  });

  it('moves nothing else on that map, and nothing of it on the desktop', () => {
    const at = (fn, w, h) => rects(fn(NOV16, 0, 0, w, h));
    expect(changed(at(treemap, PHONE[0], PHONE[1]), at(oct20Treemap, PHONE[0], PHONE[1]))).toEqual(NOV16_TOP6);
    expect(changed(at(treemap, DESKTOP[0], DESKTOP[1]), at(oct20Treemap, DESKTOP[0], DESKTOP[1]))).toEqual([]);
  });

  it('keeps the grid when both shapes would pass a bound, and falls back to the 2 × 2 beside a column when only the nested one would', () => {
    // 50 30 25 25 25 25 in 110 × 110: two columns of three. Nested, the last two would be 30 × 55 (0.55 less a rounding);
    // as a 2 × 2 beside a column, the 30 33 × 68 or so (0.48): the grid stays. At 120 × 110 the nested shape fits.
    const six = nodes([50, 30, 25, 25, 25, 25]);
    expect(treemap(six, 0, 0, 110, 110)).toEqual(oct20Treemap(six, 0, 0, 110, 110));
    const nested = rects(treemap(six, 0, 0, 120, 110));
    expect(Object.values(nested)).toEqual([[0, 0, 53, 69], [0, 69, 53, 41], [53, 0, 67, 28], [53, 28, 67, 27], [53, 55, 34, 55], [87, 55, 33, 55]]);
    // 30 30 25 25 25 25 in 140 × 110: nested, the third and fourth would be 87 × 28 (3.1), flatter than 3 : 1, so the
    // 2026-11-16 shape is drawn instead: the first four a 2 × 2, the last two stacked beside them.
    const even = nodes([30, 30, 25, 25, 25, 25]);
    expect(Object.values(rects(treemap(even, 0, 0, 140, 110)))).toEqual([[0, 0, 48, 60], [48, 0, 48, 60], [0, 60, 48, 50], [48, 60, 48, 50], [96, 0, 44, 55], [96, 55, 44, 55]]);
  });

  it('touches only the map\'s top-left block: the same six anywhere else keep their grid', () => {
    const six = nodes([50, 30, 25, 25, 25, 25]);
    expect(treemap(six, 10, 0, 140, 110)).toEqual(oct20Treemap(six, 10, 0, 140, 110));
    expect(treemap(six, 0, 40, 140, 110)).toEqual(oct20Treemap(six, 0, 40, 140, 110));
  });
});

// ── The map's top six, nested: two stacked beside two wide over a pair (Davies, 2026-11-18) ──────────────────────────
//
// "相比图一上半部分我更喜欢图二那种排列，不然上面光是2*3太无聊了": on his phone the 2026-11-16 rule above drew the six largest as SPCX
// AMZN over NVDA GOOGL beside RKLB over MSTR, which reads as a plain 2 × 3; he prefers the nested shape of another day,
// a column of wide tiles beside two stacked over a pair. NOV18 is a made-up book in that screenshot's order and rough
// proportions (not its amounts or areas): nineteen holdings, the top six of similar size, SPCX the largest.
const NOV18 = weights([
  ['SPCX', 120], ['AMZN', 98], ['NVDA', 93], ['GOOGL', 86], ['RKLB', 84], ['MSTR', 75], ['PLTR', 66], ['TSM', 61],
  ['META', 58], ['NBIS', 54], ['MU', 50], ['BE', 47], ['APLD', 45], ['HOOD', 40], ['a private slot', 38], ['BTC-USD', 36],
  ['BMNR', 28], ['NVTS', 25], ['a private slot', 6],
]);
const NOV18_TOP6 = ['SPCX', 'AMZN', 'NVDA', 'GOOGL', 'RKLB', 'MSTR'];
// The rule of 2026-11-16 alone (the top six as a 2 × 2 beside a column, else the split): what he saw that day.
function nov16Treemap(ns, x, y, w, h) {
  const total = ns.reduce((s, n) => s + n.value, 0);
  const fw = Math.max(1, Math.round((w * ns.slice(0, 4).reduce((s, n) => s + n.value, 0)) / total));
  return [...oct20Treemap(ns.slice(0, 4), x, y, fw, h), ...oct20Treemap(ns.slice(4), x + fw, y, w - fw, h, true)];
}

describe('treemap — the top six nested, not a 2 × 2 beside a column (2026-11-18)', () => {
  it('reproduces his 2 × 2 beside a column under the rule of 2026-11-16', () => {
    // The split cuts the top block 336 × 306 off the phone's canvas, and the six as two columns of three in it.
    const all = rects(treemap(NOV18, 0, 0, PHONE[0], PHONE[1]));
    const block = Object.values(all).filter(([x, y]) => y < 306 && x < 336).length;
    expect(block).toBe(6);
    const was = rects(nov16Treemap(NOV18.slice(0, 6), 0, 0, 336, 306));
    expect(NOV18_TOP6.map((t) => was[t])).toEqual([
      [0, 0, 132, 168], [132, 0, 108, 168], [0, 168, 125, 138],
      [125, 168, 115, 138], [240, 0, 96, 162], [240, 162, 96, 144],
    ]);
    // Its rows line up across the block (SPCX AMZN RKLB over NVDA GOOGL MSTR, as on his screen): the plain 2 × 3.
    expect(Math.abs(was.SPCX[3] - was.RKLB[3])).toBeLessThan(10);
  });

  it('draws SPCX over AMZN beside NVDA over GOOGL as wide tiles over RKLB | MSTR', () => {
    const now = rects(treemap(NOV18, 0, 0, PHONE[0], PHONE[1]));
    expect(NOV18_TOP6.map((t) => now[t])).toEqual([
      [0, 0, 132, 168], [0, 168, 132, 138], [132, 0, 204, 84],
      [132, 84, 204, 78], [132, 162, 108, 144], [240, 162, 96, 144],
    ]);
    for (const t of NOV18_TOP6) {
      const [, , w, h] = now[t];
      expect(w / h).toBeGreaterThanOrEqual(SIX_MIN_RATIO);
      expect(w / h).toBeLessThanOrEqual(STACK_MAX_RATIO);
    }
  });

  it('moves nothing else on that map, and nothing of it on the desktop', () => {
    const at = (fn, w, h) => rects(fn(NOV18, 0, 0, w, h));
    expect(changed(at(treemap, PHONE[0], PHONE[1]), at(oct20Treemap, PHONE[0], PHONE[1]))).toEqual(NOV18_TOP6);
    expect(changed(at(treemap, DESKTOP[0], DESKTOP[1]), at(oct20Treemap, DESKTOP[0], DESKTOP[1]))).toEqual([]);
    // The desktop's six, as the sweep reads them (less its gap): the split's own.
    expect(NOV18_TOP6.map((t) => at(treemap, DESKTOP[0], DESKTOP[1])[t])).toEqual([
      [0, 0, 163, 285], [163, 0, 133, 285], [0, 285, 296, 121], [296, 0, 234, 143], [296, 143, 234, 139], [296, 282, 234, 124],
    ]);
  });
});

// The other day's shape, the one he prefers, stays as it was: a made-up book in that screenshot's order and rough
// proportions, where the top block holds seven (SPCX AMZN NVDA in a column of wide tiles beside RKLB over GOOGL over
// MSTR | PLTR), so neither six-tile rule touches it.
const NOV18_LIKED = weights([
  ['SPCX', 116], ['AMZN', 97], ['NVDA', 95], ['RKLB', 85], ['GOOGL', 83], ['MSTR', 74], ['PLTR', 66], ['TSM', 62],
  ['META', 61], ['NBIS', 60], ['MU', 55], ['BE', 52], ['APLD', 51], ['HOOD', 43], ['a private slot', 37], ['BTC-USD', 35],
  ['BMNR', 26], ['NVTS', 25], ['a private slot', 6],
]);

describe('treemap — the nested top block he liked on 2026-11-18 lays out as before', () => {
  it('keeps SPCX AMZN NVDA beside RKLB over GOOGL over MSTR | PLTR, the split\'s own on the phone', () => {
    const now = rects(treemap(NOV18_LIKED, 0, 0, PHONE[0], PHONE[1]));
    expect(changed(now, rects(oct20Treemap(NOV18_LIKED, 0, 0, PHONE[0], PHONE[1])))).toEqual([]);
    const [sp, am, nv, rk, go, ms, pl] = ['SPCX', 'AMZN', 'NVDA', 'RKLB', 'GOOGL', 'MSTR', 'PLTR'].map((t) => now[t]);
    // SPCX, AMZN, NVDA one column at the left edge; RKLB over GOOGL, one width, to its right; MSTR beside PLTR below them.
    expect([sp[0], am[0], nv[0]]).toEqual([0, 0, 0]);
    expect(am[2]).toBe(sp[2]);
    expect(nv[2]).toBe(sp[2]);
    expect(rk[0]).toBe(sp[2]);
    expect([go[0], go[2]]).toEqual([rk[0], rk[2]]);
    expect(ms[1]).toBe(pl[1]);
    expect(ms[1]).toBe(go[1] + go[3]);
    expect(pl[0]).toBe(ms[0] + ms[2]);
  });
});

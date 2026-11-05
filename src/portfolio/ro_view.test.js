// The read-only visitor's book (supabase/functions/data/ro_view.ts) is cut to what the viewer's page uses, so the
// page's own maths must give the same figures from it as from the whole book: the scoreboard and every card (shares,
// average cost net of dividends, value, gain), the vs-S&P line's value and basis on every range and every day of it,
// and Top Movers' window moves. This runs the client's pipeline (migrate, the Trading 212 merge, the fill rebuild, the
// closed-slot restore, the dividend costs) on both and compares. Every figure is made up.
import { describe, expect, it } from 'vitest';
import { migrate } from './portfolio_remote.js';
import { applyTrading212Answer, stripClosedFromPositions } from './trading212.js';
import { applyFillLedgers, dividendEventsByTicker, withClosedFromFills, withDividendCosts } from './t212_fills.js';
import { computeMetrics } from './metrics.js';
import { fxToUSD } from './fx.js';
import { computeAt, buildTickerSeries, anchorDateFor, RANGE_KEYS } from '../charts/ytd.js';
import { holdingMoveOver } from '../board/movers.js';

// A computed path, so the type-checker leaves the Deno module to Deno; vitest transforms it like any module.
const RO_VIEW = new URL('../../supabase/functions/data/ro_view.ts', import.meta.url).href;
const ro = await import(/* @vite-ignore */ RO_VIEW);

const DAY = 86_400_000;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const TODAY = iso(NOW);
const dayAgo = (n) => iso(NOW - n * DAY);
const CUT = Date.parse(`${ro.roCutoff(NOW).cutoff}T00:00:00Z`);
/** `n` days before the fold's cutoff. */
const preCut = (n) => iso(CUT - n * DAY);
const fill = (ticker, date, side, shares, price, hh = '14:30') =>
  ({ id: `${ticker}-${date}-${hh}-${side}`, account: 'invest', ticker, side, shares, price, executed_at: `${date}T${hh}:00+00:00`, currency: 'USD' });
const net = (rows) => rows.reduce((a, o) => a + (o.side === 'sell' ? -o.shares : o.shares), 0);
const asLedger = (rows) => ({
  lots: rows.filter((o) => o.side !== 'sell').map((o, i) => ({ date: o.executed_at.slice(0, 10), shares: o.shares, cost: o.price, ts: i })),
  sells: rows.filter((o) => o.side === 'sell').map((o, i) => ({ date: o.executed_at.slice(0, 10), shares: o.shares, price: o.price, ts: i })),
});

const ACME_FILLS = [
  fill('ACME', preCut(200), 'buy', 4, 10), fill('ACME', preCut(150), 'buy', 2, 13), fill('ACME', preCut(90), 'sell', 1, 16),
  fill('ACME', preCut(20), 'buy', 1.5, 11),
  fill('ACME', dayAgo(100), 'buy', 1, 18), fill('ACME', dayAgo(40), 'buy', 2, 20), fill('ACME', dayAgo(40), 'buy', 0.5, 21, '18:05'),
  fill('ACME', dayAgo(12), 'sell', 1.5, 24), fill('ACME', dayAgo(3), 'buy', 0.25, 25),
];
const BOLT_FILLS = [
  fill('BOLT', preCut(60), 'buy', 10, 3), fill('BOLT', preCut(30), 'sell', 4, 5),
  fill('BOLT', dayAgo(20), 'buy', 3, 4), fill('BOLT', dayAgo(20), 'buy', 2, 4.4, '19:00'), fill('BOLT', dayAgo(6), 'sell', 2, 4.8),
];
// Closed for good, and closed with a slot Trading 212 can put it back on: a round trip each.
const GONE_FILLS = [fill('GONE', preCut(100), 'buy', 3, 7), fill('GONE', dayAgo(50), 'sell', 3, 9)];
const ZETA_FILLS = [fill('ZETA', preCut(80), 'buy', 2, 6), fill('ZETA', preCut(10), 'sell', 2, 5)];
const ORDERS = [...ACME_FILLS, ...BOLT_FILLS, ...GONE_FILLS, ...ZETA_FILLS]
  .sort((a, b) => a.executed_at.localeCompare(b.executed_at));
const OTHER_LOT = { date: preCut(40), shares: 1, cost: 9, ts: 99, src: 'other' };

/** The stored board, as an admin's page would have saved it after a sync. */
function board() {
  const acme = asLedger(ACME_FILLS), bolt = asLedger(BOLT_FILLS);
  return {
    positions: {
      GK: { label: 'GK', subtitle: 'Cash', role: 'GK', tickers: ['CASH'] }, CB1: { label: 'CB', subtitle: '', role: 'DEF', tickers: [] },
      CB2: { label: 'CB', subtitle: '', role: 'DEF', tickers: [] }, LB: { label: 'LB', subtitle: '', role: 'DEF', tickers: [] },
      RB: { label: 'RB', subtitle: '', role: 'DEF', tickers: [] }, CDM: { label: 'CDM', subtitle: '', role: 'MID', tickers: [] },
      CM: { label: 'CM', subtitle: '', role: 'MID', tickers: ['ACME', 'BOLT'] }, CAM: { label: 'CM', subtitle: '', role: 'MID', tickers: ['NOVA'] },
      LW: { label: 'LW', subtitle: '', role: 'FWD', tickers: [] }, ST: { label: 'ST', subtitle: '', role: 'FWD', tickers: ['BRIT.L'] },
      RW: { label: 'RW', subtitle: '', role: 'FWD', tickers: [] },
    },
    holdings: {
      CASH: { shares: 1, cost: 0, lastPrice: 40, dayPct: 0, isCash: true },
      ACME: { shares: net(ACME_FILLS) + 1, cost: 12, currency: 'USD', lastPrice: 26, prevClose: 25, dayPct: 4,
        t212Shares: net(ACME_FILLS), t212Cost: 12, lots: [...acme.lots, OTHER_LOT], sells: acme.sells },
      BOLT: { shares: net(BOLT_FILLS), cost: 3, currency: 'USD', lastPrice: 5, prevClose: 5.1, dayPct: -2,
        t212Shares: net(BOLT_FILLS), t212Cost: 3, ...bolt },
      // Not synced: a hand-kept holding keeps its rows.
      NOVA: { shares: 6, cost: 2, currency: 'USD', lastPrice: 3, prevClose: 2.9, dayPct: 3.4,
        lots: [{ date: preCut(300), shares: 4, cost: 1.5, ts: 1 }, { date: dayAgo(70), shares: 2, cost: 3, ts: 2 }] },
      'BRIT.L': { shares: 20, cost: 1, currency: 'GBP', lastPrice: 1.2, prevClose: 1.1, dayPct: 9,
        lots: [{ date: dayAgo(80), shares: 20, cost: 1 }] },
      GONE: { shares: 0, cost: 0, closed: true, currency: 'USD', lastPrice: 9, ...asLedger(GONE_FILLS) },
      ZETA: { shares: 0, cost: 0, closed: true, currency: 'USD', lastPrice: 6, t212Shares: 0, t212Cost: 0, t212PositionKey: 'LW', ...asLedger(ZETA_FILLS) },
    },
    snapshots: [], depositFxRates: { GBP: 1.3 },
  };
}
const ANSWER = {
  holdings: { ACME: { shares: net(ACME_FILLS), cost: 12 }, BOLT: { shares: net(BOLT_FILLS), cost: 3 }, GONE: { shares: 0, cost: 0 } },
  prices: { ACME: 26, GONE: 9 }, complete: true, updatedAt: new Date(NOW).toISOString(), source: 'cache',
};
const div = (id, ticker, paidOn, amount, extra = {}) => ({ id, account: 'invest', ticker, paid_on: paidOn, quantity: 2, amount, currency: 'USD',
  instrument_currency: 'USD', gross_per_share: 0.1, type: 'DIVIDEND', amount_holding: amount, holding_currency: 'USD', fx_rate: 1, fx_source: 'same', ...extra });
const DIVIDENDS = [
  div('d1', 'ACME', `${preCut(100)}T15:00:00+00:00`, 0.3), div('d2', 'ACME', `${dayAgo(30)}T15:00:00+00:00`, 0.1),
  div('d3', 'ACME', `${dayAgo(30)}T15:04:00+00:00`, 0.2), div('d4', 'BOLT', `${dayAgo(10)}T15:00:00+00:00`, 0.7),
  div('d5', 'GONE', `${dayAgo(60)}T15:00:00+00:00`, 0.4), div('d6', 'ACME', `${dayAgo(1)}T15:00:00+00:00`, 0.5, { amount_holding: null, fx_rate: null }),
];
const MARKET = { 'GBPUSD=X': { lastPrice: 1.25, prevClose: 1.25 } };

/** What the page draws from one book's answers: app.jsx's load, refresh and dividend steps, in its order. */
function pageBook({ data, answer, orders, dividends }) {
  const p = migrate(structuredClone(data));
  const holdings = { ...p.holdings };
  applyTrading212Answer(holdings, structuredClone(answer), orders, TODAY);
  applyFillLedgers(holdings, orders);
  const next = stripClosedFromPositions({ ...p, holdings });
  const divs = dividendEventsByTicker(dividends, withClosedFromFills(next.holdings, orders));
  return withDividendCosts(next, divs.byTicker);
}
function viewerAnswers(nowMs = NOW) {
  const data = board();
  const kept = ro.keptTickers(data);
  return {
    data: ro.roBoard(data, nowMs),
    answer: ro.roAnswer(ANSWER, kept),
    orders: ro.roOrders(ORDERS, kept, nowMs),
    dividends: ro.roDividends(DIVIDENDS, kept, nowMs),
  };
}
const ADMIN = () => pageBook({ data: board(), answer: ANSWER, orders: ORDERS, dividends: DIVIDENDS });

/** A daily close for every day from well before the cutoff to today: a different wave for each ticker. */
const HIST = Object.fromEntries(['ACME', 'BOLT', 'NOVA', 'BRIT.L'].map((t, k) => [t,
  Array.from({ length: 900 }, (_, i) => ({ date: dayAgo(899 - i), close: (k + 2) * (1 + 0.2 * Math.sin((i + 13 * k) / 9)) }))]));
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** The vs-S&P line's value and basis on every range, every day of it, both bases; and each holding's window move. */
function lineOf(book) {
  const out = [];
  for (const range of RANGE_KEYS) {
    const anchor = anchorDateFor(range, new Date(NOW));
    const ts = buildTickerSeries(HIST, anchor, range, {}, false, true);
    for (let d = Date.parse(`${anchor}T00:00:00Z`); d <= NOW; d += DAY) {
      for (const prevCloseBasis of [false, true]) {
        const { value, basis } = computeAt({
          date: iso(d), portfolio: book, tickerSeries: ts, marketData: MARKET, yearStart: anchor, yearStartDate: anchor,
          todayMs: NOW, liveAnchorDate: TODAY, useExt: false, fxToUSD, prevCloseBasis,
        });
        out.push([`${range} ${iso(d)} ${prevCloseBasis}`, value, basis]);
      }
    }
  }
  return out;
}
function moversOf(book) {
  const m = computeMetrics(book, { extended: false, marketData: MARKET });
  const out = [];
  for (const window of ['1W', '1M', '3M']) {
    const anchor = anchorDateFor(window, new Date(NOW));
    const ts = buildTickerSeries(HIST, anchor, window, {}, false, true);
    for (const pos of Object.values(m.positions)) for (const pl of pos.players) {
      if (pl.isCash) continue;
      const mv = holdingMoveOver(pl, { tickerSeries: ts, anchorDate: anchor, todayDate: TODAY, nowMs: NOW });
      out.push([`${window} ${pl.ticker}`, mv?.pct ?? null, mv?.usd ?? null]);
    }
  }
  return out;
}
const sameRows = (a, b) => a.length === b.length && a.every((r, i) => r[0] === b[i][0]
  && r.slice(1).every((v, j) => (v === null ? b[i][j + 1] === null : close(v, b[i][j + 1]))));

describe('the read-only book gives the page the same figures as the whole book', () => {
  it('sends less: no closed-for-good holding, its fills or dividends; fewer ledger rows; no snapshots or deposit rates', () => {
    const v = viewerAnswers();
    expect(Object.keys(v.data).sort()).toEqual(['holdings', 'positions']);
    expect(Object.keys(v.data.holdings).sort()).toEqual(['ACME', 'BOLT', 'BRIT.L', 'CASH', 'NOVA', 'ZETA']);
    expect(v.orders.some((o) => o.ticker === 'GONE')).toBe(false);
    expect(v.dividends.some((d) => d.ticker === 'GONE')).toBe(false);
    expect(v.orders.length).toBeLessThan(ORDERS.length - GONE_FILLS.length);
    expect(v.data.holdings.ACME.lots.length).toBeLessThan(board().holdings.ACME.lots.length);
    expect(v.orders.every((o) => o.executed_at.endsWith('T00:00:00Z'))).toBe(true);
    // Both pages did rebuild the synced ledgers from the fills (the comparisons below are about that rebuild too): the
    // whole book's ACME is its fills' buys and the row kept elsewhere; the viewer's is the folded few.
    const acmeBuys = ACME_FILLS.filter((o) => o.side === 'buy').length;
    expect(ADMIN().holdings.ACME.lots.length).toBe(acmeBuys + 1);
    expect(pageBook(viewerAnswers()).holdings.ACME.lots.length).toBeLessThan(acmeBuys);
  });

  it('the scoreboard and every card: value, day change, gain, shares and the average cost net of dividends', () => {
    const admin = computeMetrics(ADMIN(), { extended: false, marketData: MARKET });
    const viewer = computeMetrics(pageBook(viewerAnswers()), { extended: false, marketData: MARKET });
    for (const k of ['marketValue', 'dayChange', 'unrlGL', 'unrlPct', 'investedCost', 'tickerCount']) expect(close(viewer[k], admin[k]), k).toBe(true);
    const cards = (m) => Object.entries(m.positions).flatMap(([pos, p]) => p.players.map((pl) =>
      [`${pos} ${pl.ticker}`, pl.shares, pl.cost, pl.marketValue, pl.dayChange, pl.unrlGL ?? null, pl.dividendsReceived ?? null]));
    expect(sameRows(cards(viewer), cards(admin)), JSON.stringify([cards(viewer), cards(admin)])).toBe(true);
    // ACME's dividends do come off its cost (not a vacuous pass), and ZETA, closed, is back on its slot on neither.
    expect(cards(admin).find((r) => r[0] === 'CM ACME')[6]).toBeGreaterThan(0);
  });

  it('the vs-S&P line, every range, every day, both bases; and Top Movers over 1W, 1M and 3M', () => {
    const admin = lineOf(ADMIN()), viewer = lineOf(pageBook(viewerAnswers()));
    expect(admin.length).toBeGreaterThan(400);
    expect(sameRows(viewer, admin), JSON.stringify(viewer.find((r, i) => !sameRows([r], [admin[i]])))).toBe(true);
    expect(sameRows(moversOf(pageBook(viewerAnswers())), moversOf(ADMIN()))).toBe(true);
  });

  it('a fold that reached into a window would show: the comparison has teeth', () => {
    // Folded as if it were 400 days later, every row here is "before the cutoff", the windows' own buys among them.
    const late = lineOf(pageBook(viewerAnswers(NOW + 400 * DAY)));
    expect(sameRows(late, lineOf(ADMIN()))).toBe(false);
  });
});

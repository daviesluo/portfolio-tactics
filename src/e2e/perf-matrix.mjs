// Browser matrix against the PRODUCTION bundle.
//
// Serves the built site exactly as Cloudflare Pages does (index.html +
// the committed hashed assets, no dev server, no source transform),
// intercepts every network call with fixtures whose right answer is
// arithmetic, and reads the numbers back out of the DOM.
//
// The fixture is deliberately tiny so every expected figure can be done
// on paper (three books: buys-only, sold-down and rotated, below):
//
//   ACME  [•] shares, bought [•]-[•]-[•] at $[•]
//   CASH  $[•]
//
//   window bars   [•] -> [•] -> [•]
//   value         [•] -> [•] -> [•]     ([•] x price + [•] cash)
//   deposited     [•] flat                ([•] x [•] + [•] cash)
//   value move    ([•]-[•])/[•] = +[•]%
//   deposit move  +[•]%
//   ^GSPC bars    [•] -> [•] -> [•]  ->  +[•]% over the window
//   portfolio %   value/basis where basis is the Jan-[•] close [•]:
//                 ([•]-[•])/[•] = +[•]%, rebased from its own first
//                 point which is already [•].
//
// 24H with extended hours off is the exception (Davies, [•]-[•]-[•]): the
// latest session, measured from its previous close on both lines, with
// nothing rebased. ACME's previous close is [•] and the S&P's [•]:
//
//   book at the previous close   [•] x [•] + [•] = [•]
//   portfolio %   ([•]-[•])/[•] = +[•]%   (= the scoreboard's DAY CHANGE)
//   first point   ([•]-[•])/[•] = -[•]%   (the gap from the close to [•]:[•])
//   S&P %         ([•]-[•])/[•] = +[•]%   (= the Market Conditions card)
//   S&P first     ([•]-[•])/[•] = -[•]%
//   sold-down     [•] x [•] + [•] = [•]:  ([•]-[•])/[•] = +[•]%,
//                 first ([•]-[•])/[•] = -[•]%
//
// A second matrix below (SESSIONS) drives the same window at four instants
// — before the open, in the session, after the close, a weekend — with
// extended hours off and on, on both tabs.
//
// A hard gate since [•]-[•]-[•] (bin/gates.sh's; on GitHub too until CI-TRIM, [•]-[•]-[•]). Its clock is
// pinned below, so it gives the same answer at any hour, and it refuses an
// instant its fixture cannot serve. Run it from src/ after a chart change:
//
//   npm run build && npm run verify:perf
//
// Usage: node e2e/perf-matrix.mjs [path to dist/]; the default is the
// repository's dist/. Chromium is Playwright's full one, or the one
// PLAYWRIGHT_CHROMIUM_PATH names, as in app-sweep.mjs (e2e/browser.mjs).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { launchOptions } from './browser.mjs';

// ---- the clock ------------------------------------------------------
//
// The app reads the clock (the market phase decides where a window starts
// and which bars count), so a matrix on the real clock can pass at one
// hour and fail at another. The instant is pinned in BOTH places that read
// a clock, as in app-sweep.mjs: the fixture's bar dates (here, in Node)
// and the page's own `Date` (`page.clock.setFixedTime`). They must be the
// same instant, or the app reasons about bars from another day.
// PERF_MATRIX_CLOCK (any instant `Date` parses) moves it to probe an hour.
const CLOCK = new Date(process.env.PERF_MATRIX_CLOCK || '2026-09-17T23:00:00Z');
const NOW_MS = CLOCK.getTime();
if (!Number.isFinite(NOW_MS)) throw new Error(`PERF_MATRIX_CLOCK is not a date: ${process.env.PERF_MATRIX_CLOCK}`);

// Absolute, always: the path-traversal guard below compares the resolved
// file against ROOT with `startsWith`.
const ROOT = path.resolve(
  process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'dist'));
// `PERF_PORT=0` serves on a port the system has free, read back once the server listens: bin/gates.sh asks for one, so
// two gate runs on one machine never ask for the same port (the fixed 8931 collided). Unset, 8931, as CI runs it.
let PORT = process.env.PERF_PORT === '0' ? 0 : Number(process.env.PERF_PORT) || 8931;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',   // the site's own fonts since 2026-10-08, as Cloudflare types them
  '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let file = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(ROOT, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

// ---- fixture -------------------------------------------------------

const YEAR = CLOCK.getUTCFullYear();
// Daily bars, placed relative to today so they land inside EVERY range's
// window — a fixed Jan/Mar/Jun triple falls outside 3M and draws the
// empty state, which is a fixture bug, not an app one.
const dayAgo = (n) => new Date(NOW_MS - n * 86400_000).toISOString().slice(0, 10);
const D = (m, d) => `${YEAR}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// CASH sits in GK alone, as on the real board. The app lays its default
// positions under a loaded book, and their GK already holds CASH, so a book
// that also put CASH under ST had it twice on the scoreboard ($[•] where
// the chart's value read $[•]) and once in the chart: a fixture describing
// a board no one can make, found when the scoreboard joined this matrix.
const PORTFOLIO = {
  positions: {
    GK: { label: 'Keeper', subtitle: '', role: 'GK', tickers: ['CASH'] },
    ST: { label: 'Striker', subtitle: '', role: 'FWD', tickers: ['ACME'] },
  },
  holdings: {
    ACME: {
      shares: 10, cost: 200, lastPrice: 240, prevClose: 220, dayPct: 9.09,
      currency: 'USD', lots: [{ date: D(1, 2), shares: 10, cost: 200 }],
    },
    CASH: { shares: 1, cost: 0, lastPrice: 500, dayPct: 0, isCash: true },
  },
  depositFxRates: { USD: 1 },
};

// The same book after a sale, to exercise the half of `computeAt` the
// original fixture never reaches. The ledger is the broker's executed
// fills now, so a position sold down is the ordinary case rather than
// an edge one — and until this the matrix only ever proved that buys
// still worked.
//
// The sale is dated before EVERY window opens, deliberately: a sale
// inside the window prices its basis at the proceeds and one outside it
// at the anchor, so putting it outside keeps a single expected figure
// across all five ranges instead of one per range.
//
//   ACME   10 bought at 200, 4 sold at 230 -> 6 held
//   value  6 x 240 + 500 cash = 1940
//   basis  6 x 200 + 500 cash = 1700   (both sides at the window anchor)
//   move   (1940-1700)/1700 = +14.12%
const PORTFOLIO_SOLD = {
  ...PORTFOLIO,
  holdings: {
    ...PORTFOLIO.holdings,
    ACME: {
      shares: 6, cost: 180, lastPrice: 240, prevClose: 220, dayPct: 9.09,
      currency: 'USD',
      lots: [{ date: D(1, 2), shares: 10, cost: 200 }],
      sells: [{ date: D(2, 1), shares: 4, price: 230 }],
    },
  },
};

// The buys-only book reached by a ROTATION (Davies, [•]-[•]-[•]: a switch read as new money): OLD, bought on [•] January
// and sold out in full ten days ago (closed, on no position, its ledger kept), paid for ACME's ten shares the same day.
// The line counts OLD until its sale (`bookScope`, ytd.js), so every figure is the buys-only book's:
//
//   OLD    [•] bought at [•] on [•] Jan, all [•] sold at [•] ten days ago ([•]); bars as ACME's, [•] -> [•] -> [•]
//   ACME   [•] bought at [•] ten days ago with that [•]
//   value  YTD [•] (OLD [•] x [•] + [•]) -> [•] -> [•] (ACME [•] x [•] + [•]): +[•]%
//   basis  YTD  OLD at its window-start close [•] then its [•] out and ACME's [•] in: [•] throughout
//          1D-[•] every bar here is in the latest session, after the rotation: OLD nets to nothing and ACME's lot
//          is before the first point, valued at the anchor, as buys-only
//   deposited  [•] + [•] cash, then [•] - [•] + [•] + [•]: [•] flat, +[•]%
//
// Leaving OLD out (until [•]-[•]-[•]) read YTD's value +[•]% and Deposited +[•]% ([•] -> [•] not flat) and its
// vs-S&P line +[•]%: [•] failures, the YTD cases of this book at each data state, measured on the old code.
const PORTFOLIO_ROTATED = {
  ...PORTFOLIO,
  holdings: {
    ...PORTFOLIO.holdings,
    ACME: { ...PORTFOLIO.holdings.ACME, cost: 240, lots: [{ date: dayAgo(10), shares: 10, cost: 240 }] },
    OLD: {
      shares: 0, cost: 0, lastPrice: 240, currency: 'USD', closed: true,
      lots: [{ date: D(1, 2), shares: 10, cost: 150 }],
      sells: [{ date: dayAgo(10), shares: 10, price: 240 }],
    },
  },
};

// Which book the fixture server hands out, and what it should read.
// `day` / `dayFirst`: 24H with extended hours off, from the previous close
// (the header's arithmetic).
const BOOKS = [
  { name: 'buys-only', portfolio: PORTFOLIO, move: '+16.00%', day: '+7.41%', dayFirst: -7.41 },
  { name: 'sold-down', portfolio: PORTFOLIO_SOLD, move: '+14.12%', day: '+6.59%', dayFirst: -6.59 },
  { name: 'rotated', portfolio: PORTFOLIO_ROTATED, move: '+16.00%', day: '+7.41%', dayFirst: -7.41 },
];
const DAY_SP = '+0.97%';
const DAY_SP_FIRST = -2.91;
let book = BOOKS[0];

// Daily bars for the daily ranges, intraday for the short ones. Both
// end at 240 so the live right edge and the last bar agree.
const dailyBars = (t) => {
  const closes = t === '^GSPC' ? [5000, 5100, 5200] : [200, 220, 240];
  return [
    { date: dayAgo(60), close: closes[0] },
    { date: dayAgo(30), close: closes[1] },
    { date: dayAgo(1), close: closes[2] },
  ];
};

// Intraday bars land inside the most recent US cash session (13:30-20:00
// UTC), because the ^GSPC series is clipped to regular hours — bars
// outside it are dropped and the benchmark falls back to another ticker.
const intradayBars = (t) => {
  const closes = t === '^GSPC' ? [5000, 5100, 5200] : [200, 220, 240];
  const now = new Date(NOW_MS);
  const session = new Date(now);
  const past2000 = now.getUTCHours() >= 20;
  if (!past2000) session.setUTCDate(session.getUTCDate() - 1);
  const at = (hh, mm) => {
    const d = new Date(session);
    d.setUTCHours(hh, mm, 0, 0);
    return d.toISOString().slice(0, 16);
  };
  return [
    { date: at(14, 0), close: closes[0] },
    { date: at(17, 0), close: closes[1] },
    { date: at(19, 55), close: closes[2] },
  ];
};

// ---- where the fixture holds ------------------------------------------
//
// The expected figures hold only where the bars above land the way they
// were written to. Probed at 21 pinned instants on 2026-09-23: every
// failure this matrix ever reported sits in one of the cases below, and in
// each the app was right about the data it was given.
//   - (Until 2026-10-07.) After 14:00 and up to 17:00 UTC the trailing-24 h
//     window kept two of the previous session's three bars, so 24H read
//     +7.41 % — the 18 failures this harness reported for months. 24H with
//     extended hours off is now the whole latest session, so that hour is
//     no longer refused: probed at 15:00 UTC, all green.
//   - A session day on a weekend: the 3M grid samples weekdays only, so 3M
//     draws flat or empty.
//   - London off British Summer Time: the 3M grid's 17:00 London slot is
//     17:00 UTC, the second bar's own time, so 3M starts a bar late.
//   - Within 60 days of the sold-down book's 1 February sale: the sale
//     falls inside the drawn series and that book's figures move.
// An instant in any of them is refused rather than run, so a failure here
// is always the app's.
const zoneName = (tz, at, locale) => new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'short' })
  .formatToParts(at).find((p) => p.type === 'timeZoneName')?.value;

function fixtureProblem(at) {
  const session = new Date(at);
  if (at.getUTCHours() < 20) session.setUTCDate(session.getUTCDate() - 1);
  if (session.getUTCDay() === 0 || session.getUTCDay() === 6) {
    return `the fixture's session day (${session.toISOString().slice(0, 10)}) is a weekend, which the 3M grid skips`;
  }
  if (zoneName('Europe/London', session, 'en-GB') !== 'BST') {
    return 'London is not on British Summer Time, so the 3M grid samples the second bar instead of the first';
  }
  if (dayAgo(60) <= D(2, 1)) {
    return "the sold-down book's 1 February sale falls inside the drawn series";
  }
  return null;
}

const QUOTES = {
  ACME: { lastPrice: 240, prevClose: 220, currency: 'USD', dayPct: 9.09 },
  '^GSPC': { lastPrice: 5200, prevClose: 5150, currency: 'USD', dayPct: 0.97 },
};

// A fake but well-formed app token: the client only DECODES it (the
// signature is checked server-side, and every server call here is
// intercepted).
const b64url = (s) => Buffer.from(s).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const TOKEN = `${b64url(JSON.stringify({ role: 'admin', exp: NOW_MS + 3600_000 }))}.sig`;

// ---- reading the page -------------------------------------------------

/**
 * What the performance panel in the left column shows, read off the DOM,
 * with each line's points turned back into the panel's own units by
 * inverting the y axis from two of its printed tick labels; and the
 * header's DAY CHANGE % and the S&P card's %, the two figures the 24H
 * window with extended hours off must end on. Runs in the page.
 */
function readPanel() {
  const panel = document.querySelector('.left-col .panel');
  if (!panel) return null;
  const svg = panel.querySelector('svg');
  const txt = (/** @type {Element | null | undefined} */ e) => (e?.textContent || '').replace(/\s+/g, ' ').trim();
  const ticks = [...(svg?.querySelectorAll('text') || [])]
    .filter((e) => /^[+-]?\d+(\.\d+)?%$/.test(txt(e)))
    .map((e) => ({ v: parseFloat(txt(e)), y: Number(e.getAttribute('y')) }));
  const toPct = (/** @type {number} */ y) => {
    if (ticks.length < 2) return null;
    const a = ticks[0], b = ticks[ticks.length - 1];
    return a.v + ((y - a.y) * (b.v - a.v)) / (b.y - a.y);
  };
  const paths = [...panel.querySelectorAll('svg path[d^="M"]')].map((p) => {
    const d = p.getAttribute('d') || '';
    const ys = d.replace('M', '').split('L').map((seg) => Number(seg.split(',')[1]));
    return {
      d,
      dash: p.getAttribute('stroke-dasharray'),
      opacity: p.getAttribute('opacity'),
      points: d.split('L').length,
      pcts: ys.map((y) => { const v = toPct(y); return v == null ? null : Math.round(v * 100) / 100; }),
    };
  });
  let dayChange = null;
  for (const c of document.querySelectorAll('.scoreboard-cell')) {
    if (txt(c.querySelector('.sb-label')) === 'DAY CHANGE') dayChange = txt(c.querySelector('.sb-pct'));
  }
  const card = [...document.querySelectorAll('.mc-card')]
    .find((c) => /^(\^GSPC|ES=F)$/.test(txt(c.querySelector('.mc-card-ticker'))));
  const footer = card ? [...card.querySelectorAll('.mc-footer span')] : [];
  return {
    tabOn: panel.querySelector('.view-tab.is-on')?.textContent || '',
    range: panel.querySelector('.perf-range-btn.on')?.getAttribute('data-range') || '',
    empty: !!panel.querySelector('.sparkline-empty'),
    labels: [...panel.querySelectorAll('.perf-lbl')].map((e) => e.textContent),
    values: [...panel.querySelectorAll('.perf-val')].map((e) => e.textContent),
    ticks: [...(svg?.querySelectorAll('text') || [])].map((e) => e.textContent),
    paths,
    dayChange,
    mcTicker: card ? txt(card.querySelector('.mc-card-ticker')) : null,
    mcSp: footer.length > 1 ? txt(footer[1]) : null,
  };
}

/**
 * The page's requests off this server not yet answered (the mocked Edge Functions, anything aborted), for
 * `settledPanel`: a panel drawn from what it had, with a fetch still out, is not yet what it will show.
 * @param {import('playwright').Page} page
 */
function trackInflight(page) {
  /** @type {Set<import('playwright').Request>} */
  const inflight = new Set();
  page.on('request', (r) => { if (!r.url().startsWith(`http://localhost:${PORT}`)) inflight.add(r); });
  page.on('requestfinished', (r) => inflight.delete(r));
  page.on('requestfailed', (r) => inflight.delete(r));
  return inflight;
}

/**
 * Reads the panel until `ready` accepts it, drawn, and it has stood still for 150 ms with nothing in flight, or `ms`
 * runs out; the last read either way, for the checks to fail on. It replaces the fixed sleeps after each click (review
 * F13, 2026-10-08: 400 ms after every range click, 60 times a run, too long on a fast machine and a guess on a loaded
 * one).
 * @param {import('playwright').Page} page @param {Set<unknown>} inflight @param {(r: any) => boolean} ready
 */
async function settledPanel(page, inflight, ready, ms = 8000) {
  const by = Date.now() + ms;
  let key = '', since = Date.now();
  for (;;) {
    const r = await page.evaluate(readPanel);
    const k = JSON.stringify(r);
    if (k !== key || inflight.size > 0) { key = k; since = Date.now(); }
    if (r && !r.empty && ready(r) && Date.now() - since >= 150) return r;
    if (Date.now() >= by) return r;
    await page.waitForTimeout(25);
  }
}

/** "(+7.41%)" or "+7.41%" → "+7.41%", for comparing the header's figures with the legend's. */
const pctOf = (/** @type {string | null | undefined} */ s) => (s || '').replace(/[()\s]/g, '');
/** A point read back off the axis, against a hand-worked figure: within 0.05 of a percent. */
const near = (/** @type {number | null | undefined} */ got, /** @type {number} */ want) =>
  typeof got === 'number' && Math.abs(got - want) <= 0.05;

// ---- run -----------------------------------------------------------

const RANGES = ['1D', '1W', '1M', '3M', 'YTD'];

/** @param {'none'|'sparse'|'full'} snapshotMode */
function snapshotRows(mode) {
  if (mode === 'none') return [];
  const now = NOW_MS;
  const rows = [];
  const n = mode === 'sparse' ? 2 : 24;
  for (let i = n; i >= 1; i--) {
    rows.push({
      ts: new Date(now - i * 5 * 60_000).toISOString(),
      prices: { ACME: 240 },
    });
  }
  return rows;
}

// ---- the 24H window at four instants ------------------------------------
//
// Davies ([•]-[•]-[•]): with extended hours off, 24H showed only the regular
// session rebased to [•] % at the open, losing the move from the previous
// close, and in the session it did not read what the scoreboard did. Now it
// is the latest session measured from its previous close, and its ends are
// the header's DAY CHANGE and the S&P card. This matrix drives that window
// before the open, in the session, after the close and at a weekend, with
// extended hours off and on, on both tabs, each at its own pinned instant,
// and reads the chart, the header and the card off the page.
//
// The book: ACME [•] shares, $[•] cash. Four bars a session at [•]:[•] [•]:[•]
// [•]:[•] and [•]:[•] UTC:
//
//   Wed [•] Sep   ACME [•] [•] [•] [•]    ^GSPC [•] [•] [•] [•]
//   Thu [•] Sep   ACME [•] [•] [•] [•]    ^GSPC [•] [•] [•] [•]
//   Fri [•] Sep   ACME [•] [•] [•] [•]    ^GSPC [•] [•] [•] [•]
//
// Extended hours off, worked by hand (value = [•] x ACME + [•]):
//
//   before the open, Fri [•]:[•] UTC: Thursday's session against Wednesday's close (ACME [•] S&P [•]).
//     basis [•] x [•] + [•] = [•]. Open [•]: +[•] %. End at the live price [•] [•]: +[•] %.
//     S&P open ([•]-[•])/[•] = +[•] %; end at the card's [•]: +[•] %.
//   in the session, Thu [•]:[•] UTC: Thursday so far, a [•]:[•] bar (ACME [•] S&P [•]) in progress,
//     ACME live at [•] and the S&P card at [•]. Open +[•] %; the book's own point at [•]:[•]
//     [•]: +[•] %. S&P open +[•] %, end ([•]-[•])/[•] = +[•] %.
//   after the close, Thu [•]:[•] UTC: Thursday whole: +[•] % -> +[•] %; S&P +[•] % -> +[•] %.
//   a Saturday, [•]:[•] UTC: Friday's whole session against Thursday's close (ACME [•] S&P [•]),
//     though only its last two bars are inside a trailing [•] h. basis [•]. Open [•]: -[•] %;
//     end [•]: -[•] %. S&P open ([•]-[•])/[•] = -[•] %, end at the card's [•]: -[•] %.
//
// INVESTMENT's VALUE reads the same figure as the portfolio line; DEPOSITED +[•] %.
//
// Extended hours on is unchanged: the trailing [•] h of the futures ([•] -> [•] -> [•] so the
// S&P reads +[•] %), both lines from [•] % at the first point. Its portfolio figure is the existing
// rule worked by hand: the rebased move (V_end - V_first) / B, where B values each pre-window lot at
// ACME's last bar before the UTC day of the futures' last bar (`buildTickerSeries`), or its first
// bar inside the window when there is none; INVESTMENT reads (V_end - V_first) / V_first:
//
//   before the open: B = [•] x [•] + [•] = [•] V_first [•] (Thu [•]:[•] ACME's first bar [•]
//     carried back), V_end [•]  ->  vs-S&P +[•] %, INVESTMENT +[•] %. The two tabs differ here
//     with extended hours on: the window crosses midnight UTC and B is not the first point's value.
//     That was so before this change and is reported, not changed, by it.
//   in the session: B = [•] (Wed [•]:[•] [•]), V_first [•] V_end [•] (live [•]) -> +[•] % both.
//   after the close: B = V_first = [•] (Thu [•]:[•] [•]), V_end [•] -> +[•] % both.
//   a Saturday: B = V_first = [•] (Fri [•]:[•] [•]), V_end [•] -> +[•] % both.
const S_TIMES = ['13:30', '15:00', '17:00', '19:55'];
const S_DAYS = {
  '2026-09-16': { ACME: [190, 195, 205, 210], '^GSPC': [4950, 4980, 5010, 5050] },
  '2026-09-17': { ACME: [220, 215, 225, 230], '^GSPC': [5080, 5060, 5100, 5120] },
  '2026-09-18': { ACME: [226, 228, 222, 224], '^GSPC': [5110, 5130, 5090, 5100] },
};
const SESSIONS = [
  {
    name: 'pre-market', clock: '2026-09-18T12:00:00Z',
    quotes: { ACME: [230, 210], '^GSPC': [5120, 5050] },
    es: [['2026-09-17T13:00', 5000], ['2026-09-18T06:00', 5050], ['2026-09-18T11:45', 5100]],
    off: { port: '+7.69%', portFirst: 3.85, portPts: 4, sp: '+1.39%', spFirst: 0.59, spPts: 4 },
    on: { port: '+3.57%', inv: '+3.70%' },
  },
  {
    name: 'in-session', clock: '2026-09-17T17:30:00Z',
    quotes: { ACME: [228, 210], '^GSPC': [5105, 5050] },
    extra: { ACME: [['2026-09-17T17:25', 227]], '^GSPC': [['2026-09-17T17:25', 5102]] },
    es: [['2026-09-16T18:30', 5000], ['2026-09-17T11:30', 5050], ['2026-09-17T17:15', 5100]],
    off: { port: '+6.92%', portFirst: 3.85, portPts: 5, sp: '+1.09%', spFirst: 0.59, spPts: 4 },
    on: { port: '+6.92%', inv: '+6.92%' },
  },
  {
    name: 'after-close', clock: '2026-09-17T23:00:00Z',
    quotes: { ACME: [230, 210], '^GSPC': [5120, 5050] },
    es: [['2026-09-17T00:00', 5000], ['2026-09-17T17:00', 5050], ['2026-09-17T22:45', 5100]],
    off: { port: '+7.69%', portFirst: 3.85, portPts: 4, sp: '+1.39%', spFirst: 0.59, spPts: 4 },
    on: { port: '+3.70%', inv: '+3.70%' },
  },
  {
    name: 'weekend', clock: '2026-09-19T16:30:00Z',
    quotes: { ACME: [224, 230], '^GSPC': [5100, 5120] },
    es: [['2026-09-18T17:00', 5000], ['2026-09-18T19:00', 5050], ['2026-09-18T20:55', 5100]],
    off: { port: '-2.14%', portFirst: -1.43, portPts: 4, sp: '-0.39%', spFirst: -0.20, spPts: 4 },
    on: { port: '+0.74%', inv: '+0.74%' },
  },
];

/** The session fixture's intraday bars for one symbol, as they stood at `nowKey` (UTC minute). */
function sessionBars(st, sym, nowKey) {
  if (sym === 'ES=F') return st.es.map(([date, close]) => ({ date, close }));
  const out = [];
  for (const [day, row] of Object.entries(S_DAYS)) {
    if (!row[sym]) continue;
    S_TIMES.forEach((t, i) => out.push({ date: `${day}T${t}`, close: row[sym][i] }));
  }
  for (const [date, close] of (st.extra?.[sym] || [])) out.push({ date, close });
  return out.filter((b) => b.date <= nowKey).sort((a, b) => a.date.localeCompare(b.date));
}

/** @param {any} st */
function sessionBook(st) {
  const [last, prev] = st.quotes.ACME;
  return {
    positions: {
      GK: { label: 'Keeper', subtitle: '', role: 'GK', tickers: ['CASH'] },
      ST: { label: 'Striker', subtitle: '', role: 'FWD', tickers: ['ACME'] },
    },
    holdings: {
      ACME: {
        shares: 10, cost: 150, lastPrice: last, prevClose: prev, dayPct: ((last - prev) / prev) * 100,
        currency: 'USD', lots: [{ date: '2026-01-02', shares: 10, cost: 150 }],
      },
      CASH: { shares: 1, cost: 0, lastPrice: 500, dayPct: 0, isCash: true },
    },
    depositFxRates: { USD: 1 },
  };
}

/** @param {import('playwright').Browser} browser */
async function runSessions(browser) {
  const rows = [];
  let failures = 0;
  for (const st of SESSIONS) {
    const clock = new Date(st.clock);
    const nowKey = clock.toISOString().slice(0, 16);
    const book = sessionBook(st);
    const [spLast, spPrev] = st.quotes['^GSPC'];
    const quotes = {
      ACME: { lastPrice: st.quotes.ACME[0], prevClose: st.quotes.ACME[1], currency: 'USD', dayPct: book.holdings.ACME.dayPct },
      '^GSPC': { lastPrice: spLast, prevClose: spPrev, currency: 'USD', dayPct: ((spLast - spPrev) / spPrev) * 100 },
      'ES=F': { lastPrice: 5100, prevClose: 5000, currency: 'USD', dayPct: 2 },
    };
    const token = `${b64url(JSON.stringify({ role: 'admin', exp: clock.getTime() + 3600_000 }))}.sig`;
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    await ctx.addInitScript(([t]) => { sessionStorage.setItem('dp.token', t); }, [token]);
    const page = await ctx.newPage();
    const inflight = trackInflight(page);
    await page.clock.setFixedTime(clock);
    await page.route('**/functions/v1/**', async (route) => {
      const url = route.request().url();
      const json = (body) => route.fulfill({
        status: 200, contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body),
      });
      if (url.includes('/data?') && url.includes('action=load')) return json({ data: book, version: 1 });
      if (url.includes('action=price-snapshots')) return json({ rows: [] });
      if (url.includes('/data?')) return json({ ok: true, version: 2 });
      if (url.includes('/chart?')) {
        const u = new URL(url);
        const tickers = (u.searchParams.get('tickers') || '').split(',').filter(Boolean);
        const daily = /^\d+(d|wk|mo)$/.test(u.searchParams.get('interval') || '1d');
        const out = {};
        for (const t of tickers) {
          out[t] = daily
            ? [{ date: '2026-06-01', close: t === 'ACME' ? 200 : 5000 }, { date: '2026-09-16', close: t === 'ACME' ? 210 : 5050 }]
            : sessionBars(st, t, nowKey);
        }
        return json(out);
      }
      if (url.includes('/prices?')) {
        const u = new URL(url);
        const out = {};
        for (const t of (u.searchParams.get('tickers') || '').split(',')) if (quotes[t]) out[t] = quotes[t];
        return json(out);
      }
      if (url.includes('/trading212')) return json({ source: 'disabled' });
      if (url.includes('/ops-error')) return json({ ok: true });
      return json({});
    });
    await page.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(`http://localhost:${PORT}`)) return route.continue();
      if (u.includes('/functions/v1/')) return route.fallback();
      return route.abort();
    });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.left-col .perf-chart-wrap svg', { timeout: 20_000 });

    /** Read the panel until `ready` accepts it and it is still (`settledPanel`), or 8 s; the last read either way. */
    const settle = (/** @type {(r: any) => boolean} */ ready) => settledPanel(page, inflight, ready);
    for (const ext of [false, true]) {
      if (ext) {
        await page.locator('.ext-switch:visible').first().click();
        await page.waitForFunction(() => [...document.querySelectorAll('.ext-switch .ext-checkbox')].every((i) => /** @type {HTMLInputElement} */ (i).checked), null, { timeout: 5_000 }).catch(() => {});
      }
      for (const view of ['sp', 'investment']) {
        await page.click(view === 'sp' ? '.left-col #perf-tab-sp' : '.left-col #perf-tab-inv');
        const r = await settle((x) => (view === 'investment'
          ? x.labels?.[0] === 'VALUE'
          : x.labels?.[1] === (ext ? 'S&P 500 FUTURES' : 'S&P 500')));
        const tag = `${st.name}/${ext ? 'ext on' : 'ext off'}/${view === 'sp' ? 'vs S&P' : 'INVESTMENT'}`;
        rows.push({ tag, r });
        const fail = (msg) => { failures++; console.log(`  FAIL [24H ${tag}] ${msg}`); };
        if (!r) { fail('panel missing'); continue; }
        if (r.empty) { fail('drew the empty state'); continue; }
        const [lineB, lineA] = r.paths;
        if (view === 'investment') {
          const want = ext ? st.on.inv : st.off.port;
          if (r.values[0] !== want) fail(`VALUE ${r.values[0]} (want ${want})`);
          if (r.values[1] !== '+0.00%') fail(`DEPOSITED ${r.values[1]} (want +0.00%)`);
          if (!ext && pctOf(r.dayChange) !== r.values[0]) fail(`VALUE ${r.values[0]} but DAY CHANGE ${r.dayChange}`);
        } else if (!ext) {
          if (r.values[0] !== st.off.port) fail(`portfolio ${r.values[0]} (want ${st.off.port})`);
          if (r.values[1] !== st.off.sp) fail(`S&P ${r.values[1]} (want ${st.off.sp})`);
          if (pctOf(r.dayChange) !== r.values[0]) fail(`portfolio ${r.values[0]} but DAY CHANGE ${r.dayChange}`);
          if (r.mcTicker !== '^GSPC' || pctOf(r.mcSp) !== r.values[1]) fail(`S&P ${r.values[1]} but the card (${r.mcTicker}) ${r.mcSp}`);
          if (!near(lineA?.pcts?.[0], st.off.portFirst)) fail(`portfolio's first point ${lineA?.pcts?.[0]} (want ${st.off.portFirst})`);
          if (!near(lineB?.pcts?.[0], st.off.spFirst)) fail(`S&P's first point ${lineB?.pcts?.[0]} (want ${st.off.spFirst})`);
          if (lineA?.points !== st.off.portPts) fail(`portfolio has ${lineA?.points} points (want ${st.off.portPts})`);
          if (lineB?.points !== st.off.spPts) fail(`S&P has ${lineB?.points} points (want ${st.off.spPts})`);
        } else {
          if (r.values[0] !== st.on.port) fail(`portfolio ${r.values[0]} (want ${st.on.port})`);
          if (r.values[1] !== '+2.00%') fail(`S&P futures ${r.values[1]} (want +2.00%)`);
          if (!near(lineA?.pcts?.[0], 0) || !near(lineB?.pcts?.[0], 0)) {
            fail(`not both from 0 %: portfolio ${lineA?.pcts?.[0]}, S&P ${lineB?.pcts?.[0]}`);
          }
        }
      }
    }
    await ctx.close();
  }
  console.log('\n=== 24H: extended hours off / on x pre-market / in session / after close / weekend x both tabs ===');
  for (const { tag, r } of rows) {
    const [lineB, lineA] = r?.paths || [];
    console.log(`${tag.padEnd(36)} legend=${(r?.values || []).join(' / ').padEnd(18)}`
      + ` first=${lineA?.pcts?.[0] ?? '-'} / ${lineB?.pcts?.[0] ?? '-'} pts=${lineA?.points ?? 0}/${lineB?.points ?? 0}`
      + ` DAY CHANGE=${r?.dayChange ?? '-'} card ${r?.mcTicker ?? '-'}=${r?.mcSp ?? '-'}`);
  }
  return { failures, cases: rows.length };
}

async function run() {
  const problem = fixtureProblem(CLOCK);
  if (problem) {
    console.error(`Refusing ${CLOCK.toISOString()}: ${problem}. Pick another instant.`);
    process.exit(2);
  }
  await new Promise((r) => server.listen(PORT, r));
  PORT = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  const browser = await chromium.launch(launchOptions());
  const results = [];
  let failures = 0;

  for (const bk of BOOKS) {
  book = bk;
  for (const snapshotMode of ['none', 'sparse', 'full']) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    await ctx.addInitScript(([token]) => {
      sessionStorage.setItem('dp.token', token);
    }, [TOKEN]);
    const page = await ctx.newPage();
    const inflight = trackInflight(page);
    // Timers still run, so refreshes and polls behave normally; only
    // "what time is it" is fixed.
    await page.clock.setFixedTime(CLOCK);

    await page.route('**/functions/v1/**', async (route) => {
      const url = route.request().url();
      const json = (body) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(body),
      });
      if (url.includes('/data?') && url.includes('action=load')) {
        return json({ data: book.portfolio, version: 1 });
      }
      if (url.includes('action=price-snapshots')) {
        return json({ rows: snapshotRows(snapshotMode) });
      }
      if (url.includes('/data?')) return json({ ok: true, version: 2 });
      if (url.includes('/chart?')) {
        const u = new URL(url);
        const tickers = (u.searchParams.get('tickers') || '').split(',').filter(Boolean);
        const interval = u.searchParams.get('interval') || '1d';
        const daily = /^\d+(d|wk|mo)$/.test(interval);
        const out = {};
        for (const t of tickers) out[t] = daily ? dailyBars(t) : intradayBars(t);
        return json(out);
      }
      if (url.includes('/prices?')) {
        const u = new URL(url);
        const tickers = (u.searchParams.get('tickers') || '').split(',').filter(Boolean);
        const out = {};
        for (const t of tickers) if (QUOTES[t]) out[t] = QUOTES[t];
        return json(out);
      }
      if (url.includes('/trading212')) return json({ source: 'disabled' });
      if (url.includes('/fundamentals')) return json({});
      if (url.includes('/overnight-fetch')) return json({});
      if (url.includes('/ops-error')) return json({ ok: true });
      return json({});
    });
    // Everything else (Yahoo direct, the CORS proxies, fonts) fails fast
    // rather than hanging the page for its timeout.
    // Registered LAST, so Playwright runs it FIRST. `fallback()` — not
    // `continue()` — is what hands a request on to the fixture handler
    // above; `continue()` sends it to the real network instead, which is
    // how the first version of this harness silently bypassed every mock.
    await page.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(`http://localhost:${PORT}`)) return route.continue();
      if (u.includes('/functions/v1/')) return route.fallback();
      return route.abort();
    });

    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.perf-chart-wrap svg', { timeout: 20_000 });

    for (const view of ['sp', 'investment']) {
      if (view === 'investment') await page.click('.left-col #perf-tab-inv');
      for (const rangeKey of RANGES) {
        await page.click(`.left-col .perf-range-btn[data-range="${rangeKey}"]`);
        // This view and this range, drawn and still; a panel that never gets there fails below on what it last read.
        const tabIs = view === 'investment' ? /INVESTMENT/ : /VS S&P/;
        const read = await settledPanel(page, inflight, (r) => r.range === rangeKey && tabIs.test(r.tabOn) && r.paths.length >= 2);
        const row = { book: bk.name, snapshotMode, view, rangeKey, ...read };
        results.push(row);

        // ---- assertions
        const fail = (msg) => { failures++; console.log(`  FAIL [${bk.name}/${snapshotMode}/${view}/${rangeKey}] ${msg}`); };
        if (!read) { fail('panel missing'); continue; }
        if (read.empty) fail('drew the Insufficient-data empty state');
        if (read.paths.length < 2) fail(`only ${read.paths.length} line(s) drawn`);
        // The switch has to agree with the lines actually drawn: the
        // active tab IS the panel heading now, so a mismatch would put
        // one view's title over the other view's chart.
        const wantTab = view === 'investment' ? 'INVESTMENT' : 'VS S&P';
        if (!(read.tabOn || '').includes(wantTab)) fail(`active tab "${read.tabOn}" (want ${wantTab})`);
        if (view === 'investment') {
          if (read.labels.join(',') !== 'VALUE,DEPOSITED') fail(`legend labels ${read.labels}`);
          const wantValue = rangeKey === '1D' ? book.day : book.move;
          if (read.values[0] !== wantValue) fail(`value move ${read.values[0]} (want ${wantValue})`);
          if (read.values[1] !== '+0.00%') fail(`deposit move ${read.values[1]} (want +0.00%)`);
          const dashed = read.paths.filter((p) => p.dash);
          if (dashed.length !== 1) fail(`expected 1 dashed deposit line, got ${dashed.length}`);
          const ys = (dashed[0]?.d || '').replace('M', '').split('L').map((s) => Number(s.split(',')[1]));
          if (new Set(ys.map((y) => y.toFixed(1))).size !== 1) fail('deposit line is not flat');
          if (!read.ticks.some((t) => /^\$/.test(t || ''))) fail('no dollar axis ticks');
        } else {
          if (read.labels[0] !== 'PORTFOLIO') fail(`legend labels ${read.labels}`);
          if (rangeKey === '1D') {
            // From the previous close: the header's own figures, and a first
            // point that is the gap from that close, not 0 %.
            if (read.values[0] !== book.day) fail(`portfolio ${read.values[0]} (want ${book.day}, the DAY CHANGE)`);
            if (read.values[1] !== DAY_SP) fail(`S&P ${read.values[1]} (want ${DAY_SP}, the Market Conditions card)`);
            if (pctOf(read.dayChange) !== read.values[0]) fail(`portfolio ${read.values[0]} but DAY CHANGE ${read.dayChange}`);
            if (pctOf(read.mcSp) !== read.values[1]) fail(`S&P ${read.values[1]} but the card ${read.mcSp}`);
            const [spLine, portLine] = read.paths;
            if (!near(portLine?.pcts?.[0], book.dayFirst)) fail(`portfolio's first point ${portLine?.pcts?.[0]} (want ${book.dayFirst})`);
            if (!near(spLine?.pcts?.[0], DAY_SP_FIRST)) fail(`S&P's first point ${spLine?.pcts?.[0]} (want ${DAY_SP_FIRST})`);
          } else {
            if (read.values[0] !== book.move) fail(`portfolio move ${read.values[0]} (want ${book.move})`);
            if (read.values[1] !== '+4.00%') fail(`S&P move ${read.values[1]} (want +4.00%)`);
            // Both lines rebased: same first y.
            const firstY = read.paths.map((p) => Number((p.d || '').replace('M', '').split(',')[1]));
            if (Math.abs(firstY[0] - firstY[1]) > 0.2) fail(`lines start apart: ${firstY[0]} vs ${firstY[1]}`);
          }
        }
      }
    }
    await ctx.close();
  }
  }

  const sessions = await runSessions(browser);
  failures += sessions.failures;

  await browser.close();
  server.close();

  console.log('\n=== matrix ===');
  for (const r of results) {
    console.log(
      `${r.book.padEnd(10)} ${r.snapshotMode.padEnd(6)} ${r.view.padEnd(11)} ${r.rangeKey.padEnd(4)}`
      + ` lines=${r.paths?.length ?? 0} pts=${r.paths?.[0]?.points ?? 0}`
      + ` legend=${(r.values || []).join(' / ')}`
      + (r.empty ? '  EMPTY' : ''),
    );
  }
  console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILURES'} across ${results.length} cases at ${CLOCK.toISOString()}`
    + ` and ${sessions.cases} 24H cases at their own four instants`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); server.close(); process.exit(2); });

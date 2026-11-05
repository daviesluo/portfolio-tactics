// What a read-only visitor (role "ro", the viewer password) is sent of the book: the fields the read-only page renders
// or computes a figure on screen from, and nothing else (Davies, 2026-11-05). Hidden UI is not hidden data: whatever an
// endpoint answers is in the browser's Network tab, so a field the viewer's page never uses is not sent at all.
//
// Used by `data` (the board, `?action=load`) and `trading212` (the positions answer, `?action=orders`,
// `?action=dividends`). Admin answers never pass through here. Pure: no Deno API, no I/O, and only TypeScript that a
// type-stripping runtime can erase, so the browser sweep (src/e2e/app-sweep.mjs, under Node) answers its viewer with
// these very functions and the client's own maths can be checked against them (src/portfolio/ro_view.test.js).
//
// What the viewer's page does with the book, and so what it needs:
//   - the board, the heat map, the holding and sector lists, the ticker modal and Top Movers' TODAY read each held
//     position's shares, average cost, currency and stored prices;
//   - the vs-S&P line and Top Movers' 1W / 1M / 3M walk each held position's dated ledger (`computeAt`, ytd.js);
//   - every refresh merges the Trading 212 answer into the book (`applyTrading212Answer`), rebuilds each synced
//     holding's ledger from the stored fills and takes its average cost from that ledger (`applyFillLedgers`), and takes
//     the dividends off the average cost (`withDividendCosts`).
// What it never shows: the Transaction history, the Investment view and its deposit line, the lot editor, a holding
// that is off the board for good, and the time of day of any trade.
//
// So the viewer gets:
//   - only the holdings the board can show: those on a position, the cash, and a holding Trading 212 can put back on
//     its slot (`t212PositionKey`, `stripClosedFromPositions`); not a position closed for good, nor its fills or
//     dividends;
//   - only the fields each of those reads (the allowlists below): no `snapshots`, no `depositFxRates`, no lot `ts`;
//   - each synced holding's ledger and the fills as the vs-S&P maths needs them, not as they happened: everything
//     before the earliest day a viewer's window can start (`roCutoff`) folded into one opening row, and the rest one row
//     a day per side, at the day's average price. Both keep each holding's net shares and net cash exactly, which is
//     all the board's figures and the line's value and basis are made of while the holding's price history is there
//     (a pre-window row's basis is the window-start close, whatever its own date and cost). A holding that is not
//     synced (a CN fund, a hand-kept wallet) keeps its rows as they are: without an intraday history the line falls
//     back to interpolating from each row's own date and cost, which a fold would change;
//   - the dividends one row per holding and currency, their sum in the same order the page adds them up.

/** A position's keys (the board's own top level is `positions` and `holdings`, `roBoard`). */
export const RO_POSITION_KEYS = ["label", "subtitle", "role", "tickers"] as const;
/** A holding's keys. The stored prices paint the board before the first live quote lands. */
export const RO_HOLDING_KEYS = [
  "shares", "cost", "currency", "isCash", "closed",
  "lastPrice", "prevClose", "dayPct", "extPrice", "extDayPct", "extPriceTrusted",
  "lots", "sells", "t212Shares", "t212Cost", "t212PositionKey",
] as const;
/** A lot's keys; `src` marks a row the Trading 212 rebuild may not replace (t212_fills.js). */
export const RO_LOT_KEYS = ["date", "shares", "cost", "src"] as const;
/** A sale's keys. */
export const RO_SELL_KEYS = ["date", "shares", "price", "src"] as const;
/** A stored fill's keys (`t212_orders`). */
export const RO_ORDER_KEYS = ["ticker", "side", "shares", "price", "executed_at", "currency"] as const;
/** A dividend row's keys (`t212_dividends`). */
export const RO_DIVIDEND_KEYS = ["ticker", "paid_on", "amount_holding", "holding_currency"] as const;
/** The positions answer's keys, and a reported slice's. */
export const RO_ANSWER_KEYS = ["holdings", "prices", "complete", "updatedAt", "source"] as const;
export const RO_SLICE_KEYS = ["shares", "cost", "previousShares", "previousCost"] as const;

type Row = Record<string, unknown>;
const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isObj = (x: unknown): x is Row => !!x && typeof x === "object" && !Array.isArray(x);

/** `obj` with only `keys`, in that order, each only when present. */
export function pick(obj: unknown, keys: readonly string[]): Row {
  const out: Row = {};
  if (!isObj(obj)) return out;
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  return out;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The first day a viewer's window can reach, and the day the folded opening row is dated (the day before).
 *
 * The windows that read the ledger are the panel's 1D / 1W / 1M / 3M / YTD and Top Movers' 1W / 1M / 3M: YTD starts on
 * 1 January in the visitor's own time zone, 3M 93 days back, 1D on the last session (a long weekend back at most). The
 * cutoff is two weeks before the earlier of the 3M start and 1 January of the year two weeks ago, so a visitor whose
 * clock or time zone runs a day either side, or whose New Year has not come yet, still has every window start after it.
 * A page kept open only moves its windows later; a cached board was folded at an earlier cutoff, which is safe too.
 */
export function roCutoff(nowMs: number): { cutoff: string; openDay: string } {
  const jan1 = Date.UTC(new Date(nowMs - 14 * DAY_MS).getUTCFullYear(), 0, 1);
  const cut = Math.min(jan1, nowMs - 93 * DAY_MS) - 14 * DAY_MS;
  const cutoff = isoDay(cut);
  return { cutoff, openDay: isoDay(Date.parse(`${cutoff}T00:00:00Z`) - DAY_MS) };
}

/**
 * The holdings a viewer's board can show: every ticker on a position, the cash, and a holding whose
 * `t212PositionKey` names a position (Trading 212 reporting it again puts it back there). A position sold out for good
 * is none of these.
 */
export function keptTickers(board: unknown): Set<string> {
  const kept = new Set<string>();
  if (!isObj(board)) return kept;
  const positions = isObj(board.positions) ? board.positions : {};
  const holdings = isObj(board.holdings) ? board.holdings : {};
  for (const p of Object.values(positions)) {
    if (isObj(p) && Array.isArray(p.tickers)) for (const t of p.tickers) if (typeof t === "string") kept.add(t);
  }
  for (const [t, h] of Object.entries(holdings)) {
    if (!isObj(h)) continue;
    if (h.isCash === true || t === "CASH") kept.add(t);
    const slot = h.t212PositionKey;
    if (typeof slot === "string" && Object.prototype.hasOwnProperty.call(positions, slot)) kept.add(t);
  }
  return kept;
}

/** A synced holding: the rebuild's own test (`Number(holding.t212Shares)` finite, t212_fills.js rule 1). */
export const isSynced = (h: unknown) => isObj(h) && Number.isFinite(Number(h.t212Shares));

/**
 * Rows with net shares `n` and net cash `c` (buys' cash less sales' proceeds), every price positive, for the opening
 * row. One buy when both are positive, one sale when both are negative, otherwise a buy and a sale whose difference is
 * that (a position sold out before the cutoff, or sold at a profit beyond its cost, reads 0 or a negative net cash).
 * `keepBuy`: the rows folded held a buy, so the answer does too. Whether a ledger has any lot at all is read on its
 * own: the client's `migrate` gives a holding with none a lot dated today, and `ledgerFor` (ytd.js) trusts only a
 * ledger with one.
 */
export function netRows(n: number, c: number, keepBuy = false): { buys: Array<[number, number]>; sells: Array<[number, number]> } {
  // Float dust is no position, as `netPosition` snaps it (transactions.js).
  if (Math.abs(n) < 1e-9) n = 0;
  if (n > 0 && c > 0) return { buys: [[n, c / n]], sells: [] };
  if (n < 0 && c < 0 && !keepBuy) return { buys: [], sells: [[-n, c / n]] };
  const b = Math.max(n, 0) + 1;
  const s = b - n;
  if (c > 0) return { buys: [[b, (c + s) / b]], sells: [[s, 1]] };
  return { buys: [[b, 1]], sells: [[s, (b - c) / s]] };
}

type Fold = { date: string; shares: number; px: number };

/**
 * One set of buys and sales folded as the module header says: rows before `cutoff` into opening rows dated `openDay`,
 * the rest one per day and side at the day's share-weighted price. A row on its own is kept with its own numbers. Rows
 * `valid` refuses pass through unchanged; the caller decides what counts.
 */
function fold<T extends Row>(
  buys: T[], sells: T[], cutoff: string, openDay: string,
  dateOf: (r: T) => string, buyPx: (r: T) => number, sellPx: (r: T) => number,
): { buys: Fold[]; sells: Fold[] } {
  const out = { buys: [] as Fold[], sells: [] as Fold[] };
  const preBuys = buys.filter((r) => dateOf(r) < cutoff), preSells = sells.filter((r) => dateOf(r) < cutoff);
  if (preBuys.length + preSells.length === 1) {
    if (preBuys.length) out.buys.push({ date: openDay, shares: Number(preBuys[0].shares), px: buyPx(preBuys[0]) });
    else out.sells.push({ date: openDay, shares: Number(preSells[0].shares), px: sellPx(preSells[0]) });
  } else if (preBuys.length + preSells.length > 1) {
    let n = 0, c = 0;
    for (const r of preBuys) { n += Number(r.shares); c += Number(r.shares) * buyPx(r); }
    for (const r of preSells) { n -= Number(r.shares); c -= Number(r.shares) * sellPx(r); }
    const rows = netRows(n, c, preBuys.length > 0);
    for (const [s, p] of rows.buys) out.buys.push({ date: openDay, shares: s, px: p });
    for (const [s, p] of rows.sells) out.sells.push({ date: openDay, shares: s, px: p });
  }
  for (const [side, list, pxOf] of [["buys", buys, buyPx], ["sells", sells, sellPx]] as const) {
    const byDay = new Map<string, T[]>();
    for (const r of list) {
      const d = dateOf(r);
      if (d < cutoff) continue;
      const day = byDay.get(d);
      if (day) day.push(r); else byDay.set(d, [r]);
    }
    for (const [d, day] of byDay) {
      if (day.length === 1) { out[side].push({ date: d, shares: Number(day[0].shares), px: pxOf(day[0]) }); continue; }
      let s = 0, cash = 0;
      for (const r of day) { s += Number(r.shares); cash += Number(r.shares) * pxOf(r); }
      out[side].push({ date: d, shares: s, px: cash / s });
    }
  }
  return out;
}

const byDate = (a: { date?: unknown }, b: { date?: unknown }) => String(a.date ?? "").localeCompare(String(b.date ?? ""));

/**
 * A synced holding's lots and sales, folded (`fold`) within each `src`: the rebuild keeps the `src: 'other'` rows and
 * replaces the rest, so each keeps its own net. A row the client's `cleanLots` / `cleanSells` would drop, or one dated
 * after `today`, passes through as it is.
 */
export function foldLedger(lots: unknown, sells: unknown, nowMs: number): { lots: Row[]; sells: Row[] } {
  const { cutoff, openDay } = roCutoff(nowMs);
  const today = isoDay(nowMs);
  const okRow = (r: unknown, px: string): r is Row => isObj(r) && typeof r.date === "string" && DATE_RE.test(r.date)
    && r.date <= today && Number.isFinite(Number(r.shares)) && Number(r.shares) > 0
    && Number.isFinite(Number(r[px])) && Number(r[px]) >= 0;
  const L = Array.isArray(lots) ? lots : [], S = Array.isArray(sells) ? sells : [];
  const outLots: Row[] = L.filter((r) => !okRow(r, "cost")).map((r) => pick(r, RO_LOT_KEYS));
  const outSells: Row[] = S.filter((r) => !okRow(r, "price")).map((r) => pick(r, RO_SELL_KEYS));
  const srcOf = (r: Row) => (typeof r.src === "string" && r.src ? r.src : "");
  const groups = new Map<string, { buys: Row[]; sells: Row[] }>();
  const group = (k: string) => groups.get(k) ?? (groups.set(k, { buys: [], sells: [] }), groups.get(k)!);
  for (const r of L) if (okRow(r, "cost")) group(srcOf(r)).buys.push(r);
  for (const r of S) if (okRow(r, "price")) group(srcOf(r)).sells.push(r);
  for (const [src, g] of groups) {
    const f = fold(g.buys, g.sells, cutoff, openDay, (r) => String(r.date), (r) => Number(r.cost), (r) => Number(r.price));
    const tag = src ? { src } : {};
    for (const x of f.buys) outLots.push({ date: x.date, shares: x.shares, cost: x.px, ...tag });
    for (const x of f.sells) outSells.push({ date: x.date, shares: x.shares, price: x.px, ...tag });
  }
  return { lots: outLots.sort(byDate), sells: outSells.sort(byDate) };
}

/** The board a viewer is sent: the kept holdings (`keptTickers`) and the allowlisted fields of each. */
export function roBoard(data: unknown, nowMs: number): Row | null {
  if (!isObj(data)) return null;
  const kept = keptTickers(data);
  const positions: Row = {};
  for (const [k, p] of Object.entries(isObj(data.positions) ? data.positions : {})) positions[k] = pick(p, RO_POSITION_KEYS);
  const holdings: Row = {};
  for (const [t, h] of Object.entries(isObj(data.holdings) ? data.holdings : {})) {
    if (!kept.has(t) || !isObj(h)) continue;
    const out = pick(h, RO_HOLDING_KEYS);
    if (isSynced(h)) {
      // A fold can answer a sale for a holding that stored none (an opening pair), and that sale is half of its net.
      const f = foldLedger(h.lots, h.sells, nowMs);
      if (Array.isArray(h.lots) || f.lots.length > 0) out.lots = f.lots;
      if (Array.isArray(h.sells) || f.sells.length > 0) out.sells = f.sells;
    } else {
      if (Array.isArray(h.lots)) out.lots = h.lots.map((r) => (isObj(r) ? pick(r, RO_LOT_KEYS) : r));
      if (Array.isArray(h.sells)) out.sells = h.sells.map((r) => (isObj(r) ? pick(r, RO_SELL_KEYS) : r));
    }
    holdings[t] = out;
  }
  return { positions, holdings };
}

/**
 * The stored fills a viewer is sent: the kept tickers' only, folded per ticker and stated currency (`fold`), each dated
 * at midnight UTC of its day (the page reads the day; the time only orders a day's rows, and there is one a side).
 * A fill `lotsFromOrders` would skip passes through with its fields trimmed, since the currency and settle checks
 * still count it. Oldest first, as the function reads them.
 */
export function roOrders(rows: unknown, kept: Set<string>, nowMs: number): Row[] {
  const { cutoff, openDay } = roCutoff(nowMs);
  const list = (Array.isArray(rows) ? rows : []).filter((o): o is Row => isObj(o) && typeof o.ticker === "string" && kept.has(o.ticker));
  const dayOf = (o: Row) => String(o.executed_at ?? "").slice(0, 10);
  const ok = (o: Row) => DATE_RE.test(dayOf(o)) && Number.isFinite(Number(o.shares)) && Number(o.shares) > 0
    && Number.isFinite(Number(o.price)) && Number(o.price) > 0;
  const out: Row[] = list.filter((o) => !ok(o)).map((o) => pick(o, RO_ORDER_KEYS));
  const groups = new Map<string, { ticker: string; currency: unknown; buys: Row[]; sells: Row[] }>();
  for (const o of list) {
    if (!ok(o)) continue;
    const key = JSON.stringify([o.ticker, o.currency ?? null]);
    let g = groups.get(key);
    if (!g) { g = { ticker: String(o.ticker), currency: o.currency ?? null, buys: [], sells: [] }; groups.set(key, g); }
    (o.side === "sell" ? g.sells : g.buys).push(o);
  }
  for (const g of groups.values()) {
    const f = fold(g.buys, g.sells, cutoff, openDay, dayOf, (o) => Number(o.price), (o) => Number(o.price));
    const row = (side: string, x: Fold) => ({ ticker: g.ticker, side, shares: x.shares, price: x.px, executed_at: `${x.date}T00:00:00Z`, currency: g.currency });
    for (const x of f.buys) out.push(row("buy", x));
    for (const x of f.sells) out.push(row("sell", x));
  }
  return out.sort((a, b) => String(a.executed_at ?? "").localeCompare(String(b.executed_at ?? "")));
}

/**
 * The dividends a viewer is sent: the kept tickers' only, one row per ticker and holding currency carrying their
 * amounts' sum, added up from zero in the order the function reads them (paid_on, then id), which is the order the
 * page's `netPosition` adds them, so the figure is the same to the last bit. Dated at the group's latest payment. A row
 * the page would not add (no amount yet, a zero, a date it refuses) passes through with its fields trimmed, so what
 * the page leaves out and why is unchanged.
 */
export function roDividends(rows: unknown, kept: Set<string>, nowMs: number): Row[] {
  const today = isoDay(nowMs);
  const list = (Array.isArray(rows) ? rows : []).filter((r): r is Row => isObj(r) && typeof r.ticker === "string" && kept.has(r.ticker));
  const amountOf = (r: Row) => (r.amount_holding == null || r.amount_holding === "" ? NaN : Number(r.amount_holding));
  const ok = (r: Row) => {
    const d = typeof r.paid_on === "string" ? r.paid_on.slice(0, 10) : "";
    const a = amountOf(r);
    return DATE_RE.test(d) && d <= today && Number.isFinite(a) && a !== 0;
  };
  const out: Row[] = list.filter((r) => !ok(r)).map((r) => pick(r, RO_DIVIDEND_KEYS));
  const groups = new Map<string, { ticker: string; currency: unknown; sum: number; last: string }>();
  for (const r of list) {
    if (!ok(r)) continue;
    const key = JSON.stringify([r.ticker, r.holding_currency ?? null]);
    let g = groups.get(key);
    if (!g) { g = { ticker: String(r.ticker), currency: r.holding_currency ?? null, sum: 0, last: "" }; groups.set(key, g); }
    g.sum += amountOf(r);
    if (String(r.paid_on) > g.last) g.last = String(r.paid_on);
  }
  for (const g of groups.values()) out.push({ ticker: g.ticker, paid_on: g.last, amount_holding: g.sum, holding_currency: g.currency });
  return out.sort((a, b) => String(a.paid_on ?? "").localeCompare(String(b.paid_on ?? "")));
}

/** The positions answer a viewer is sent: the kept tickers' slices and prices, and the answer's own flags. */
export function roAnswer(body: unknown, kept: Set<string>): Row {
  const out = pick(body, RO_ANSWER_KEYS);
  const only = (m: unknown, f: (v: unknown) => unknown) => {
    const r: Row = {};
    if (isObj(m)) for (const [t, v] of Object.entries(m)) if (kept.has(t)) r[t] = f(v);
    return r;
  };
  if ("holdings" in out) out.holdings = only(out.holdings, (v) => pick(v, RO_SLICE_KEYS));
  if ("prices" in out) out.prices = only(out.prices, (v) => v);
  return out;
}

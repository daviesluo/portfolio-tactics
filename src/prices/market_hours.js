// Date / market-time helpers. No external deps inside this repo —
// everything goes through the platform's Intl. Split out of the
// since-retired utils.js barrel so the header_sidebar clock + the
// chart-modal regular-close lookup
// share one location instead of an undifferentiated 933-line module.

// Returns { hh, mm, ss } of Europe/London right now. Used by the
// header clock and the time-chip components.
import { isEuroExchange } from './ticker_class.js';

export function londonTimeParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    weekday: "short", hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type === "hour")    parts.hh = p.value;
    if (p.type === "minute")  parts.mm = p.value;
    if (p.type === "second")  parts.ss = p.value;
    // `wd` is the en-GB short weekday ("Mon"…"Sun"), read in LONDON rather
    // than the viewer's zone — for a user in Asia the local date can
    // already be Saturday while London is still on Friday's session.
    if (p.type === "weekday") parts.wd = p.value;
  }
  return parts;
}

// Hour / minute / weekday in America/New_York. Shared by usMarketPhase
// + isWeekendDeadZone so both read the exact same ET clock (and DST is
// resolved by Intl). `wd` is the en-US short weekday ("Mon"…"Sun").
function etHourMinuteWeekday(now) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  });
  let hh = 0, mm = 0, wd = "Mon";
  for (const p of fmt.formatToParts(now)) {
    if (p.type === "hour")    hh = parseInt(p.value, 10) % 24;
    if (p.type === "minute")  mm = parseInt(p.value, 10);
    if (p.type === "weekday") wd = p.value;
  }
  return { hh, mm, wd };
}

// ---- US equity sessions: the one table ----
// Every US session time the board uses, in ET minutes of the day, in one
// place, so that a dated change to the market's hours is one row here and
// nothing else: the phase (`usMarketPhase`), the header clock's dot
// (`usClockPhase`), the refresh cadence and the night overlay
// (`isWeekendDeadZone`), and every chart and anchor that asks for the day's
// close (`usMarketHoursUtc`, `usCloseUtcMs`, `isUsCloseStamp`) all read it.
//
//   premarket  04:00  the pre-market opens (Nasdaq, NYSE Arca)
//   open       09:30  the regular session
//   close      16:00  its close, and `earlyClose` 13:00 on an early close
//   post       20:00  the after-hours session ends, and `earlyPost` 17:00 on
//                     an early close: NYSE Group's calendar says its late
//                     sessions (Arca, American, National, Texas) close at
//                     17:00 then, and Nasdaq's post-market does the same.
//                     Yahoo's `currentTradingPeriod` still reads post to
//                     20:00 ET on 2026-11-27, but nothing prints after 17:00.
//   overnight  20:00  the overnight session (Blue Ocean ATS, Trading 212's
//                     night prices) opens Sunday to Thursday evenings and
//                     runs to `premarket`. It does not run into a holiday or
//                     a weekend, and every early close is followed by one, so
//                     an early close is shut from 17:00 until the next session.
//
// 23/5 is coming: Nasdaq and NYSE Arca target Sunday 2026-12-06 21:00 ET for
// trading Sunday 21:00 to Friday 20:00 ET, with an exchange night session
// 21:00-04:00 beside today's 04:00-20:00 and a 20:00-21:00 pause, pending the
// SIP's readiness, so the date may slip. It is NOT live here until it is
// confirmed. When it is, add one row: `{ ...the row above, from: '<the ET date
// of the first Sunday>', overnight: 21 * 60 }`. The 20:00-21:00 pause then
// reads closed on the clock (any gap between `post` and `overnight` does), the
// weekend's dead zone ends at Sunday 21:00, and nothing else needs an edit.
// Which venue Trading 212's night prices come from then is a question for
// that day, not this table.
//
// The server keeps the same times in `supabase/functions/_shared/us_market_calendar.ts`
// (`US_SESSION`); `src/prices/us_calendar_parity.test.js` holds the two to
// each other, day by day for 2025-2030.
/**
 * @typedef {{ from: string, premarket: number, open: number, close: number, post: number,
 *   earlyClose: number, earlyPost: number, overnight: number }} UsSessionRow
 */
/** @type {ReadonlyArray<Readonly<UsSessionRow>>} */
export const US_SESSION_TABLE = Object.freeze([
  Object.freeze({
    from: '1900-01-01',
    premarket: 4 * 60, open: 9 * 60 + 30, close: 16 * 60, post: 20 * 60,
    earlyClose: 13 * 60, earlyPost: 17 * 60,
    overnight: 20 * 60,
  }),
]);

/** The table's row for an ET calendar date (`YYYY-MM-DD`): the last one whose `from` is not after it. */
function usSessionRow(ymd) {
  let row = US_SESSION_TABLE[0];
  for (const r of US_SESSION_TABLE) if (r.from <= ymd) row = r;
  return row;
}

// ---- US market calendar (NYSE / Nasdaq full closures and early closes) ----
// Rule-based rather than a hand-maintained date list: every holiday is
// either a fixed date (with the standard NYSE weekend-observance shift)
// or an nth-weekday, and Good Friday is derived from Easter. This means
// no annual upkeep AND — the property that matters most — no chance of a
// typo'd date marking a REAL trading day as closed, which would mis-paint
// the scoreboard. Anything NOT in the computed set just falls through to
// the normal phase logic (the pre-fix behaviour), so a missing holiday is
// merely "polls on a closed day" (harmless), never the reverse.
//
// Early closes (13:00 ET: the Friday after Thanksgiving, and July 3 /
// December 24 when they fall Monday to Thursday) are the board's since
// 2026-11-27 (Davies, that afternoon: "今天短交易日市场已经关市了，网站没识别出来").
// Until then they were the server's alone and the board kept 'regular' to
// 16:00 by a decision of 2026-09-30, because its after-hours verdict, the
// market cards' close anchor and the chart windows all read 16:00-ET bars:
// an 'afterhours' phase from 13:00 alone would have shown every US row's
// extended figure as unknown until 16:00. All of them now ask for the day's
// own close (`usMarketHoursUtc`, whose `closeOn` gives each date's, and
// `isUsCloseStamp`), so the phase moves with them: regular 09:30-13:00,
// after hours 13:00-17:00, then shut.
//
// The rules are the server's, mirrored: `supabase/functions/_shared/us_market_calendar.ts`.
// Different runtimes, so the two cannot share a module; `us_calendar_parity.test.js`
// compares them on every day of 2025-2030 and fails when either drifts.

/** UTC day-of-week (0=Sun…6=Sat) for a calendar Y-M-D. */
function dowUTC(y, m, d) { return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }

/** Day-of-month of the nth (1-based; -1 = last) weekday `wd` (0=Sun) in month m. */
function nthWeekday(y, m, wd, nth) {
  if (nth > 0) {
    const offset = (wd - dowUTC(y, m, 1) + 7) % 7;
    return 1 + offset + (nth - 1) * 7;
  }
  const lastDom = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return lastDom - ((dowUTC(y, m, lastDom) - wd + 7) % 7);
}

/** Easter Sunday {month,day} via the Anonymous Gregorian algorithm. */
function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mo = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * mo + 114) / 31);
  const day = ((h + l - 7 * mo + 114) % 31) + 1;
  return { month, day };
}

/**
 * Observed `M-D` for a fixed-date holiday. NYSE shifts a Saturday
 * holiday to the Friday before and a Sunday holiday to the Monday after
 * — EXCEPT New Year's Day, which is never pulled back onto the prior
 * Friday (the market simply stays open), so it passes shiftSat=false.
 */
function observedMD(y, m, d, shiftSat) {
  const dow = dowUTC(y, m, d);
  if (dow === 6 && shiftSat) return `${m}-${d - 1}`;  // Sat → Fri (same month for Jun19/Jul4/Dec25)
  if (dow === 0)             return `${m}-${d + 1}`;   // Sun → Mon
  return `${m}-${d}`;
}

const _holidayCache = new Map();
function holidaySetFor(y) {
  const set = new Set();
  set.add(observedMD(y, 1, 1, false));                       // New Year's (Sun→Mon only)
  set.add(`1-${nthWeekday(y, 1, 1, 3)}`);                    // MLK — 3rd Mon Jan
  set.add(`2-${nthWeekday(y, 2, 1, 3)}`);                    // Presidents — 3rd Mon Feb
  const e = easterSunday(y);                                 // Good Friday — Easter − 2
  const gf = new Date(Date.UTC(y, e.month - 1, e.day - 2));
  set.add(`${gf.getUTCMonth() + 1}-${gf.getUTCDate()}`);
  set.add(`5-${nthWeekday(y, 5, 1, -1)}`);                   // Memorial — last Mon May
  set.add(observedMD(y, 6, 19, true));                       // Juneteenth
  set.add(observedMD(y, 7, 4, true));                        // Independence Day
  set.add(`9-${nthWeekday(y, 9, 1, 1)}`);                    // Labor — 1st Mon Sep
  set.add(`11-${nthWeekday(y, 11, 4, 4)}`);                  // Thanksgiving — 4th Thu Nov
  set.add(observedMD(y, 12, 25, true));                      // Christmas
  return set;
}

/** Is the ET-calendar `y-m-d` (m, d 1-based) a full-day US market holiday? The server's `isUsMarketHolidayYmd`. */
export function isUsMarketHolidayYmd(y, m, d) {
  let set = _holidayCache.get(y);
  if (!set) { set = holidaySetFor(y); _holidayCache.set(y, set); }
  return set.has(`${m}-${d}`);
}

/**
 * Does the regular session on the ET-calendar `y-m-d` end at 13:00 ET? The
 * Friday after Thanksgiving always; July 3 and December 24 when they fall
 * Monday to Thursday (on a Friday each is the observed holiday, on a weekend
 * there is no session). The server's `isUsEarlyCloseYmd`; NYSE's published
 * calendars for 2025-2028 name exactly these days.
 */
export function isUsEarlyCloseYmd(y, m, d) {
  if (m === 11) return d === nthWeekday(y, 11, 4, 4) + 1;
  if ((m === 7 && d === 3) || (m === 12 && d === 24)) {
    const dow = dowUTC(y, m, d);
    return dow >= 1 && dow <= 4;
  }
  return false;
}

/**
 * The US session on the ET-calendar `y-m-d`, in ET minutes of the day: the
 * table's row with the day's own close and after-hours end (13:00 and 17:00
 * on an early close), and whether the day trades at all (not a weekend, not
 * a full holiday).
 * @returns {{ trading: boolean, early: boolean, premarket: number, open: number, close: number, post: number, overnight: number }}
 */
export function usDaySession(y, m, d) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const row = usSessionRow(`${y}-${pad(m)}-${pad(d)}`);
  const dow = dowUTC(y, m, d);
  const trading = dow !== 0 && dow !== 6 && !isUsMarketHolidayYmd(y, m, d);
  const early = trading && isUsEarlyCloseYmd(y, m, d);
  return {
    trading, early,
    premarket: row.premarket, open: row.open,
    close: early ? row.earlyClose : row.close,
    post: early ? row.earlyPost : row.post,
    overnight: row.overnight,
  };
}

/** ET calendar { y, m, d } for `now` (en-CA short date is YYYY-MM-DD). */
function etDateParts(now) {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const [y, m, d] = s.split('-').map((n) => parseInt(n, 10));
  return { y, m, d };
}

/** The US session of `now`'s ET calendar day (`usDaySession`). */
export function usSessionAt(now = new Date()) {
  const { y, m, d } = etDateParts(now);
  return usDaySession(y, m, d);
}

/** True when `now` lands on a full-day US market holiday (ET calendar). */
export function isUsMarketHoliday(now = new Date()) {
  const { y, m, d } = etDateParts(now);
  return isUsMarketHolidayYmd(y, m, d);
}

/** True when `now`'s ET calendar day is an early close (13:00 ET). */
export function isUsEarlyClose(now = new Date()) {
  const { y, m, d } = etDateParts(now);
  return isUsEarlyCloseYmd(y, m, d) && usDaySession(y, m, d).trading;
}

/**
 * Is the calendar date of an ISO string (`YYYY-MM-DD…`) a US TRADING day —
 * not a weekend and not a full-day holiday? A 24/7 crypto has a 16:00-ET
 * bar EVERY day, so its 1D window picker (windowSinceLastUsClose /
 * windowBetweenLastTwoUsCloses) uses this to skip the weekend / holiday
 * bars and key only off real US session closes. The bar date is UTC, but a
 * close bar's UTC date equals its ET trading date (13:00-16:00 ET is
 * 17:00-21:00 UTC, the same calendar day), so the UTC date is the ET one.
 * Permissive on a malformed input (returns true) so a bad string never
 * blanks the chart.
 * @param {string} dateStr
 */
export function isUsTradingDateStr(dateStr) {
  if (typeof dateStr !== 'string' || dateStr.length < 10) return true;
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return true;
  return usDaySession(y, m, d).trading;
}

// US market phase, based on NY local time, from the day's session
// (`usSessionAt`): regular 09:30 to the close (16:00, 13:00 on an early
// close), premarket 04:00-09:30, afterhours from the close to the end of the
// late session (20:00, 17:00 on an early close), overnight otherwise.
// Weekends AND full-day holidays → overnight (market closed; same bucket
// every other surface already treats as "outside RTH, nothing trading"), and
// so is an early close from 17:00: nothing trades, and `usClockPhase` says so.
export function usMarketPhase(now = new Date()) {
  const { hh, mm, wd } = etHourMinuteWeekday(now);
  const mins = hh * 60 + mm;
  if (wd === "Sat" || wd === "Sun") return "overnight";
  const s = usSessionAt(now);
  if (!s.trading) return "overnight";
  if (mins >= s.open && mins < s.close) return "regular";
  if (mins >= s.premarket && mins < s.open) return "premarket";
  if (mins >= s.close && mins < s.post) return "afterhours";
  return "overnight";
}

// Minutes past midnight in New York (DST by Intl), for code that needs where in the ET day a moment falls.
export function etMinuteOfDay(now = new Date()) {
  const { hh, mm } = etHourMinuteWeekday(now);
  return hh * 60 + mm;
}

// "Weekend dead zone" — Friday's after-hours end (20:00 ET, 17:00 on an
// early-close Friday, the day after Thanksgiving) through Sunday's overnight
// reopen (20:00 ET). US equities, including the 24/5 overnight session,
// don't trade in this window, so the T212 overnight quote can't move and
// there's nothing fresh to pull. The auto-refresh stays slow (5 min) here
// while weekday overnights run the fast 30 s cadence that keeps live
// overnight prices current. Both ends come from the session table.
export function isWeekendDeadZone(now = new Date()) {
  const { hh, mm, wd } = etHourMinuteWeekday(now);
  const mins = hh * 60 + mm;
  if (wd === "Sat") return true;
  if (wd === "Fri") return mins >= usSessionAt(now).post;
  if (wd === "Sun") return mins < usSessionAt(now).overnight;
  return false;
}

// The header clock's dot: `usMarketPhase`, except that nothing trading reads "closed", not "overnight". That function puts
// weekends and holidays in the overnight bucket on purpose (the refresh cadence and the T212 night overlay key off it), so the
// dot sat on the night colour all weekend (Davies, 2026-10-31 01:20 UTC, a Saturday: "现在都周六1:20了还是night market的颜色").
// Closed: the weekend dead zone (Fri 20:00 → Sun 20:00 ET), a full-day holiday until its 20:00 ET, the gap between a day's
// late session and its overnight (17:00-20:00 ET on an early close), and from 20:00 ET on the evening before a holiday, when
// the overnight session that would lead into it does not run.
export function usClockPhase(now = new Date()) {
  if (isWeekendDeadZone(now)) return "closed";
  const { hh, mm } = etHourMinuteWeekday(now);
  const mins = hh * 60 + mm;
  const s = usSessionAt(now);
  if (isUsMarketHoliday(now) && mins < s.overnight) return "closed";
  if (s.trading && mins >= s.post && mins < s.overnight) return "closed";
  if (mins >= s.overnight && isUsMarketHoliday(new Date(now.getTime() + 12 * 3600e3))) return "closed";
  return usMarketPhase(now);
}

// Is the overnight session (20:00-04:00 ET) actually running? `usMarketPhase` says "overnight" for every hour nothing else
// trades, the weekend and holidays included; the night overlay and the chart's night dot want the session itself, the one
// `usClockPhase` shows in the night colour.
export function usOvernightRunning(now = new Date()) {
  return usClockPhase(now) === "overnight";
}

// UK time-zone short name ('GMT' or 'BST') for the given moment.
// Uses Intl so DST transitions (last Sun Mar / last Sun Oct) are
// resolved by the runtime — no manual cutover dates to maintain.
export function ukTzAbbr(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    timeZoneName: 'short',
  }).formatToParts(now);
  const tz = parts.find(p => p.type === 'timeZoneName')?.value;
  return tz === 'BST' || tz === 'GMT' ? tz : 'GMT';
}

// US regular-market open / close in UTC for the given moment's ET day,
// accounting for whether the date lands in EDT (UTC-4, March 2nd Sun → Nov
// 1st Sun) or EST (UTC-5) and for the day's own close (`usDaySession`: 13:00
// ET on an early close). Returned as hh/mm pairs so the chart code can
// compare against the UTC-string slice of each intraday bar.
//
//   EDT: open 13:30 UTC (= 9:30 ET), close 20:00 UTC (= 16:00 ET), 17:00 UTC on an early close
//   EST: open 14:30 UTC,             close 21:00 UTC,                18:00 UTC on an early close
//
// `closeHh:closeMm` is TODAY's close. A series that spans several days asks
// `closeOn(date)` for each bar's own day instead (`isUsCloseStamp`): the
// previous session's close is 21:00 UTC when today's is 18:00 (the Monday
// after the day after Thanksgiving reads Friday's 18:00 bar), and a 5-day
// series that crosses a DST change has two closing hours in it.
//
// Detection: ask the runtime for the NY hour, compare to the UTC hour;
// the offset is 4 (EDT) or 5 (EST). Avoids hard-coded DST cutover
// dates.
const NY_HOUR_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: '2-digit', hour12: false,
});
/** Hours New York is behind UTC at an instant: 4 (EDT) or 5 (EST). */
function nyOffsetHours(at) {
  // Formatter hoisted: this is called once per DAY of a 6-month slot
  // grid, and constructing an Intl.DateTimeFormat costs ~10-50 us.
  const nyHour = parseInt(NY_HOUR_FMT.format(at), 10) % 24;
  let diff = at.getUTCHours() - nyHour;
  if (diff > 12)  diff -= 24;
  if (diff < -12) diff += 24;
  return diff;
}

/**
 * The US regular close of a UTC calendar date as `{ hh, mm }` UTC, or null
 * when the date has no session (a weekend or a full holiday). Cached per
 * date: the close scans ask it once per bar.
 * @type {Map<string, {hh: number, mm: number} | null>}
 */
const _closeOnCache = new Map();
/** @param {string} dateStr  `YYYY-MM-DD…` (a bar's UTC date, which is its ET trading date at the close) */
export function usCloseOnUtc(dateStr) {
  if (typeof dateStr !== 'string' || dateStr.length < 10) return null;
  const day = dateStr.slice(0, 10);
  if (_closeOnCache.has(day)) return _closeOnCache.get(day) ?? null;
  const [y, m, d] = day.split('-').map(Number);
  /** @type {{hh: number, mm: number} | null} */
  let out = null;
  if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
    const s = usDaySession(y, m, d);
    if (s.trading) {
      // 18:00 UTC is early afternoon in New York in either regime, far from the 02:00 cutover: the regime read is that day's.
      const mins = s.close + nyOffsetHours(new Date(Date.UTC(y, m - 1, d, 18))) * 60;
      out = { hh: Math.floor(mins / 60), mm: mins % 60 };
    }
  }
  if (_closeOnCache.size > 512) _closeOnCache.clear();
  _closeOnCache.set(day, out);
  return out;
}

/**
 * @typedef {{ openHh: number, openMm: number, closeHh: number, closeMm: number, edt: boolean,
 *   early?: boolean, closeOn?: (dateStr: string) => ({hh: number, mm: number} | null) }} UsMarketHoursUtc
 */
/** @returns {UsMarketHoursUtc} */
export function usMarketHoursUtc(now = new Date()) {
  const off = nyOffsetHours(now);
  const edt = off === 4;
  const s = usSessionAt(now);
  const openUtc = s.open + (edt ? 4 : 5) * 60;
  const closeUtc = s.close + (edt ? 4 : 5) * 60;
  return {
    openHh: Math.floor(openUtc / 60), openMm: openUtc % 60,
    closeHh: Math.floor(closeUtc / 60), closeMm: closeUtc % 60,
    edt, early: s.early, closeOn: usCloseOnUtc,
  };
}

/**
 * Is the bar stamped `d` (`YYYY-MM-DDTHH:MM`, UTC) the bar AT a US regular
 * close: 16:00 ET on its own day, 13:00 ET on an early close, never on a day
 * with no session? Yahoo stamps one there (the closing print in a regular-hours
 * series, the first late-session bar with pre/post; on 2026-11-27 SPY's and
 * ^GSPC's at 18:00 UTC). With an `mh` from `usMarketHoursUtc` the close is read
 * per bar's day (`closeOn`); a bare `{ closeHh, closeMm }` (the older tests'
 * shape) is matched as one fixed time.
 * @param {string} d
 * @param {{ closeHh: number, closeMm: number, closeOn?: (dateStr: string) => ({hh: number, mm: number} | null) } | null | undefined} mh
 */
export function isUsCloseStamp(d, mh) {
  if (typeof d !== 'string' || d.length < 16 || d[10] !== 'T' || !mh) return false;
  const hh = parseInt(d.slice(11, 13), 10);
  const mm = parseInt(d.slice(14, 16), 10);
  if (typeof mh.closeOn === 'function') {
    const c = mh.closeOn(d);
    return c != null && hh === c.hh && mm === c.mm;
  }
  return hh === mh.closeHh && mm === mh.closeMm;
}

/**
 * The US regular session of a bar's UTC date in UTC minutes of the day,
 * `{ openMins, closeMins }`, for the extended-hours verdict
 * (`extPriceIsRealAh`): which bars are outside it. A day with no session
 * gives `fallback` (today's), so a weekend read of Friday's bars asks with
 * Friday's date.
 * @param {string | null | undefined} dateStr
 * @param {UsMarketHoursUtc} fallback
 */
export function usSessionUtcMins(dateStr, fallback) {
  const c = typeof dateStr === 'string' ? usCloseOnUtc(dateStr) : null;
  const openMins = fallback.openHh * 60 + fallback.openMm;
  if (!c) return { openMins, closeMins: fallback.closeHh * 60 + fallback.closeMm };
  // The open is 09:30 ET on every day: the close's offset from its ET time says the regime.
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  const s = usDaySession(y, m, d);
  const off = c.hh * 60 + c.mm - s.close;
  return { openMins: s.open + off, closeMins: c.hh * 60 + c.mm };
}

/** Saturday or Sunday, per a short weekday name already read in the
 *  exchange's OWN zone. Unknown / missing reads as a weekday, so a locale
 *  surprise can only leave the gate as permissive as it was before. */
const isWeekendName = (wd) => wd === 'Sat' || wd === 'Sun';

// LSE regular session: 08:00 - 16:30 London time, Monday to Friday.
// Returns true when the given moment falls inside that window.
//
// The weekday half of that was missing until 2026-09-20, and the comment
// here argued it was unnecessary: "Yahoo simply doesn't return new bars
// then, and the dayPct stays at the previous trading day's close, so a
// 'Saturday show 0' guard is redundant." The stale pct IS the bug, not a
// reason there isn't one — see `euroExchangeIsOpen` for the measurement
// that settled it.
//
// Used by computeMetrics to gate the ext-hours toggle's display for `.L`
// tickers: LSE has no US-style pre/after session, so the toggle should
// read 0 outside LSE trading hours and the live intraday pct only when
// LSE is actually open (i.e. during US pre-market, where LSE has been
// trading for ~1-6h and is genuinely moving).
//
// UK public holidays are still not modelled. Unlike the weekend they need
// a per-country calendar, and marking a real trading day shut is the more
// expensive error — it would blank a moving row.
export function lseIsOpen(now = new Date()) {
  const parts = londonTimeParts(now);
  if (isWeekendName(parts.wd)) return false;
  const hh = parseInt(parts.hh, 10);
  const mm = parseInt(parts.mm, 10);
  if (!isFinite(hh) || !isFinite(mm)) return false;
  const mins = hh * 60 + mm;
  return mins >= 8 * 60 && mins < 16 * 60 + 30;
}

// Returns { hh, mm, ss } of Europe/Paris (Central European Time, CET/CEST
// — DST resolved by Intl) right now. Mirrors londonTimeParts; used by
// euroExchangeIsOpen to gate the ext-hours toggle for euro-zone tickers.
export function centralEuropeTimeParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    weekday: "short", hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type === "hour")    parts.hh = p.value;
    if (p.type === "minute")  parts.mm = p.value;
    if (p.type === "second")  parts.ss = p.value;
    if (p.type === "weekday") parts.wd = p.value;
  }
  return parts;
}

// Continental-European exchange CORE regular session, 09:00 - 17:30
// Central European Time (Mon-Fri). Euronext (Paris/Amsterdam/Brussels/
// Lisbon/Dublin), XETRA + Frankfurt, Milan, Madrid and Vienna all run this
// window; Helsinki's 10:00-18:30 EET maps onto the same 09:00-17:30 CET,
// and Athens (10:30-17:00 EET → 09:30-16:00 CET) sits inside it. The
// German RETAIL venues (Stuttgart .SG, Berlin .BE, Munich .MU, … —
// 08:00-22:00 CET) trade wider than this, so 09:00-17:30 is intentionally
// the conservative core session: the gate only has to be right during the
// US ext-hours overlap (after-hours / overnight, when every German venue
// is also shut), where it correctly reads closed. Same role as lseIsOpen:
// these venues have no US-style pre/after session, so the ext-hours toggle
// should read 0 outside local trading hours and the live intraday pct only
// while the exchange is open.
//
// Monday to Friday only. It used to check the clock alone, on the written
// assumption that a weekend guard was redundant "because Yahoo returns no
// new bars then, so the pct stays at the prior close". That is precisely
// what goes wrong: the pct does stay at the prior close, and the gate then
// reports the exchange as OPEN, so computeMetrics hands the board Friday's
// move as an extended-hours number. Measured on 2026-09-20: the board read
// SAND (MBG.SG) +[•]% with the toggle on at 13:01 BST on a Saturday, while
// the recorder showed its price last moved at 21:05 London on the Friday
// and unchanged at 2.804 for the 28 hours since.
//
// European public holidays are still not modelled — they need a per-venue
// calendar, and blanking a real trading day is the worse error.
export function euroExchangeIsOpen(now = new Date()) {
  const parts = centralEuropeTimeParts(now);
  if (isWeekendName(parts.wd)) return false;
  const hh = parseInt(parts.hh, 10);
  const mm = parseInt(parts.mm, 10);
  if (!isFinite(hh) || !isFinite(mm)) return false;
  const mins = hh * 60 + mm;
  return mins >= 9 * 60 && mins < 17 * 60 + 30;
}

/**
 * "Is this NON-US listing's own exchange trading right now?"
 *
 * The single source of truth behind two rules that must agree:
 *   - computeMetrics suppresses a foreign row's ext-hours pct to 0
 *     when its own market is shut (there is genuinely no movement),
 *   - the chart modal picks its 1D anchor — while the local session is
 *     LIVE, `lastPrice` is a running quote rather than a completed
 *     close, so the ext-on "anchor at today's regular close" rule
 *     would divide the price by itself and print a permanent 0.00 %.
 *
 * They drifted apart before: the heatmap showed SAND (MBG.SG) moving
 * during US pre-market while the modal for the same ticker read 0 %.
 *
 * False for anything without a separate local session — US equities,
 * crypto, CN funds (whose once-daily NAV has no intraday session at
 * all, and which computeMetrics suppresses unconditionally).
 *
 * @param {string} ticker
 * @param {Date} [now]
 */
export function foreignSessionIsOpen(ticker, now = new Date()) {
  if (typeof ticker !== 'string' || !ticker) return false;
  if (/\.L$/i.test(ticker)) return lseIsOpen(now);
  if (isEuroExchange(ticker)) return euroExchangeIsOpen(now);
  return false;
}

/** Does this ticker trade on a non-US exchange with its own session? */
export function isForeignListing(ticker) {
  return typeof ticker === 'string' && (/\.L$/i.test(ticker) || isEuroExchange(ticker));
}

// ---------------------------------------------------------------------
// The four-hour London sampling grid (the [•] chart)
// ---------------------------------------------------------------------
//
// Six samples a calendar day, on the London clock, at [•] / [•] / [•] / [•]
// / [•] and the day's actual US regular close. The shape is Trading
// [•]'s; what makes it the right grid for THIS book is that the book is
// not one venue. Each slot lands in a session that is genuinely open:
//
//   [•]:[•]  US futures reopened, Asia about to
//   [•]:[•]  Hong Kong and the mainland trading
//   [•]:[•]  London open
//   [•]:[•]  London afternoon, US pre-market
//   [•]:[•]  US regular session, mid-afternoon
//   close  the US close itself
//
// The sixth slot is PINNED to the close rather than written down as
// [•]:[•] because [•]:[•] London is only the close while the UK and the US
// are in the same DST regime. For the ~[•] weeks in March and the ~[•] week
// around the start of November when they are not, the US closes at
// [•]:[•] London and a fixed [•]:[•] would sample an hour of after-hours
// into the "close" point. `usMarketHoursUtc` already resolves that
// through Intl, so the grid asks it per day instead of assuming.
//
// Weekends are skipped BY DEFAULT. For a book of equities, or for
// futures and FX, every venue is shut, so six flat points a day for two
// days in seven would spend a quarter of the chart's width — the x axis
// is index-based, not time-based — saying nothing. That also keeps [•]
// consistent with 1W / [•], whose grids come from Yahoo bars and so have
// never had weekend points either.
//
// `includeWeekends` is for a [•]/[•] tape (crypto), where Saturday is real
// trading and dropping it would lose two days in seven of actual
// movement. A weekend day has no US close, so its sixth sample is
// [•]:[•] London — the hour the close falls on in both matched DST
// regimes, which keeps the spacing a clean four hours right through.

/** London wall-clock hours sampled before the day's US close. */
export const LONDON_SLOT_HOURS = [1, 5, 9, 13, 17];

/** Samples the grid takes on a weekday: the hours above, plus the close. */
export const SLOTS_PER_DAY = LONDON_SLOT_HOURS.length + 1;

// Hoisted: these are constructed once and reused. Building an
// Intl.DateTimeFormat costs ~10-50 us, and a 93-day grid asks ~1100
// times per rebuild.
const LONDON_HOUR_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', hour: '2-digit', hour12: false,
});

/**
 * Minutes London is ahead of UTC at an instant — 0 (GMT) or 60 (BST).
 * @param {number} ms
 * @returns {number}
 */
function londonOffsetMinutes(ms) {
  const d = new Date(ms);
  const lonH = parseInt(LONDON_HOUR_FMT.format(d), 10) % 24;
  let diff = lonH - d.getUTCHours();
  if (diff > 12)  diff -= 24;
  if (diff < -12) diff += 24;
  return diff * 60;
}

/**
 * Epoch ms of a London wall-clock hour on a calendar day.
 *
 * Two passes, because the offset has to be measured at the answer, not
 * at the guess. On the two cutover Sundays a wall-clock hour can be
 * missing or doubled; the second pass resolves the missing one forward
 * (01:00 BST-start reads as 02:00) and the doubled one to its second
 * occurrence, which is the usual convention and lands on a Sunday
 * anyway, where the grid emits nothing.
 *
 * @param {string} dateStr  YYYY-MM-DD
 * @param {number} hour     London wall-clock hour
 * @returns {number}
 */
export function londonHourUtcMs(dateStr, hour) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  const off1 = londonOffsetMinutes(guess);
  const t = guess - off1 * 60_000;
  const off2 = londonOffsetMinutes(t);
  return off2 === off1 ? t : guess - off2 * 60_000;
}

/**
 * Epoch ms of the US regular close on a calendar day — 20:00 UTC under
 * EDT, 21:00 UTC under EST, three hours earlier on an early close
 * (`usCloseOnUtc`). A day with no session (the grid asks weekdays only, a
 * holiday among them) reads 16:00 ET, where nothing prints either way.
 *
 * @param {string} dateStr  YYYY-MM-DD
 * @returns {number}
 */
export function usCloseUtcMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const c = usCloseOnUtc(dateStr);
  if (c) return Date.UTC(y, m - 1, d, c.hh, c.mm);
  const off = nyOffsetHours(new Date(Date.UTC(y, m - 1, d, 18)));
  return Date.UTC(y, m - 1, d, 16 + off, 0);
}

// Rebuilt at most once an hour: the grid only gains a point when the
// wall clock does, and returning the SAME array identity keeps the
// chart's memo signature stable across renders.
//
// A handful of entries, not one: a chart drawing a 3-month window while
// its moving average reads a 6-month one asks for two different grids
// on every render, and a single slot would let them evict each other
// and rebuild ~1200 Intl lookups a render between them.
const SLOT_CACHE_MAX = 4;
/** @type {Map<string, number[]>} */
const slotCache = new Map();

/**
 * The sampling grid over a window, ascending, in epoch ms.
 *
 * The last entry is always the current hour, so the chart has a live
 * right edge instead of one up to four hours stale — the same shape 1M
 * has, where Yahoo's newest bar is the partial current hour. It
 * coincides with a grid slot (and dedupes) whenever the hour is one.
 *
 * @param {number} startMs
 * @param {number} endMs
 * @param {boolean} [includeWeekends]  true for a 24/7 tape
 * @returns {number[]}
 */
export function fourHourSlots(startMs, endMs, includeWeekends = false) {
  const HOUR = 3600_000, DAY = 24 * HOUR;
  if (!(endMs > startMs)) return [];
  const key = `${Math.floor(startMs / HOUR)}|${Math.floor(endMs / HOUR)}|${includeWeekends ? 'w' : ''}`;
  const hit = slotCache.get(key);
  if (hit) return hit;

  /** @type {number[]} */
  const raw = [];
  for (let t = startMs - DAY; t <= endMs + DAY; t += DAY) {
    const day = new Date(t).toISOString().slice(0, 10);
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    if (weekend && !includeWeekends) continue;
    for (const h of LONDON_SLOT_HOURS) raw.push(londonHourUtcMs(day, h));
    // No US close on a Saturday; 21:00 London keeps the four-hour step.
    raw.push(weekend ? londonHourUtcMs(day, 21) : usCloseUtcMs(day));
  }
  raw.push(Math.floor(endMs / HOUR) * HOUR);

  const slots = [...new Set(raw.filter(ms => ms >= startMs && ms <= endMs))]
    .sort((a, b) => a - b);
  if (slotCache.size >= SLOT_CACHE_MAX) slotCache.delete(slotCache.keys().next().value);
  slotCache.set(key, slots);
  return slots;
}

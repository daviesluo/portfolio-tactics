// Pin isWeekendDeadZone's ET boundaries — the auto-refresh cadence
// flips on these, so a regression would either spam Yahoo through the
// weekend (boundary too late) or stop refreshing live overnight prices
// on a weekday night (boundary too early). Times are constructed in
// UTC and asserted against the America/New_York interpretation; we use
// a fixed winter date (EST = UTC-5) so the offset is deterministic.

import { describe, it, expect } from 'vitest';
import {
  isWeekendDeadZone, usMarketPhase, usClockPhase, isUsMarketHoliday, isUsTradingDateStr,
  LONDON_SLOT_HOURS, londonHourUtcMs, usCloseUtcMs, fourHourSlots,
  lseIsOpen, euroExchangeIsOpen, foreignSessionIsOpen,
  usMarketHoursUtc, usCloseOnUtc, isUsCloseStamp, usSessionUtcMins, usOvernightRunning, isUsEarlyClose,
  usDaySession, ukTzAbbr, US_SESSION_TABLE,
} from './market_hours.js';

// Helper: a Date at the given UTC wall-clock. In January (EST, UTC-5)
// ET = UTC - 5h.
const utc = (iso) => new Date(iso);

describe('isWeekendDeadZone (EST / January)', () => {
  it('Friday before 20:00 ET → NOT dead zone (after-hours still trading)', () => {
    // Fri 2026-01-09 19:59 ET = 00:59 UTC Sat. Use 19:00 ET = 00:00 UTC Sat.
    // 2026-01-10T00:00Z is Fri 19:00 ET.
    expect(isWeekendDeadZone(utc('2026-01-10T00:00:00Z'))).toBe(false);
  });

  it('Friday at/after 20:00 ET → dead zone', () => {
    // Fri 20:00 ET = 2026-01-10T01:00Z.
    expect(isWeekendDeadZone(utc('2026-01-10T01:00:00Z'))).toBe(true);
    // Fri 23:00 ET = 2026-01-10T04:00Z.
    expect(isWeekendDeadZone(utc('2026-01-10T04:00:00Z'))).toBe(true);
  });

  it('Saturday (any time) → dead zone', () => {
    // Sat 2026-01-10 12:00 ET = 17:00 UTC.
    expect(isWeekendDeadZone(utc('2026-01-10T17:00:00Z'))).toBe(true);
    // Sat 02:00 ET = 07:00 UTC.
    expect(isWeekendDeadZone(utc('2026-01-10T07:00:00Z'))).toBe(true);
  });

  it('Sunday before 20:00 ET → dead zone', () => {
    // Sun 2026-01-11 19:00 ET = 2026-01-12T00:00Z.
    expect(isWeekendDeadZone(utc('2026-01-12T00:00:00Z'))).toBe(true);
    // Sun 10:00 ET = 15:00 UTC.
    expect(isWeekendDeadZone(utc('2026-01-11T15:00:00Z'))).toBe(true);
  });

  it('Sunday at/after 20:00 ET → NOT dead zone (overnight session reopens → fast cadence)', () => {
    // Sun 20:00 ET = 2026-01-12T01:00Z.
    expect(isWeekendDeadZone(utc('2026-01-12T01:00:00Z'))).toBe(false);
    // Sun 22:00 ET = 2026-01-12T03:00Z.
    expect(isWeekendDeadZone(utc('2026-01-12T03:00:00Z'))).toBe(false);
  });

  it('weekday overnight (Tue 02:00 ET) → NOT dead zone (fast cadence for live overnight prices)', () => {
    // Tue 2026-01-13 02:00 ET = 07:00 UTC.
    expect(isWeekendDeadZone(utc('2026-01-13T07:00:00Z'))).toBe(false);
    // sanity: usMarketPhase agrees it's overnight
    expect(usMarketPhase(utc('2026-01-13T07:00:00Z'))).toBe('overnight');
  });

  it('weekday regular session (Wed 10:00 ET) → NOT dead zone', () => {
    // Wed 2026-01-14 10:00 ET = 15:00 UTC.
    expect(isWeekendDeadZone(utc('2026-01-14T15:00:00Z'))).toBe(false);
  });
});

describe('isUsMarketHoliday — NYSE full-day closures', () => {
  // Asserted at a mid-session ET moment (15:00 UTC ≈ 10:00 ET) so a tz
  // slip would surface. Cross-checked against the published NYSE
  // holiday calendars for 2026 / 2027 / 2028.
  const atNoonET = (ymd) => new Date(`${ymd}T16:00:00Z`); // ~11-12 ET year-round

  it('flags the fixed-date + nth-weekday holidays (2026)', () => {
    const days = [
      '2026-01-01', // New Year's (Thu)
      '2026-01-19', // MLK — 3rd Mon Jan
      '2026-02-16', // Presidents — 3rd Mon Feb
      '2026-04-03', // Good Friday
      '2026-05-25', // Memorial — last Mon May
      '2026-06-19', // Juneteenth (Fri)
      '2026-07-03', // Independence observed (Jul 4 = Sat → Fri 3rd)
      '2026-09-07', // Labor — 1st Mon Sep
      '2026-11-26', // Thanksgiving — 4th Thu Nov
      '2026-12-25', // Christmas (Fri)
    ];
    for (const d of days) expect(isUsMarketHoliday(atNoonET(d)), d).toBe(true);
  });

  it('handles weekend-observance shifts (2027)', () => {
    expect(isUsMarketHoliday(atNoonET('2027-06-18'))).toBe(true); // Juneteenth Jun19=Sat → Fri 18
    expect(isUsMarketHoliday(atNoonET('2027-07-05'))).toBe(true); // July 4 = Sun → Mon 5
    expect(isUsMarketHoliday(atNoonET('2027-12-24'))).toBe(true); // Christmas Dec25=Sat → Fri 24
    expect(isUsMarketHoliday(atNoonET('2027-03-26'))).toBe(true); // Good Friday
  });

  it("does NOT pull New Year's back onto the prior Friday (Jan 1 2028 = Sat → market open Dec 31 2027)", () => {
    expect(isUsMarketHoliday(atNoonET('2027-12-31'))).toBe(false); // real trading day
    expect(isUsMarketHoliday(atNoonET('2028-01-17'))).toBe(true);  // MLK 2028 (3rd Mon)
  });

  it('does NOT flag ordinary trading days', () => {
    for (const d of ['2026-07-02', '2026-07-06', '2026-11-25', '2026-11-27', '2026-12-24', '2026-01-02']) {
      expect(isUsMarketHoliday(atNoonET(d)), d).toBe(false);
    }
  });

  it('usMarketPhase returns "overnight" (closed) during what would be RTH on a holiday', () => {
    // July 3 2026 (observed Independence Day), 14:00 UTC ≈ 10:00 ET.
    expect(usMarketPhase(new Date('2026-07-03T14:00:00Z'))).toBe('overnight');
    // Sanity: the SAME wall-clock on a normal weekday is 'regular'.
    expect(usMarketPhase(new Date('2026-07-06T14:00:00Z'))).toBe('regular'); // Mon
  });
});

describe('isUsTradingDateStr — date-string trading-day check (crypto 1D window picker)', () => {
  it('true for a weekday trading day, false for weekend + full holiday', () => {
    expect(isUsTradingDateStr('2026-07-02')).toBe(true);   // Thu — trading
    expect(isUsTradingDateStr('2026-07-03')).toBe(false);  // Fri — Independence Day observed
    expect(isUsTradingDateStr('2026-07-04')).toBe(false);  // Sat
    expect(isUsTradingDateStr('2026-07-05')).toBe(false);  // Sun
    expect(isUsTradingDateStr('2026-07-06')).toBe(true);   // Mon — trading
    expect(isUsTradingDateStr('2026-11-26')).toBe(false);  // Thanksgiving
  });
  it('accepts a longer ISO string (reads the date part) and is permissive on junk', () => {
    expect(isUsTradingDateStr('2026-07-02T20:00')).toBe(true);
    expect(isUsTradingDateStr('2026-07-04T20:00')).toBe(false);
    expect(isUsTradingDateStr('')).toBe(true);        // malformed → permissive
    expect(isUsTradingDateStr(/** @type {any} */ (null))).toBe(true);
  });
});

// ---------------------------------------------------------------------
// The four-hour London sampling grid (3M)
// ---------------------------------------------------------------------

/** UTC HH:MM of every slot on one calendar day, in order. */
const slotTimes = (day) => [
  ...LONDON_SLOT_HOURS.map(h => londonHourUtcMs(day, h)),
  usCloseUtcMs(day),
].map(ms => new Date(ms).toISOString().slice(11, 16));

describe('londonHourUtcMs / usCloseUtcMs — the grid across all four DST regimes', () => {
  // The whole point of pinning the sixth slot to the close rather than
  // writing 21:00 down: for ~3 weeks in March and ~1 week around the
  // start of November the UK and the US are in DIFFERENT regimes, and
  // the US close lands at 20:00 London, not 21:00.
  it('UK and US both on standard time: London 01/05/09/13/17 + a 21:00 close', () => {
    expect(slotTimes('2026-01-15'))
      .toEqual(['01:00', '05:00', '09:00', '13:00', '17:00', '21:00']);
    expect(slotTimes('2026-11-03'))
      .toEqual(['01:00', '05:00', '09:00', '13:00', '17:00', '21:00']);
  });

  it('UK and US both on summer time: the same London hours, an hour earlier in UTC', () => {
    // BST, so 00:00 UTC IS 01:00 London and the 20:00 UTC close IS
    // 21:00 London — a perfect four-hour grid either way.
    expect(slotTimes('2026-07-15'))
      .toEqual(['00:00', '04:00', '08:00', '12:00', '16:00', '20:00']);
  });

  it('US on summer time, UK not: the close moves to 20:00 London', () => {
    // US switches 2nd Sun March (2026-03-08), UK the last (2026-03-29).
    expect(slotTimes('2026-03-16'))
      .toEqual(['01:00', '05:00', '09:00', '13:00', '17:00', '20:00']);
    expect(slotTimes('2026-03-26'))
      .toEqual(['01:00', '05:00', '09:00', '13:00', '17:00', '20:00']);
    // UK switches back last Sun Oct (2026-10-25), US 1st Sun Nov
    // (2026-11-01) — the same mismatch, the other way round the year.
    expect(slotTimes('2026-10-26'))
      .toEqual(['01:00', '05:00', '09:00', '13:00', '17:00', '20:00']);
    expect(slotTimes('2026-10-30'))
      .toEqual(['01:00', '05:00', '09:00', '13:00', '17:00', '20:00']);
  });

  it('the first five slots are always four hours apart, in London time', () => {
    for (const day of ['2026-01-15', '2026-03-16', '2026-07-15', '2026-10-26', '2026-11-03']) {
      const ms = LONDON_SLOT_HOURS.map(h => londonHourUtcMs(day, h));
      for (let i = 1; i < ms.length; i++) expect(ms[i] - ms[i - 1]).toBe(4 * 3600_000);
    }
  });
});

describe('fourHourSlots — the grid a 3M chart samples on', () => {
  const iso = (ms) => new Date(ms).toISOString().slice(0, 16);

  it('six points a weekday, ascending, inside the window', () => {
    const start = Date.UTC(2026, 8, 14);            // Mon 14 Sep
    const end   = Date.UTC(2026, 8, 17, 22, 45);    // Thu 17 Sep 22:45
    const slots = fourHourSlots(start, end);
    expect(slots.map(iso)).toEqual([
      '2026-09-14T00:00', '2026-09-14T04:00', '2026-09-14T08:00',
      '2026-09-14T12:00', '2026-09-14T16:00', '2026-09-14T20:00',
      '2026-09-15T00:00', '2026-09-15T04:00', '2026-09-15T08:00',
      '2026-09-15T12:00', '2026-09-15T16:00', '2026-09-15T20:00',
      '2026-09-16T00:00', '2026-09-16T04:00', '2026-09-16T08:00',
      '2026-09-16T12:00', '2026-09-16T16:00', '2026-09-16T20:00',
      '2026-09-17T00:00', '2026-09-17T04:00', '2026-09-17T08:00',
      '2026-09-17T12:00', '2026-09-17T16:00', '2026-09-17T20:00',
      '2026-09-17T22:00',   // the live edge, quantised to the hour
    ]);
    for (let i = 1; i < slots.length; i++) expect(slots[i]).toBeGreaterThan(slots[i - 1]);
  });

  it('a 24/7 tape keeps the weekend, at the same four-hour step', () => {
    // Crypto's Saturday is real trading; dropping it would lose two
    // days in seven. There is no US close on a Saturday, so the sixth
    // sample is 21:00 London — 20:00 UTC under BST, which keeps the
    // step a clean four hours right through the weekend.
    const slots = fourHourSlots(Date.UTC(2026, 8, 18, 18, 0), Date.UTC(2026, 8, 21, 10, 0), true)
      .map(iso);
    expect(slots).toEqual([
      '2026-09-18T20:00',
      '2026-09-19T00:00', '2026-09-19T04:00', '2026-09-19T08:00',
      '2026-09-19T12:00', '2026-09-19T16:00', '2026-09-19T20:00',
      '2026-09-20T00:00', '2026-09-20T04:00', '2026-09-20T08:00',
      '2026-09-20T12:00', '2026-09-20T16:00', '2026-09-20T20:00',
      '2026-09-21T00:00', '2026-09-21T04:00', '2026-09-21T08:00',
      '2026-09-21T10:00',
    ]);
    // Every step across the weekend is four hours.
    const raw = fourHourSlots(Date.UTC(2026, 8, 19), Date.UTC(2026, 8, 21), true);
    for (let i = 1; i < raw.length; i++) expect(raw[i] - raw[i - 1]).toBe(4 * 3600_000);
  });

  it('the weekday and weekend grids are cached apart', () => {
    const a = fourHourSlots(Date.UTC(2026, 8, 14), Date.UTC(2026, 8, 21, 10));
    const b = fourHourSlots(Date.UTC(2026, 8, 14), Date.UTC(2026, 8, 21, 10), true);
    expect(b).not.toBe(a);
    expect(b.length).toBeGreaterThan(a.length);
    expect(fourHourSlots(Date.UTC(2026, 8, 14), Date.UTC(2026, 8, 21, 10))).toBe(a);
  });

  it('skips the weekend rather than drawing two flat days', () => {
    // Fri 18 Sep 18:00 -> Mon 21 Sep 10:00. The x axis is index-based,
    // so twelve flat weekend points would spend real chart width on a
    // stretch where every venue in the book is shut.
    const slots = fourHourSlots(Date.UTC(2026, 8, 18, 18, 0), Date.UTC(2026, 8, 21, 10, 0))
      .map(iso);
    expect(slots).toEqual([
      '2026-09-18T20:00',   // Friday's US close
      '2026-09-21T00:00', '2026-09-21T04:00', '2026-09-21T08:00',
      '2026-09-21T10:00',   // live edge
    ]);
    expect(slots.some(d => d.startsWith('2026-09-19') || d.startsWith('2026-09-20'))).toBe(false);
  });

  it('the live edge dedupes when the hour is already a slot', () => {
    // 20:00 UTC on a September weekday is both the US close and the
    // current hour; it must appear once.
    const slots = fourHourSlots(Date.UTC(2026, 8, 17, 12), Date.UTC(2026, 8, 17, 20, 30));
    expect(slots.map(iso)).toEqual(['2026-09-17T12:00', '2026-09-17T16:00', '2026-09-17T20:00']);
  });

  it('returns the same array identity within the hour, so the chart memo holds', () => {
    const a = fourHourSlots(Date.UTC(2026, 8, 14), Date.UTC(2026, 8, 17, 22, 10));
    const b = fourHourSlots(Date.UTC(2026, 8, 14), Date.UTC(2026, 8, 17, 22, 50));
    expect(b).toBe(a);
    const c = fourHourSlots(Date.UTC(2026, 8, 14), Date.UTC(2026, 8, 17, 23, 10));
    expect(c).not.toBe(a);
  });

  it('an empty or inverted window is empty', () => {
    expect(fourHourSlots(Date.UTC(2026, 8, 17), Date.UTC(2026, 8, 17))).toEqual([]);
    expect(fourHourSlots(Date.UTC(2026, 8, 17), Date.UTC(2026, 8, 16))).toEqual([]);
  });

  it('a 93-day window holds ~6 points a weekday — the density the daily grid lacked', () => {
    const end = Date.UTC(2026, 8, 17, 20, 0);
    const slots = fourHourSlots(end - 93 * 86400_000, end);
    // 93 days spans 66 weekdays here; the old daily-close grid drew one
    // point per TRADING day, ~65 for the whole window.
    expect(slots.length).toBeGreaterThan(380);
    expect(slots.length).toBeLessThan(410);
  });
});

// The weekend hole. Both foreign-exchange gates read only the clock, and
// both carried a comment arguing a weekend guard was redundant "because
// Yahoo returns no new bars then, so the dayPct stays at the previous
// trading day's close". That is exactly the failure, not a reason there
// isn't one: the stale pct is what gets painted, and with the extended-
// hours toggle on a shut exchange must read 0, not Friday's move.
//
// Measured, 2026-09-20: the board showed SAND (MBG.SG, Stuttgart) at
// +6.13% with the toggle on, at 13:01 BST on a SATURDAY. The recorder
// says its price last moved at 21:05 London on the Friday and sat at
// 2.804 for the 28 hours since — so +6.13% was Friday's move, three
// quarters of a day stale, presented as an after-hours number.
//
// 2026-09-18 is a Friday, -19 a Saturday, -20 a Sunday. 12:01 UTC is
// 13:01 London (BST) and 14:01 Paris (CEST) — inside both windows on the
// clock alone, which is the whole point.
describe('lseIsOpen / euroExchangeIsOpen — a shut exchange on a weekend', () => {
  const FRI = new Date('2026-09-18T12:01:00Z');
  const SAT = new Date('2026-09-19T12:01:00Z');
  const SUN = new Date('2026-09-20T12:01:00Z');

  it('is open mid-session on a weekday', () => {
    expect(lseIsOpen(FRI)).toBe(true);
    expect(euroExchangeIsOpen(FRI)).toBe(true);
  });

  it('is SHUT at the same clock time on Saturday and Sunday', () => {
    expect(lseIsOpen(SAT)).toBe(false);
    expect(lseIsOpen(SUN)).toBe(false);
    expect(euroExchangeIsOpen(SAT)).toBe(false);
    expect(euroExchangeIsOpen(SUN)).toBe(false);
  });

  it('still reads shut outside the window on a weekday', () => {
    // 02:45 London / 03:45 Paris on the Friday — the hours the gate
    // already got right, which must not change.
    const night = new Date('2026-09-18T01:45:00Z');
    expect(lseIsOpen(night)).toBe(false);
    expect(euroExchangeIsOpen(night)).toBe(false);
  });

  it('carries through to foreignSessionIsOpen for every held foreign listing', () => {
    // The three on the book: Stuttgart, and two London listings.
    for (const t of ['MBG.SG', 'IWDA.L', 'VWRL.L']) {
      expect(foreignSessionIsOpen(t, FRI)).toBe(true);
      expect(foreignSessionIsOpen(t, SAT)).toBe(false);
      expect(foreignSessionIsOpen(t, SUN)).toBe(false);
    }
    // A US ticker has no local session either way.
    expect(foreignSessionIsOpen('NVDA', FRI)).toBe(false);
  });
});

// The header clock's dot (Davies, 2026-10-31 01:20 UTC, a Saturday: still the night colour). usMarketPhase keeps calling these
// moments "overnight" for the refresh cadence; the dot says closed.
describe('usClockPhase', () => {
  it('the moment Davies saw: Sat 2026-10-31 01:20 UTC (Fri 21:20 EDT) is closed, though usMarketPhase says overnight', () => {
    const t = utc('2026-10-31T01:20:00Z');
    expect(usMarketPhase(t)).toBe('overnight');
    expect(usClockPhase(t)).toBe('closed');
  });
  it('all of Saturday and Sunday until 20:00 ET is closed; Sunday 20:00 ET opens the overnight session', () => {
    expect(usClockPhase(utc('2026-10-31T16:00:00Z'))).toBe('closed');      // Sat 12:00 EDT
    expect(usClockPhase(utc('2026-11-01T23:59:00Z'))).toBe('closed');      // Sun 18:59 EST
    expect(usClockPhase(utc('2026-11-02T01:00:00Z'))).toBe('overnight');   // Sun 20:00 EST
  });
  it('Friday keeps its sessions until 20:00 ET', () => {
    expect(usClockPhase(utc('2026-10-30T14:00:00Z'))).toBe('regular');     // Fri 10:00 EDT
    expect(usClockPhase(utc('2026-10-30T23:59:00Z'))).toBe('afterhours');  // Fri 19:59 EDT
    expect(usClockPhase(utc('2026-10-31T00:00:00Z'))).toBe('closed');      // Fri 20:00 EDT
  });
  it('a weekday night is overnight, as before', () => {
    expect(usClockPhase(utc('2026-10-29T03:00:00Z'))).toBe('overnight');   // Wed 23:00 EDT
    expect(usClockPhase(utc('2026-10-29T09:00:00Z'))).toBe('premarket');   // Thu 05:00 EDT
  });
  it('Thanksgiving (2026-11-26): closed from 20:00 ET the evening before until 20:00 ET on the day', () => {
    expect(usClockPhase(utc('2026-11-26T00:59:00Z'))).toBe('afterhours');  // Wed 19:59 EST
    expect(usClockPhase(utc('2026-11-26T01:00:00Z'))).toBe('closed');      // Wed 20:00 EST
    expect(usClockPhase(utc('2026-11-26T17:00:00Z'))).toBe('closed');      // Thu 12:00 EST
    expect(usClockPhase(utc('2026-11-27T01:00:00Z'))).toBe('overnight');   // Thu 20:00 EST, into Friday's session
  });
});

// Early closes (Davies, 2026-11-27 ~18:50 UTC, the day after Thanksgiving: "今天短交易日市场已经关市了，网站没识别出来"). The
// board kept 'regular' to 16:00 ET on those days; the regular session ends at 13:00 ET and the late session at 17:00. Every
// answer below is the calendar worked by hand: EST is UTC-5 (13:00 ET = 18:00 UTC, 17:00 ET = 22:00 UTC), EDT UTC-4.
describe('early closes: the session table on the day after Thanksgiving, Christmas Eve and July 3', () => {
  it('2026-11-27 (Fri, EST): regular to 13:00, after hours to 17:00, then shut for the weekend', () => {
    const at = (h, m) => utc(`2026-11-27T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
    expect(usMarketPhase(at(9, 0))).toBe('premarket');     // 04:00 ET
    expect(usMarketPhase(at(14, 30))).toBe('regular');     // 09:30 ET
    expect(usMarketPhase(at(17, 30))).toBe('regular');     // 12:30 ET
    expect(usMarketPhase(at(17, 59))).toBe('regular');     // 12:59 ET
    expect(usMarketPhase(at(18, 0))).toBe('afterhours');   // 13:00 ET, the close
    expect(usMarketPhase(at(18, 30))).toBe('afterhours');  // 13:30 ET, the moment Davies wrote
    expect(usMarketPhase(at(21, 59))).toBe('afterhours');  // 16:59 ET
    expect(usMarketPhase(at(22, 0))).toBe('overnight');    // 17:00 ET: the late sessions are closed
    expect(usMarketPhase(at(22, 30))).toBe('overnight');
    expect(usClockPhase(at(18, 30))).toBe('afterhours');
    expect(usClockPhase(at(22, 0))).toBe('closed');
    expect(usClockPhase(at(22, 30))).toBe('closed');
    expect(isWeekendDeadZone(at(21, 59))).toBe(false);
    expect(isWeekendDeadZone(at(22, 0))).toBe(true);       // the 5-minute refresh from 17:00 ET, not 20:00
    expect(usOvernightRunning(at(22, 30))).toBe(false);
    expect(usOvernightRunning(utc('2026-11-28T01:30:00Z'))).toBe(false);
    expect(isUsEarlyClose(at(12, 0))).toBe(true);
  });
  it('2026-12-24 (Thu, EST): the same hours; the evening is shut (no overnight into Christmas); 12-25 is closed', () => {
    expect(usMarketPhase(utc('2026-12-24T17:59:00Z'))).toBe('regular');
    expect(usMarketPhase(utc('2026-12-24T18:00:00Z'))).toBe('afterhours');
    expect(usMarketPhase(utc('2026-12-24T22:00:00Z'))).toBe('overnight');
    expect(usClockPhase(utc('2026-12-24T22:00:00Z'))).toBe('closed');   // 17:00 ET, the gap to the overnight
    expect(usClockPhase(utc('2026-12-25T01:30:00Z'))).toBe('closed');   // 20:30 ET, the evening before a holiday
    expect(isWeekendDeadZone(utc('2026-12-24T22:00:00Z'))).toBe(false); // a Thursday: the cadence stays fast
    expect(usClockPhase(utc('2026-12-25T15:00:00Z'))).toBe('closed');
    expect(usClockPhase(utc('2026-12-23T23:00:00Z'))).toBe('afterhours'); // Wed 18:00 ET: an ordinary day before it
  });
  it('2028-07-03 (Mon, EDT): regular to 17:00 UTC, after hours to 21:00 UTC, then shut until 07-05', () => {
    expect(usMarketPhase(utc('2028-07-03T16:59:00Z'))).toBe('regular');
    expect(usMarketPhase(utc('2028-07-03T17:00:00Z'))).toBe('afterhours');
    expect(usMarketPhase(utc('2028-07-03T20:59:00Z'))).toBe('afterhours');
    expect(usClockPhase(utc('2028-07-03T21:00:00Z'))).toBe('closed');
    expect(usClockPhase(utc('2028-07-04T01:00:00Z'))).toBe('closed');   // 21:00 EDT: no overnight into July 4
    expect(usMarketHoursUtc(utc('2028-07-03T15:00:00Z'))).toMatchObject({ closeHh: 17, closeMm: 0, edt: true, early: true });
  });
  it('an early close on a Friday holiday is no early close: 2026-07-03 is Independence Day observed', () => {
    expect(usDaySession(2026, 7, 3)).toMatchObject({ trading: false, early: false });
    expect(usClockPhase(utc('2026-07-03T15:00:00Z'))).toBe('closed');
    expect(usDaySession(2026, 7, 2)).toMatchObject({ trading: true, early: false, close: 960, post: 1200 });
  });
});

describe("each day's own close: usMarketHoursUtc, usCloseOnUtc, isUsCloseStamp, usSessionUtcMins", () => {
  it("today's close is 18:00 UTC on the half day, and each date keeps its own", () => {
    const mh = usMarketHoursUtc(utc('2026-11-27T18:30:00Z'));
    expect(mh).toMatchObject({ openHh: 14, openMm: 30, closeHh: 18, closeMm: 0, edt: false, early: true });
    expect(usCloseOnUtc('2026-11-27')).toEqual({ hh: 18, mm: 0 });
    expect(usCloseOnUtc('2026-11-25')).toEqual({ hh: 21, mm: 0 });
    expect(usCloseOnUtc('2026-11-26')).toBeNull();               // Thanksgiving
    expect(usCloseOnUtc('2026-11-28')).toBeNull();               // Saturday
    expect(usCloseOnUtc('2026-10-30')).toEqual({ hh: 20, mm: 0 }); // the Friday before the US clocks change
    expect(usCloseOnUtc('2026-11-02')).toEqual({ hh: 21, mm: 0 }); // the Monday after
    expect(usCloseUtcMs('2026-11-27')).toBe(Date.UTC(2026, 10, 27, 18));
    expect(usCloseUtcMs('2026-12-24')).toBe(Date.UTC(2026, 11, 24, 18));
  });
  it('the close bar is matched on its own day: Friday 18:00 is one, Friday 21:00 (a late-session bar) is not', () => {
    const mh = usMarketHoursUtc(utc('2026-11-30T12:00:00Z'));    // the Monday after, before the open: today's close 21:00
    expect(isUsCloseStamp('2026-11-27T18:00', mh)).toBe(true);
    expect(isUsCloseStamp('2026-11-27T21:00', mh)).toBe(false);
    expect(isUsCloseStamp('2026-11-25T21:00', mh)).toBe(true);
    expect(isUsCloseStamp('2026-11-26T21:00', mh)).toBe(false);  // a holiday has no close (a coin prints there)
    expect(isUsCloseStamp('2026-11-28T21:00', mh)).toBe(false);
    expect(isUsCloseStamp('2026-10-30T20:00', mh)).toBe(true);   // across the DST change: 16:00 EDT
    expect(isUsCloseStamp('2026-10-30T21:00', mh)).toBe(false);  // 17:00 EDT is not a close
    // A bare { closeHh, closeMm } is one fixed time, as before.
    expect(isUsCloseStamp('2026-11-28T21:00', { closeHh: 21, closeMm: 0 })).toBe(true);
  });
  it('usSessionUtcMins gives the session of the bars\' own day', () => {
    const today = usMarketHoursUtc(utc('2026-11-28T15:00:00Z')); // a Saturday reading Friday's bars
    expect(usSessionUtcMins('2026-11-27T21:55', today)).toEqual({ openMins: 14 * 60 + 30, closeMins: 18 * 60 });
    expect(usSessionUtcMins('2026-10-30T19:00', today)).toEqual({ openMins: 13 * 60 + 30, closeMins: 20 * 60 });
    expect(usSessionUtcMins(null, today)).toEqual({ openMins: 14 * 60 + 30, closeMins: 21 * 60 });
    expect(usSessionUtcMins('2026-11-28T10:00', today)).toEqual({ openMins: 14 * 60 + 30, closeMins: 21 * 60 });
  });
  it('the 3M grid samples the half day at its 13:00 ET close', () => {
    const slots = fourHourSlots(Date.UTC(2026, 10, 27, 0), Date.UTC(2026, 10, 27, 23, 30));
    expect(slots.map((ms) => new Date(ms).toISOString().slice(11, 16))).toEqual(['01:00', '05:00', '09:00', '13:00', '17:00', '18:00', '23:00']);
  });
});

describe('the session table: one row, 23/5 not live', () => {
  it('holds the times every consumer reads, in ET minutes', () => {
    expect(US_SESSION_TABLE).toHaveLength(1);
    expect(US_SESSION_TABLE[0]).toMatchObject({
      premarket: 240, open: 570, close: 960, post: 1200, earlyClose: 780, earlyPost: 1020, overnight: 1200,
    });
    // 2026-12-06, the 23/5 target date, still reads as today's market: the overnight opens Sunday 20:00 ET.
    expect(usClockPhase(utc('2026-12-07T00:59:00Z'))).toBe('closed');     // Sun 19:59 EST
    expect(usClockPhase(utc('2026-12-07T01:00:00Z'))).toBe('overnight');  // Sun 20:00 EST
    expect(usClockPhase(utc('2026-12-08T01:30:00Z'))).toBe('overnight');  // Mon 20:30 EST: no pause yet
  });
});

describe('the holidays ahead render closed, and the DST weeks keep their hours', () => {
  it.each([
    ['2026-12-25', 'Christmas'], ['2027-01-01', "New Year's Day"], ['2027-01-18', 'Martin Luther King Jr. Day'],
    ['2027-02-15', "Presidents' Day"], ['2027-03-26', 'Good Friday'],
  ])('%s (%s) is closed at 15:00 UTC, and its morning is no pre-market', (day) => {
    expect(usClockPhase(utc(`${day}T15:00:00Z`))).toBe('closed');
    expect(usMarketPhase(utc(`${day}T15:00:00Z`))).toBe('overnight');
    expect(usMarketPhase(utc(`${day}T11:00:00Z`))).toBe('overnight');
    expect(isUsTradingDateStr(day)).toBe(false);
  });
  it('the weeks the US and the UK are on different clocks: the close in UTC and London\'s label', () => {
    // US on EDT, UK still GMT (2027-03-14 to 03-28): 16:00 EDT = 20:00 UTC = 20:00 London.
    expect(usMarketHoursUtc(utc('2027-03-15T15:00:00Z'))).toMatchObject({ openHh: 13, openMm: 30, closeHh: 20, edt: true });
    expect(ukTzAbbr(utc('2027-03-15T15:00:00Z'))).toBe('GMT');
    expect(usMarketPhase(utc('2027-03-15T13:30:00Z'))).toBe('regular');
    expect(usMarketPhase(utc('2027-03-15T20:00:00Z'))).toBe('afterhours');
    // UK on GMT since 2026-10-25, US on EDT to 11-01: the same.
    expect(usMarketHoursUtc(utc('2026-10-27T15:00:00Z'))).toMatchObject({ closeHh: 20, edt: true });
    expect(ukTzAbbr(utc('2026-10-27T15:00:00Z'))).toBe('GMT');
    // From 2026-11-02 both on standard time: 21:00.
    expect(usMarketHoursUtc(utc('2026-11-02T15:00:00Z'))).toMatchObject({ closeHh: 21, edt: false });
    expect(usMarketPhase(utc('2026-11-02T14:29:00Z'))).toBe('premarket');
  });
});

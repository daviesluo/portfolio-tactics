// The board's US market calendar against the server's, day by day.
//
// The client (`market_hours.js`) and the Edge Functions
// (`supabase/functions/_shared/us_market_calendar.ts`) run in different
// runtimes, so each keeps its own copy of the holiday and early-close rules
// and of the session times. Until 2026-11-27 only the server knew the early
// closes, and the board kept 'regular' to 16:00 on the day after
// Thanksgiving while the market had closed at 13:00 (Davies, that afternoon:
// "今天短交易日市场已经关市了，网站没识别出来"). This test imports both and
// compares them on every day of 2025-2030: a change made on one side alone
// fails here.

import { describe, it, expect } from 'vitest';
import {
  isUsMarketHolidayYmd, isUsEarlyCloseYmd, usDaySession, US_SESSION_TABLE,
} from './market_hours.js';
// The server's module itself, transpiled by Vite as the bundle's own TypeScript would be (tsc is not asked to allow a `.ts`
// import from JS for one test).
// @ts-ignore
import * as S from '../../supabase/functions/_shared/us_market_calendar.ts';

/** Every calendar day of the years, as [y, m, d]. */
function* days(fromYear, toYear) {
  for (let t = Date.UTC(fromYear, 0, 1); t < Date.UTC(toYear + 1, 0, 1); t += 86400e3) {
    const at = new Date(t);
    yield [at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate()];
  }
}

describe('the client calendar is the server calendar', () => {
  it('holiday, early close and the day\'s close agree on every day of 2025-2030', () => {
    let n = 0, holidays = 0, early = 0;
    const off = [];
    for (const [y, m, d] of days(2025, 2030)) {
      n++;
      const hc = isUsMarketHolidayYmd(y, m, d), hs = S.isUsMarketHolidayYmd(y, m, d);
      const ec = isUsEarlyCloseYmd(y, m, d), es = S.isUsEarlyCloseYmd(y, m, d);
      // The server's close for that day, read the way the price function reads a candle's: noon ET on the day.
      const noonEt = Math.floor(Date.UTC(y, m - 1, d, 17) / 1000);
      const cs = S.usRegularCloseMin(noonEt, -5 * 3600);
      const s = usDaySession(y, m, d);
      const cc = s.trading ? s.close : null;
      if (hc !== hs || ec !== es || (cc != null && cc !== cs)) off.push(`${y}-${m}-${d}: client ${hc}/${ec}/${cc} server ${hs}/${es}/${cs}`);
      if (hc) holidays++;
      if (s.early) early++;
    }
    expect(off).toEqual([]);
    expect(n).toBe(2191);
    // Ten holidays a year (a Saturday one recorded on its observed Friday and on the Saturday too), and the early closes
    // listed below.
    expect(holidays).toBeGreaterThanOrEqual(60);
    expect(early).toBe(14);
  });

  it('the session times are the same table', () => {
    const { from, ...client } = US_SESSION_TABLE[US_SESSION_TABLE.length - 1];
    expect(typeof from).toBe('string');
    expect(client).toEqual({ ...S.US_SESSION });
    expect(S.US_REGULAR_CLOSE_MIN).toBe(client.close);
    expect(S.US_EARLY_CLOSE_MIN).toBe(client.earlyClose);
    expect(S.US_REGULAR_OPEN_MIN).toBe(client.open);
  });

  it('the early closes: NYSE\'s published ones for 2025-2028, the rule carried on to 2030, and no other day', () => {
    const list = [];
    for (const [y, m, d] of days(2025, 2030)) if (usDaySession(y, m, d).early) list.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    expect(list).toEqual([
      '2025-07-03', '2025-11-28', '2025-12-24',
      '2026-11-27', '2026-12-24',
      '2027-11-26',
      '2028-07-03', '2028-11-24',
      '2029-07-03', '2029-11-23', '2029-12-24',
      '2030-07-03', '2030-11-29', '2030-12-24',
    ]);
  });
});

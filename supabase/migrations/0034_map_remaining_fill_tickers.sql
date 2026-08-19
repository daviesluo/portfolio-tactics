-- The last three T212 codes with no Yahoo ticker.
--
-- `[•]` did `MBGd_EQ` and `BF_B_US_EQ`. Three were left, and the
-- transaction history is why they matter now: it lists trades for
-- holdings the board no longer carries, so a closed round trip with no
-- ticker is a stretch of history that simply isn't there.
--
--   AIRp_EQ 8 fills  — Airbus on Euronext Paris. The `p` suffix has
--                         no derivation rule; named in the alias table.
--   SGLN_EQ 2 fills  — an LSE […] ETF with no exchange letter at
--                         all, so neither generic rule reaches it.
--   IS15l_EQ 6 fills  — iShares £ Corp Bond 0-5yr on the LSE. The `l`
--                         rule matched letters only and a digit in the
--                         ticker skipped it; the rule accepts digits now.
--
-- All three net to zero: closed positions, no bearing on any holding.
--
-- Fixed in `t212TickerToYahoo`, but the backfill re-upserts only the
-- pages it visits, so rows already stored keep the null they were
-- written with. This maps them in place.
--
-- Idempotent — only rows whose ticker is still null. Applied by
-- `migrations.yml` on push to main; do NOT also run it by hand.

update public.t212_orders
set ticker = 'AIR.PA'
where ticker is null and t212_ticker = 'AIRp_EQ';

update public.t212_orders
set ticker = 'SGLN.L'
where ticker is null and t212_ticker = 'SGLN_EQ';

update public.t212_orders
set ticker = 'IS15.L'
where ticker is null and t212_ticker = 'IS15l_EQ';

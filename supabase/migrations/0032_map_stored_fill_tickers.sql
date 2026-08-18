-- Give the already-stored fills the tickers the shaper has since learned.
--
-- `t212_orders` records both T212's internal code and the Yahoo ticker it
-- resolved to. Two codes resolved to nothing:
--
--   MBGd_EQ [•] fills, net [•] shares — exactly the board's MBG.SG
--                 position. The `d` suffix has no derivation rule, so the
--                 entire history of that holding was invisible.
--   BF_B_US_EQ [•] fills — a share class, which T212 separates with an
--                 underscore and Yahoo with a hyphen. The generic
--                 `_US_EQ` rule didn't match the code at all.
--
-- Both are fixed in `t212TickerToYahoo`, but the backfill walks BACKWARD
-- and upserts only the pages it visits, so rows already stored keep the
-- null they were written with. This maps them in place.
--
-- `AIRp_EQ` ([•] fills, net [•]) is deliberately left alone: nothing on the
-- board corresponds to it and guessing its exchange suffix would be
-- inventing a mapping rather than correcting one.
--
-- Idempotent — it only touches rows whose ticker is still null. Applied
-- by `migrations.yml` on push to main; do NOT also run it by hand.

update public.t212_orders
set ticker = 'MBG.SG'
where ticker is null and t212_ticker = 'MBGd_EQ';

update public.t212_orders
set ticker = 'BF-B'
where ticker is null and t212_ticker = 'BF_B_US_EQ';

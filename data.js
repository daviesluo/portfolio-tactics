// Initial portfolio data — seeds localStorage on first load.
// Positions map to football roles; each holding has ticker + shares + avg cost.
window.INITIAL_PORTFOLIO = {
  positions: {
    GK:   { label: "GK",  subtitle: "Cash",          role: "GK",  tickers: ["CASH"] },
    CB1:  { label: "CB",  subtitle: "",              role: "DEF", tickers: [] },
    CB2:  { label: "CB",  subtitle: "",          role: "DEF", tickers: [] },
    LB:   { label: "LB",  subtitle: "Entertainment", role: "DEF", tickers: [] },
    RB:   { label: "RB",  subtitle: "Finance",       role: "DEF", tickers: [] },
    CDM:  { label: "CDM", subtitle: "Electric Power",role: "MID", tickers: [] },
    CM:   { label: "CM",  subtitle: "BIG 7",         role: "MID", tickers: ["NVDA","GOOG","META","MSFT","AMZN"] },
    CAM:  { label: "CM",  subtitle: "AI Infra",      role: "MID", tickers: ["TSM","NVTS","MU"] },
    LW:   { label: "LW",  subtitle: "BTC",           role: "FWD", tickers: ["MSTR","BTC-USD","HOOD","BMNR"] },
    ST:   { label: "ST",  subtitle: "Neocloud",      role: "FWD", tickers: ["APLD","NBIS"] },
    RW:   { label: "RW",  subtitle: "Space",         role: "FWD", tickers: ["SPAX.PVT","RKLB"] },
  },
  holdings: {
    "CASH":     { shares: 0, cost: 0, lastPrice: 0,      dayPct: 0,      prevClose: 0,      isCash: true },
    "NVDA":     { shares: 0, cost: 0, lastPrice: 201.63, dayPct: -0.20,  prevClose: 202.03 },
    "APLD":     { shares: 0, cost: 0, lastPrice: 32.22,  dayPct: +0.14,  prevClose: 32.18 },
    "NBIS":     { shares: 0, cost: 0, lastPrice: 161.42, dayPct: +1.42,  prevClose: 159.16 },
    "GOOG":     { shares: 0, cost: 0, lastPrice: 335.21, dayPct: -0.06,  prevClose: 335.41 },
    "SPAX.PVT": { shares: 0, cost: 0, lastPrice: 610.67, dayPct: 0.00,   prevClose: 610.66 },
    "META":     { shares: 0, cost: 0, lastPrice: 672.95, dayPct: +0.30,  prevClose: 670.91 },
    "MSFT":     { shares: 0, cost: 0, lastPrice: 425.79, dayPct: +1.85,  prevClose: 418.05 },
    "MSTR":     { shares: 0, cost: 0, lastPrice: 170.10, dayPct: -0.42,  prevClose: 170.82 },
    "AMZN":     { shares: 0, cost: 0, lastPrice: 252.57, dayPct: +1.75,  prevClose: 248.23 },
    "RKLB":     { shares: 0, cost: 0, lastPrice: 89.60,  dayPct: +0.16,  prevClose: 89.46 },
    "BTC-USD":  { shares: 0, cost: 0, lastPrice:75928.01,dayPct: +0.24,  prevClose: 75746.90 },
    "HOOD":     { shares: 0, cost: 0, lastPrice: 88.24,  dayPct: -3.33,  prevClose: 91.28 },
    "TSM":      { shares: 0, cost: 0, lastPrice: 368.44, dayPct: +0.60,  prevClose: 366.24 },
    "NVTS":     { shares: 0, cost: 0, lastPrice: 15.98,  dayPct: +21.06, prevClose: 13.20 },
    "MU":       { shares: 0, cost: 0, lastPrice: 445.42, dayPct: -0.68,  prevClose: 448.47 },
    "BMNR":     { shares: 0, cost: 0, lastPrice: 22.59,  dayPct: +0.27,  prevClose: 22.53 },
  },
};

// Per-lot purchase history. Keyed by ticker. Each lot: { date, shares, cost }.
// Used to backfill `lots` on holdings that don't have it yet, so the YTD chart
// can compute true historical portfolio value at each trading day.
// Tickers not listed here default to a single lot dated 2025-01-01.
window.INITIAL_LOTS = {};

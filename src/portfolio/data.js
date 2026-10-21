// Demo portfolio — shown only when the real board cannot be loaded, and the
// source of the default position labels `migrate()` restores. Positions map
// to football roles; each holding has ticker + shares + avg cost. The share
// counts and costs are FICTIONAL round numbers (ten shares, cost at 80 % of
// the listed price), not anyone's holdings: this file ships inside the
// public bundle.
export const INITIAL_PORTFOLIO = {
  positions: {
    GK:   { label: "GK",  subtitle: "Cash",          role: "GK",  tickers: ["CASH"] },
    CB1:  { label: "CB",  subtitle: "",              role: "DEF", tickers: [] },
    CB2:  { label: "CB",  subtitle: "",          role: "DEF", tickers: [] },
    LB:   { label: "LB",  subtitle: "Entertainment", role: "DEF", tickers: [] },
    RB:   { label: "RB",  subtitle: "Finance",       role: "DEF", tickers: [] },
    CDM:  { label: "CDM", subtitle: "Electric Power",role: "MID", tickers: [] },
    CM:   { label: "CM",  subtitle: "BIG 7",         role: "MID", tickers: ["NVDA","GOOGL","META","MSFT","AMZN"] },
    CAM:  { label: "CM",  subtitle: "AI Infra",      role: "MID", tickers: ["TSM","NVTS","MU"] },
    LW:   { label: "LW",  subtitle: "BTC",           role: "FWD", tickers: ["MSTR","BTC-USD","HOOD","BMNR"] },
    ST:   { label: "ST",  subtitle: "Neocloud",      role: "FWD", tickers: ["APLD","NBIS"] },
    RW:   { label: "RW",  subtitle: "Space",         role: "FWD", tickers: ["SPAX.PVT","RKLB"] },
  },
  holdings: {
    "CASH":     { shares: 1,    cost: 0,        lastPrice: 0,        dayPct: 0,      prevClose: 0, isCash: true },
    "NVDA":     { shares: 10,   cost: 161.30,   lastPrice: 201.63,   dayPct: -0.20,  prevClose: 202.03 },
    "APLD":     { shares: 10,   cost: 25.78,    lastPrice: 32.22,    dayPct: +0.14,  prevClose: 32.18 },
    "NBIS":     { shares: 10,   cost: 129.14,   lastPrice: 161.42,   dayPct: +1.42,  prevClose: 159.16 },
    "GOOGL":    { shares: 10,   cost: 268.17,   lastPrice: 335.21,   dayPct: -0.06,  prevClose: 335.41 },
    "SPAX.PVT": { shares: 10,   cost: 488.54,   lastPrice: 610.67,   dayPct: 0.00,   prevClose: 610.66 },
    "META":     { shares: 10,   cost: 538.36,   lastPrice: 672.95,   dayPct: +0.30,  prevClose: 670.91 },
    "MSFT":     { shares: 10,   cost: 340.63,   lastPrice: 425.79,   dayPct: +1.85,  prevClose: 418.05 },
    "MSTR":     { shares: 10,   cost: 136.08,   lastPrice: 170.10,   dayPct: -0.42,  prevClose: 170.82 },
    "AMZN":     { shares: 10,   cost: 202.06,   lastPrice: 252.57,   dayPct: +1.75,  prevClose: 248.23 },
    "RKLB":     { shares: 10,   cost: 71.68,    lastPrice: 89.60,    dayPct: +0.16,  prevClose: 89.46 },
    "BTC-USD":  { shares: 0.1,  cost: 60742.41, lastPrice: 75928.01, dayPct: +0.24,  prevClose: 75746.90 },
    "HOOD":     { shares: 10,   cost: 70.59,    lastPrice: 88.24,    dayPct: -3.33,  prevClose: 91.28 },
    "TSM":      { shares: 10,   cost: 294.75,   lastPrice: 368.44,   dayPct: +0.60,  prevClose: 366.24 },
    "NVTS":     { shares: 10,   cost: 12.78,    lastPrice: 15.98,    dayPct: +21.06, prevClose: 13.20 },
    "MU":       { shares: 10,   cost: 356.34,   lastPrice: 445.42,   dayPct: -0.68,  prevClose: 448.47 },
    "BMNR":     { shares: 10,   cost: 18.07,    lastPrice: 22.59,    dayPct: +0.27,  prevClose: 22.53 },
  },
};


// The "Target price" page's Key risks column: a few words per holding, kept by hand (Davies, 2026-10-21, who gave the first
// five as the style, then asked for every holding), served by the `targets` GET (the hand-kept HAND_RISKS.json, else the
// copy baked into the function, supabase/functions/targets/baked_risks.ts; never in this bundle since 2026-11-09, which
// named every holding the notes were written for to every visitor). Keyed by the ticker the page shows (`displayTicker`:
// SAND, not MBG.SG).
//
// Each note is a string, or a function of the row for a figure that must stay true as the price moves (RKLB's lowest
// target against its price is computed, never written down). A note tied to a date carries `until` (a New York date,
// YYYY-MM-DD): it is shown through that day and drops out after it, so an investor day or an earnings date never
// lingers once it has passed. To change a note, edit HAND_RISKS.json (or the baked copy); the page has no editor.

/**
 * @typedef {{ low: number | null, price: number | null, lowVsPrice: number | null }} RiskRow
 * @typedef {{ text: string | ((row: RiskRow) => string | null), until?: string }} RiskNote
 */

/** @param {number} n */
const usd = (n) => `$${n >= 100 ? Math.round(n).toLocaleString('en-US') : Number(n.toFixed(2)).toString()}`;

/**
 * RKLB's computed note: its lowest target against the price, from the row, so it stays true as the price moves. The
 * hand-kept file names it by the placeholder "@lowest-target".
 * @param {RiskRow} r
 */
export function lowestTargetNote(r) {
  if (r.low == null || r.lowVsPrice == null) return null;
  const pct = Math.round(Math.abs(r.lowVsPrice));
  return r.lowVsPrice >= 0 ? `lowest target ${usd(r.low)} still ${pct}% above price` : `lowest target ${usd(r.low)} ${pct}% below price`;
}


/**
 * Today's date in New York, YYYY-MM-DD.
 * @param {number} nowMs
 */
export function nyDate(nowMs) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(nowMs);
}

/**
 * The notes for one holding as shown on `nowMs`, joined with "; ", or "" when it has none.
 * @param {string} display @param {RiskRow} row @param {number} nowMs @param {Record<string, RiskNote[]>} [map]
 */
export function risksFor(display, row, nowMs, map = {}) {
  const today = nyDate(nowMs);
  const parts = [];
  for (const n of map[display] || []) {
    if (n.until && today > n.until) continue;
    const t = typeof n.text === 'function' ? n.text(row) : n.text;
    if (t) parts.push(t);
  }
  return parts.join('; ');
}

/**
 * The Key risks the `targets` GET serves from the `hand-targets` branch (`{TICKER: [{text, until?}]}`, checked by the
 * function, hand.ts), as notes for `risksFor`: the "@lowest-target" placeholder becomes RKLB's computed note. Null for
 * anything not that shape: the page then shows no notes.
 * @param {unknown} served
 * @returns {Record<string, RiskNote[]> | null}
 */
export function risksFromServed(served) {
  if (!served || typeof served !== 'object' || Array.isArray(served)) return null;
  /** @type {Record<string, RiskNote[]>} */
  const out = {};
  for (const [ticker, notes] of Object.entries(served)) {
    if (!Array.isArray(notes)) return null;
    out[ticker] = [];
    for (const n of notes) {
      if (!n || typeof n.text !== 'string') return null;
      /** @type {RiskNote} */
      const note = { text: n.text === '@lowest-target' ? lowestTargetNote : n.text };
      if (typeof n.until === 'string') note.until = n.until;
      out[ticker].push(note);
    }
  }
  return Object.keys(out).length ? out : null;
}


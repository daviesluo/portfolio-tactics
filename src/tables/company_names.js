// Company names, ticker → name: the Holding list's secondary line, the sector list and the ticker modal. Filled from the
// `load` answer's `names` (`setCompanyNames`, portfolio_remote.js), which the `data` function sends for the holdings it
// sends (supabase/functions/data/company_names.ts): the map named every holding the book ever had, and while it lived
// here the bundle carried it to every visitor (until 2026-11-09). A ticker without one shows "--".
/** @type {Record<string, string>} */
export const COMPANY_NAMES = {};

/**
 * Replace the names with `names` (a `load` answer's), keeping the one object every reader holds.
 * @param {unknown} names
 */
export function setCompanyNames(names) {
  for (const k of Object.keys(COMPANY_NAMES)) delete COMPANY_NAMES[k];
  if (!names || typeof names !== 'object' || Array.isArray(names)) return;
  for (const [t, n] of Object.entries(names)) if (typeof n === 'string' && n) COMPANY_NAMES[t] = n;
}

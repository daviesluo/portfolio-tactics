// The board's slots fed by a private module, as the public mirror carries them: this copy holds no strategies and no
// slot is fed. The real module and its records are not part of this repository; this stub keeps the names the board imports,
// each answering "none", so the board, its charts and its cards build and run without it.

/** The holdings the private module feeds: none here. */
export const BOARD_STRATEGIES = /** @type {ReadonlyArray<{ ticker: string, slot: string, name: string }>} */ ([]);

/** Whether a ticker is one of those holdings: never, here. @param {string | null | undefined} _t */
export const isBoardStrategy = (_t) => false;

/** The holdings in an answer: none. @param {any} _body @returns {any[]} */
export function boardStrategiesOf(_body) {
  return [];
}

/**
 * The board with those holdings added: the board as it is.
 * @template P
 * @param {P} portfolio @param {any[] | null | undefined} _strategies
 * @returns {P}
 */
export function withBoardStrategies(portfolio, _strategies) {
  return portfolio;
}

/**
 * A holding's money as its cards would show it. Never called here, as no holding is one; it reads its value as any card does.
 * @param {{ shares: number, lastPrice: number }} h @param {number} fx
 */
export function strategyMoney(h, fx) {
  return { valueUsd: Number(h.shares) * Number(h.lastPrice) * fx, deployedUsd: null, deployedPct: null };
}

/** The holdings now: none, and nothing is asked of any server. @param {typeof fetch} [_fetchImpl] @returns {Promise<any[]>} */
export async function fetchBoardStrategies(_fetchImpl) {
  return [];
}

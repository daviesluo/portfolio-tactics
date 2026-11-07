// The board's slots fed by a private module, as the public mirror carries them: this copy holds no strategies and no
// slot is fed. The real module and its records are not part of this repository; this stub keeps the names the `prices` and
// `chart` functions import, each answering "none", so both run without it.

/** The holdings the private module feeds: none here. */
export const BOARD_STRATEGIES: ReadonlyArray<{ ticker: string; slot: string; name: string; key: string }> = [];

/** Whether a ticker is one of those holdings: never, here. */
export function isBoardStrategyTicker(_t: string): boolean {
  return false;
}

type Rest = { url: string; key: string; fetchImpl?: typeof fetch };

/** The holdings now (`prices?action=strategies`): none, and nothing is read. */
export function readBoardStrategies(_r: Rest): Promise<unknown[]> {
  return Promise.resolve([]);
}

/** A holding's chart (`chart`): none. */
export function readStrategyChart(_r: Rest, _ticker: string, _range: string, _interval: string, _nowMs: number): Promise<Array<{ date: string; close: number }> | null> {
  return Promise.resolve(null);
}

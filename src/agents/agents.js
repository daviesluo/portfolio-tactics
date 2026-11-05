// The Agents page's data module as the public mirror carries it: the app warms the page's data at
// start, and this stub has none to fetch. See agents.jsx beside it.

/** The real module fetches the page's dashboard ahead of the first open; the stub has nothing to fetch. */
export function prefetchAgentsDashboard() {
  return Promise.resolve();
}

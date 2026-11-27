// Vite entry — imports App and mounts it. All cross-module wiring is now
// done via standard ES imports inside each module; the legacy `window.X`
// bridge (setup.js, side-effect imports) is gone.
import React from 'react';
import { createRoot } from 'react-dom/client';
import './fonts.css';
import './styles.css';
// DAY-MODE: the light themes, as values of the tokens the sheet above defines.
import './themes.css';
import App from './app.jsx';
import { applyStoredTheme, watchSystemTheme } from './theme_pref.js';
import { reportError } from './ops_error.js';
import { healRejection, installStylesheetRecovery } from './chunk_recovery.js';

// Catch async failures the React ErrorBoundary can't see — unhandled
// Promise rejections from `useEffect` fetches, JSON parse errors in
// `.then()` chains, etc. Without this they just `console.error` and
// vanish; routing through `reportError` puts them in the same
// ops_errors stream as render crashes so the badge surfaces them.
// keepalive on the report fetch survives a tab-close after the error.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e?.reason;
    const msg = reason?.message ?? String(reason ?? 'unhandledrejection');
    // A chunk that failed to load is not an application bug: it is a browser
    // holding a cached copy of the HTML shell under a script's name. Heal it
    // and report it as chunk.load, the same as a click on a dead page — see
    // chunk_recovery.js and the 2026-09-21 incident it was written for.
    healRejection(reason).then((healed) => {
      if (!healed) reportError('promise.unhandled', { message: msg });
    }).catch(() => reportError('promise.unhandled', { message: msg }));
  });
}

// A lazy page's stylesheet that fails to load is asked for again on its own, so the page is never drawn without it
// (chunk_recovery.js, 2026-11-27).
if (typeof window !== 'undefined') installStylesheetRecovery(window);

// DAY-MODE: the theme was drawn before the first paint by the build's own script (app/theme_build.js); drawing the
// stored choice again here costs nothing and covers a visit on which that script did not arrive. Then the page
// follows the device while the choice is Auto.
applyStoredTheme();
watchSystemTheme();

createRoot(/** @type {HTMLElement} */ (document.getElementById('root'))).render(
  // StrictMode double-renders effects in dev to surface missing-cleanup
  // bugs (most often in `useEffect` fetches). Prod builds run it once;
  // wrapping costs nothing there and surfaces issues during dev that
  // would otherwise only appear under load.
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

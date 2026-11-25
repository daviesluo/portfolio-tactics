// DAY-MODE: the theme this browser chose, kept in `dp.prefs` beside hide-values (`theme`, and `lightTheme`, the light
// theme 'system' draws by day), and the page drawn from it. The rule itself is app/theme.js's; the first paint of a
// visit is the boot script's (app/theme_build.js), which reads the same two keys.
import { Storage } from './storage.js';
import { LIGHT_IDS, barOf, paintTheme, resolveTheme } from './theme.js';

const SYSTEM_LIGHT = '(prefers-color-scheme: light)';
const systemLight = () => typeof matchMedia === 'function' && matchMedia(SYSTEM_LIGHT).matches;

/**
 * The stored choice: 'dark' (also for nothing stored, or a theme since dropped), 'system', or a light theme's id; and
 * the light theme 'system' draws.
 * @returns {{ theme: string, lightTheme: string }}
 */
export function loadThemePref() {
  const p = Storage.loadPrefs() || {};
  const theme = p.theme === 'system' || LIGHT_IDS.includes(p.theme) ? p.theme : 'dark';
  const lightTheme = LIGHT_IDS.includes(p.lightTheme) ? p.lightTheme : LIGHT_IDS[0];
  return { theme, lightTheme };
}

/** Draws the stored choice on this page. @returns {string} the theme drawn */
export function applyStoredTheme() {
  const { theme, lightTheme } = loadThemePref();
  const drawn = resolveTheme(theme, lightTheme, systemLight(), LIGHT_IDS);
  paintTheme(document, drawn, barOf(drawn));
  return drawn;
}

/**
 * Stores a choice and draws it. A light theme is also remembered as the one 'system' draws by day. The other
 * preferences in the bag are kept: a bare save of these two keys would un-hide a hidden book.
 * @param {string} pick  'dark', 'system' or a light theme's id
 * @returns {{ theme: string, lightTheme: string }}
 */
export function saveThemePref(pick) {
  const theme = pick === 'system' || LIGHT_IDS.includes(pick) ? pick : 'dark';
  const before = loadThemePref();
  const lightTheme = LIGHT_IDS.includes(theme) ? theme : before.lightTheme;
  Storage.savePrefs({ ...Storage.loadPrefs(), theme, lightTheme });
  applyStoredTheme();
  return { theme, lightTheme };
}

/**
 * While the choice is 'system', the page follows the device when it turns light or dark with the page open. Called
 * once, as the app starts.
 */
export function watchSystemTheme() {
  if (typeof matchMedia !== 'function') return;
  const mq = matchMedia(SYSTEM_LIGHT);
  const onChange = () => { if (loadThemePref().theme === 'system') applyStoredTheme(); };
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
}

// DAY-MODE (2026-11-25; Davies: "I want a day mode for the website ... give several different designs for me to
// choose from"; of the four he kept Daylight and Ink: "b和d都留下吧可选 ... 其他的删了"). The themes by name, and the one rule that picks which is drawn. The dark theme is the site as it has
// always been and has no name on the page: <html> carries `data-theme` only for a light one, so nothing a light theme
// adds (app/themes.css, the end of agents/agents.css) can reach it.
//
// The choice is `dp.prefs.theme` (app/theme_pref.js): 'dark', a light theme's id, or 'system', which follows the
// device and draws `dp.prefs.lightTheme` by day. Nothing here touches storage or the page by itself, because the same
// two functions run twice: in the app, and before the first paint, as the text of a small classic script the build
// writes from them (`bootSource`, app/theme_build.js). One rule, not two copies of it.

/**
 * The light themes, in the order the menu shows them. `bar` is the theme's page colour, for the browser's own bar
 * (`<meta name="theme-color">`); app/themes.test.js holds it to the `--bg` of the theme's block in app/themes.css.
 * To drop one, delete its entry here and its two blocks of CSS, and name it in `RETIRED_THEMES`.
 * @type {ReadonlyArray<{ id: string, name: string, bar: string }>}
 */
export const LIGHT_THEMES = Object.freeze([
  { id: 'daylight', name: 'Daylight', bar: '#f1f4f2' },
  { id: 'ink', name: 'Ink', bar: '#fbfaf5' },
]);
/**
 * The themes that were offered and dropped (Chalk Paper and Sage, 2026-11-25), each with the one a browser that had
 * chosen it is shown instead: Daylight. Without this a stored 'paper' or 'sage' would read as unknown, and a day mode
 * someone picked would turn dark on the day the theme went.
 * @type {Readonly<Record<string, string>>}
 */
export const RETIRED_THEMES = Object.freeze({ paper: 'daylight', sage: 'daylight' });
/** A stored theme name as it stands today: a retired one's replacement, anything else as it is. @param {unknown} v @returns {unknown} */
export const themeNow = (v) => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(RETIRED_THEMES, v) ? RETIRED_THEMES[v] : v);
/** The dark theme's page colour, as index.html states it. */
export const DARK_BAR = '#0c1310';
export const LIGHT_IDS = LIGHT_THEMES.map((t) => t.id);

/**
 * The theme to draw: 'dark', or a light theme's id. A retired theme's name is read as its replacement's; anything
 * else unknown is dark (a damaged preference), and 'system' with no light theme chosen yet takes the first. Written
 * to stand alone: `bootSource` prints this function's own text, so it reads nothing but its arguments.
 * @param {unknown} pref  dp.prefs.theme @param {unknown} lightPref  dp.prefs.lightTheme
 * @param {boolean} systemLight  the device asks for a light page @param {readonly string[]} ids  the light themes
 * @param {Readonly<Record<string, string>>} [retired]  dropped themes, each with its replacement
 * @returns {string}
 */
export function resolveTheme(pref, lightPref, systemLight, ids, retired) {
  var now = function (v) { return typeof v === 'string' && retired && Object.prototype.hasOwnProperty.call(retired, v) ? retired[v] : v; };
  var known = function (v) { return typeof v === 'string' && ids.indexOf(v) >= 0; };
  var theme = now(pref), light = now(lightPref);
  if (theme === 'system') return systemLight ? (known(light) ? String(light) : ids[0] || 'dark') : 'dark';
  return known(theme) ? String(theme) : 'dark';
}

/**
 * Draws a theme: `data-theme` on <html> for a light one and no attribute for the dark, and the browser's bar in the
 * page's colour. Stands alone, as `resolveTheme` does.
 * @param {Document} doc @param {string} theme @param {string} bar
 */
export function paintTheme(doc, theme, bar) {
  var root = doc.documentElement;
  if (theme === 'dark') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
  var meta = doc.querySelector('meta[name="theme-color"]');
  if (meta && bar) meta.setAttribute('content', bar);
}

/** @param {string} theme @returns {string} the browser bar's colour for a theme */
export const barOf = (theme) => LIGHT_THEMES.find((t) => t.id === theme)?.bar ?? DARK_BAR;

/**
 * The script that picks the theme before the first paint, so a light theme never opens on a dark page: the two
 * functions above as text, called with what the browser has stored. A classic script, because the site's CSP allows
 * no inline one and a module runs after the first paint. Any failure leaves the dark theme.
 * @returns {string}
 */
export function bootSource() {
  const bars = Object.fromEntries([['dark', DARK_BAR], ...LIGHT_THEMES.map((t) => [t.id, t.bar])]);
  return `(function () {
  try {
    var IDS = ${JSON.stringify(LIGHT_IDS)}, BARS = ${JSON.stringify(bars)}, RETIRED = ${JSON.stringify(RETIRED_THEMES)};
    var resolveTheme = ${resolveTheme.toString()};
    var paintTheme = ${paintTheme.toString()};
    var prefs = {};
    try { prefs = JSON.parse(localStorage.getItem('dp.prefs') || '{}') || {}; } catch (e) { prefs = {}; }
    var light = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
    var theme = resolveTheme(prefs.theme, prefs.lightTheme, light, IDS, RETIRED);
    paintTheme(document, theme, BARS[theme]);
  } catch (e) { /* the dark theme */ }
})();
`;
}

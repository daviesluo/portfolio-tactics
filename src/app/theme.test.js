// @vitest-environment jsdom
// DAY-MODE (2026-11-25): the rule that picks the theme, the page it draws, the preference it keeps, and the script
// that runs both before the first paint, read back from the committed bundle. The dark theme is the absence of
// `data-theme`: everything unknown, damaged or never chosen must end there.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DARK_BAR, LIGHT_IDS, LIGHT_THEMES, RETIRED_THEMES, barOf, bootSource, paintTheme, resolveTheme, themeNow } from './theme.js';
import { applyStoredTheme, loadThemePref, saveThemePref, watchSystemTheme } from './theme_pref.js';
import { BOOT_FILE_RE } from './theme_build.js';
import { Storage } from './storage.js';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const theme = () => document.documentElement.getAttribute('data-theme');
const bar = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
/** The device asks for a light page, or a dark one; returns a way to tell the page it changed. @param {boolean} light */
function device(light) {
  /** @type {(() => void)[]} */
  const heard = [];
  const state = { light };
  vi.stubGlobal('matchMedia', (/** @type {string} */ q) => ({
    get matches() { return q.includes('light') ? state.light : !state.light; },
    addEventListener: (/** @type {string} */ _e, /** @type {() => void} */ fn) => { heard.push(fn); },
  }));
  return (/** @type {boolean} */ next) => { state.light = next; for (const fn of heard) fn(); };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = `<meta name="theme-color" content="${DARK_BAR}">`;
  device(false);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('resolveTheme', () => {
  const ids = ['daylight', 'ink'];
  it('draws the dark theme for nothing chosen, for dark, and for anything it does not know', () => {
    for (const pref of [undefined, null, '', 'dark', 'neon', 'Daylight', 7, {}, ['daylight']]) {
      expect([pref, resolveTheme(pref, 'daylight', true, ids)]).toEqual([pref, 'dark']);
    }
  });
  it('draws a light theme when it is the choice, whatever the device asks for', () => {
    expect([resolveTheme('daylight', undefined, false, ids), resolveTheme('ink', 'daylight', true, ids)]).toEqual(['daylight', 'ink']);
  });
  it('follows the device under system: dark at night, by day the light theme last picked, or the first when none or a dropped one', () => {
    expect(resolveTheme('system', 'ink', false, ids)).toBe('dark');
    expect(resolveTheme('system', 'ink', true, ids)).toBe('ink');
    expect(resolveTheme('system', undefined, true, ids)).toBe('daylight');
    expect(resolveTheme('system', 'neon', true, ids)).toBe('daylight');
    expect(resolveTheme('system', 'ink', true, [])).toBe('dark');
  });
});

// Davies kept Daylight and Ink of the four designs (2026-11-25: "b和d都留下吧可选 ... 其他的删了"). A browser that had
// picked Chalk Paper or Sage holds 'paper' or 'sage' in dp.prefs: read as unknown, its day mode would turn dark the
// day the theme went. Each is read as Daylight, by the rule, the stored choice, and the script before the first paint.
describe('a theme since dropped', () => {
  it('is one of Chalk Paper and Sage, each replaced by a theme that is still offered', () => {
    expect(Object.keys(RETIRED_THEMES).sort()).toEqual(['paper', 'sage']);
    for (const [was, now] of Object.entries(RETIRED_THEMES)) expect([was, now, LIGHT_IDS.includes(now), LIGHT_IDS.includes(was)]).toEqual([was, 'daylight', true, false]);
    expect([themeNow('paper'), themeNow('sage'), themeNow('ink'), themeNow('system'), themeNow('constructor'), themeNow(undefined)]).toEqual(['daylight', 'daylight', 'ink', 'system', 'constructor', undefined]);
  });
  it('is drawn as Daylight by the rule: chosen outright, or as the light theme Auto draws by day', () => {
    for (const was of ['paper', 'sage']) {
      expect([was, resolveTheme(was, undefined, false, LIGHT_IDS, RETIRED_THEMES)]).toEqual([was, 'daylight']);
      expect([was, resolveTheme('system', was, true, LIGHT_IDS, RETIRED_THEMES)]).toEqual([was, 'daylight']);
      expect([was, resolveTheme('system', was, false, LIGHT_IDS, RETIRED_THEMES)]).toEqual([was, 'dark']);
      // Without the list of dropped themes the name is unknown, and the page dark: what this guards against.
      expect([was, resolveTheme(was, undefined, false, LIGHT_IDS)]).toEqual([was, 'dark']);
    }
    expect(resolveTheme('constructor', 'toString', true, LIGHT_IDS, RETIRED_THEMES)).toBe('dark');
  });
  it('reads from storage as Daylight, is drawn as Daylight, and a later pick is stored under a name still offered', () => {
    Storage.savePrefs({ hideValues: true, theme: 'paper', lightTheme: 'paper' });
    expect(loadThemePref()).toEqual({ theme: 'daylight', lightTheme: 'daylight' });
    expect(applyStoredTheme()).toBe('daylight');
    expect([theme(), bar()]).toEqual(['daylight', barOf('daylight')]);
    Storage.savePrefs({ theme: 'system', lightTheme: 'sage' });
    device(true);
    expect([loadThemePref(), applyStoredTheme()]).toEqual([{ theme: 'system', lightTheme: 'daylight' }, 'daylight']);
    expect(saveThemePref('dark')).toEqual({ theme: 'dark', lightTheme: 'daylight' });
    expect(Storage.loadPrefs().lightTheme).toBe('daylight');
  });
  it('is on the page as Daylight before the first paint, from the script and from the committed bundle', () => {
    const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const built = fs.readFileSync(path.join(DIST, /<script src="\/(assets\/theme-boot-[0-9a-f]{8}\.js)">/.exec(html)?.[1] ?? ''), 'utf8');
    for (const source of [bootSource(), built]) {
      for (const prefs of ['{"theme":"paper"}', '{"theme":"sage","lightTheme":"sage"}']) {
        localStorage.setItem('dp.prefs', prefs);
        document.documentElement.removeAttribute('data-theme');
        new Function(source)();
        expect([prefs, theme(), bar()]).toEqual([prefs, 'daylight', barOf('daylight')]);
      }
    }
  });
});

describe('paintTheme', () => {
  it("sets data-theme and the browser's bar for a light theme, and takes the attribute off for the dark", () => {
    paintTheme(document, 'ink', barOf('ink'));
    expect([theme(), bar()]).toEqual(['ink', LIGHT_THEMES.find((t) => t.id === 'ink')?.bar]);
    paintTheme(document, 'dark', barOf('dark'));
    expect([document.documentElement.hasAttribute('data-theme'), bar()]).toEqual([false, DARK_BAR]);
  });
  it('draws the theme on a page that has no theme-color meta', () => {
    document.head.innerHTML = '';
    paintTheme(document, 'daylight', barOf('daylight'));
    expect(theme()).toBe('daylight');
  });
});

describe('the stored choice (dp.prefs)', () => {
  it('is dark until something is chosen, and the first light theme stands by for Auto', () => {
    expect(loadThemePref()).toEqual({ theme: 'dark', lightTheme: LIGHT_IDS[0] });
    expect(applyStoredTheme()).toBe('dark');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('saving a theme keeps hide-values and every other preference of the bag, and draws it at once', () => {
    Storage.savePrefs({ hideValues: true, moversMetric: 'usd', moversWindow: '1M' });
    expect(saveThemePref('ink')).toEqual({ theme: 'ink', lightTheme: 'ink' });
    expect(JSON.parse(localStorage.getItem('dp.prefs') ?? '{}')).toEqual({ hideValues: true, moversMetric: 'usd', moversWindow: '1M', theme: 'ink', lightTheme: 'ink' });
    expect([theme(), bar()]).toEqual(['ink', barOf('ink')]);
    // Another preference saved afterwards, the way the board saves one, keeps the theme.
    Storage.savePrefs({ ...Storage.loadPrefs(), hideValues: false });
    expect(loadThemePref()).toEqual({ theme: 'ink', lightTheme: 'ink' });
  });

  it('Dark and Auto remember the light theme last picked; a name it does not know is saved as dark', () => {
    saveThemePref('ink');
    expect(saveThemePref('dark')).toEqual({ theme: 'dark', lightTheme: 'ink' });
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(saveThemePref('system')).toEqual({ theme: 'system', lightTheme: 'ink' });
    expect(saveThemePref('neon')).toEqual({ theme: 'dark', lightTheme: 'ink' });
    expect(Storage.loadPrefs().theme).toBe('dark');
  });

  it('reads a theme since dropped, or a damaged value, as dark', () => {
    Storage.savePrefs({ hideValues: false, theme: 'neon', lightTheme: 42 });
    expect(loadThemePref()).toEqual({ theme: 'dark', lightTheme: LIGHT_IDS[0] });
    localStorage.setItem('dp.prefs', '{not json');
    expect(applyStoredTheme()).toBe('dark');
  });

  it('under Auto the open page follows the device both ways, and under a fixed choice it does not', () => {
    const turn = device(false);
    saveThemePref('ink');
    saveThemePref('system');
    watchSystemTheme();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    turn(true);
    expect([theme(), bar()]).toEqual(['ink', barOf('ink')]);
    turn(false);
    expect([document.documentElement.hasAttribute('data-theme'), bar()]).toEqual([false, DARK_BAR]);
    saveThemePref('daylight');
    turn(false);
    expect(theme()).toBe('daylight');
  });
});

describe('the script before the first paint', () => {
  /** Runs a script's text as the browser would a classic one. @param {string} source */
  const run = (source) => { new Function(source)(); };

  it('is the two functions the app itself runs, as text: it draws what the app would draw for every stored choice', () => {
    const source = bootSource();
    expect(source).toContain(JSON.stringify(LIGHT_IDS));
    for (const light of [false, true]) {
      device(light);
      for (const prefs of [null, '{}', '{"theme":"dark"}', '{"theme":"neon"}', '{not json', '{"theme":"system"}', '{"theme":"system","lightTheme":"ink"}', '{"theme":"paper"}', '{"theme":"system","lightTheme":"sage"}',
        ...LIGHT_IDS.map((id) => JSON.stringify({ hideValues: true, theme: id, lightTheme: id }))]) {
        localStorage.clear();
        if (prefs !== null) localStorage.setItem('dp.prefs', prefs);
        document.documentElement.setAttribute('data-theme', 'stale');
        run(source);
        const booted = [theme(), bar()];
        const drawn = applyStoredTheme();
        expect([light, prefs, booted]).toEqual([light, prefs, [drawn === 'dark' ? null : drawn, barOf(drawn)]]);
        expect([theme(), bar()]).toEqual(booted);
      }
    }
  });

  it('leaves the dark theme when storage refuses or the browser has no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    localStorage.setItem('dp.prefs', '{"theme":"system","lightTheme":"ink"}');
    run(bootSource());
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    const getItem = vi.spyOn(Object.getPrototypeOf(localStorage), 'getItem').mockImplementation(() => { throw new Error('refused'); });
    run(bootSource());
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    getItem.mockRestore();
  });

  it('is in the committed bundle: index.html names one theme script in <head>, after the theme-color meta, and that file draws the stored theme', () => {
    const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const tags = [...html.matchAll(/<script src="\/(assets\/theme-boot-[0-9a-f]{8}\.js)"><\/script>/g)].map((m) => m[1]);
    expect(tags).toHaveLength(1);
    expect(BOOT_FILE_RE.test(tags[0])).toBe(true);
    const at = html.indexOf(tags[0]);
    expect(at).toBeGreaterThan(html.indexOf('name="theme-color"'));
    expect(at).toBeLessThan(html.indexOf('</head>'));
    // A classic script: a module would run after the first paint.
    expect(html.slice(html.lastIndexOf('<script', at), at)).not.toMatch(/type="module"|defer|async/);
    expect(fs.readFileSync(path.join(DIST, '404.html'), 'utf8')).toContain(tags[0]);
    const built = fs.readFileSync(path.join(DIST, tags[0]), 'utf8');
    for (const id of LIGHT_IDS) {
      localStorage.setItem('dp.prefs', JSON.stringify({ theme: id }));
      run(built);
      expect([id, theme(), bar()]).toEqual([id, id, barOf(id)]);
    }
    localStorage.setItem('dp.prefs', JSON.stringify({ theme: 'dark' }));
    run(built);
    expect([document.documentElement.hasAttribute('data-theme'), bar()]).toEqual([false, DARK_BAR]);
    // The service worker keeps it with the rest of the bundle, so a light theme opens light offline too.
    expect(fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8')).toContain(tags[0]);
  });
});

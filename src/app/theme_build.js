// DAY-MODE, the build's half: a Vite plugin that writes the script choosing the theme before the first paint
// (app/theme.js `bootSource`) as a file under assets/, named by its content, and puts its tag in <head> (at its end, so
// the `theme-color` meta it sets is already there; a classic script there still runs before anything is drawn). Under
// assets/ so that it is one more file of the bundle to everything that lists them: the site's gate serves it to a
// viewer (site_gate_build.js `viewerFiles`), the service worker precaches it, `_headers` caches it for a year. In
// `npm run dev` the same text is served at /theme-boot.js.
//
// Deterministic, as the rest of the build: the same source gives the same file, byte for byte.
import { bootSource } from './theme.js';

/** The file's name in the bundle, before its hash. */
const BOOT_NAME = 'theme-boot.js';
/** A bundle's theme script, by its name. */
export const BOOT_FILE_RE = /^assets\/theme-boot-[0-9a-f]{8}\.js$/;
const DEV_PATH = '/theme-boot.js';

/** The plugin. */
export function themeBoot() {
  let building = false;
  return {
    name: 'dp-theme-boot',
    /** @param {{ command: string }} config */
    configResolved(config) { building = config.command === 'build'; },
    /** Emitted as the build starts, so every plugin that reads the bundle finds it there. */
    buildStart() {
      if (building) /** @type {any} */ (this).emitFile({ type: 'asset', name: BOOT_NAME, source: bootSource() });
    },
    /** @param {{ middlewares: { use: (path: string, fn: (req: unknown, res: any) => void) => void } }} server */
    configureServer(server) {
      server.middlewares.use(DEV_PATH, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(bootSource());
      });
    },
    transformIndexHtml: {
      order: /** @type {const} */ ('post'),
      /** @param {string} _html @param {{ bundle?: Record<string, unknown>, server?: unknown }} ctx */
      handler(_html, ctx) {
        const built = Object.keys(ctx.bundle ?? {}).find((f) => BOOT_FILE_RE.test(f));
        if (!built && !ctx.server) throw new Error('the theme script is not in the bundle: index.html would open every light theme dark');
        return [{ tag: 'script', attrs: { src: built ? `/${built}` : DEV_PATH }, injectTo: /** @type {const} */ ('head') }];
      },
    },
  };
}

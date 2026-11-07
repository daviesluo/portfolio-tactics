// The build's half of the site's gate (site_gate.js): a Vite plugin that writes dist/_worker.js, the gate with its
// CONFIG filled in from this very build. Pages runs a `_worker.js` at the root of the published folder in front of
// every request ("advanced mode") and never serves the file itself; both the Direct Upload (pages-deploy.yml) and the
// Git builds publish dist/ as committed, so the gate ships with the bundle it guards, in the same commit.
//
// Deterministic, as the rest of the build: the same source gives the same _worker.js byte for byte.
import fs from 'node:fs';
import path from 'node:path';

/** The marker line in site_gate.js the build replaces. */
export const CONFIG_LINE = 'const CONFIG = null; // @gate-config';

/**
 * The `/*` block of a Pages `_headers` file: the headers every answer carries (comments and other paths left out).
 * @param {string} text @returns {Record<string, string>}
 */
export function siteHeaders(text) {
  /** @type {Record<string, string>} */
  const out = {};
  let inAll = false;
  for (const line of text.split('\n')) {
    if (/^\S/.test(line)) { inAll = line.trim() === '/*'; continue; }
    if (!inAll) continue;
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf(':');
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

/**
 * The roles each kind of restricted file is served to (the names chunk_names.js gives): the Agents page's to the admin
 * and the operator's check, a page the viewer cannot open to the admin alone.
 */
export const RESTRICTED_ROLES = { agents: ['admin', 'check'], admin: ['admin'] };

/**
 * The files only some roles get, each with its roles: every agents-* and admin-* chunk, and the stylesheets they bring.
 * @param {Record<string, any>} bundle  Rollup's output bundle
 * @returns {Record<string, string[]>}
 */
export function restrictedFiles(bundle) {
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const f of Object.values(bundle)) {
    const m = /^assets\/(agents|admin)-[0-9a-f]+\.(js|css)$/.exec(f.fileName);
    if (!m) continue;
    const roles = RESTRICTED_ROLES[/** @type {'agents' | 'admin'} */ (m[1])];
    out[f.fileName] = roles;
    for (const css of f.viteMetadata?.importedCss ?? []) out[css] = roles;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * The files of the bundle a viewer is sent (site_gate.js `viewerMay`, beside the root files it names itself): every one
 * under assets/ that is not restricted, source maps left out. A file not listed here is refused to the viewer, so a chunk
 * a later build forgets to restrict is not sent to it either.
 * @param {Record<string, any>} bundle  Rollup's output bundle @param {Record<string, string[]>} restricted
 * @returns {string[]}
 */
export function viewerFiles(bundle, restricted) {
  return Object.values(bundle).map((f) => String(f.fileName))
    .filter((n) => n.startsWith('assets/') && !/\.map$/.test(n) && !Object.prototype.hasOwnProperty.call(restricted, n))
    .sort();
}

/**
 * The gate's source with its CONFIG.
 * @param {string} source site_gate.js @param {import('./site_gate.js').GateConfig} config
 */
export function workerSource(source, config) {
  if (!source.includes(CONFIG_LINE)) throw new Error(`site_gate.js has no "${CONFIG_LINE}" line for the build to fill`);
  return source.replace(CONFIG_LINE, `const CONFIG = ${JSON.stringify(config)};`);
}

/**
 * The plugin.
 * @param {{ srcDir: string, sbUrl: string, anon: string }} o
 */
export function siteGate({ srcDir, sbUrl, anon }) {
  return {
    name: 'dp-site-gate',
    apply: /** @type {const} */ ('build'),
    /** @param {unknown} _o @param {Record<string, any>} bundle */
    generateBundle(_o, bundle) {
      const restricted = restrictedFiles(bundle);
      const config = {
        restricted,
        viewer: viewerFiles(bundle, restricted),
        headers: siteHeaders(fs.readFileSync(path.join(srcDir, 'public', '_headers'), 'utf8')),
        keyUrl: `${sbUrl}/functions/v1/auth?action=site-key`,
        authUrl: `${sbUrl}/functions/v1/auth`,
        anon,
      };
      const source = workerSource(fs.readFileSync(path.join(srcDir, 'app', 'site_gate.js'), 'utf8'), config);
      /** @type {any} */ (this).emitFile({ type: 'asset', fileName: '_worker.js', source });
    },
  };
}

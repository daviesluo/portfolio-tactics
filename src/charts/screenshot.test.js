// @vitest-environment jsdom
// Pin the screenshot helpers' platform routing — the part most likely to
// regress: copy must build an image/png ClipboardItem around the pending
// capture (Safari-safe), and save must route to the share sheet on mobile
// (→ Photos / 相册) vs a file download on desktop. html2canvas-pro is
// mocked (no real rasterising in jsdom); the browser APIs are stubbed and
// restored per test.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('html2canvas-pro', () => ({
  default: vi.fn(async () => ({
    toBlob: (/** @type {(b: Blob|null) => void} */ cb) => cb(new Blob(['png-bytes'], { type: 'image/png' })),
  })),
}));

import html2canvas from 'html2canvas-pro';
import { captureNodeToPng, copyNodeImage, saveNodeImage, isCoarsePointer, stillClone, readyClone, CLONE_SHEET_WAIT_MS } from './screenshot.js';

/** @type {any} */
const g = globalThis;
const origDesc = {
  clipboard: Object.getOwnPropertyDescriptor(navigator, 'clipboard'),
  canShare: Object.getOwnPropertyDescriptor(navigator, 'canShare'),
  share: Object.getOwnPropertyDescriptor(navigator, 'share'),
};

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, d] of Object.entries(origDesc)) {
    if (d) Object.defineProperty(navigator, k, d);
    else delete (/** @type {any} */ (navigator))[k];
  }
  vi.restoreAllMocks();
});

describe('captureNodeToPng', () => {
  it('rasterises a node to a PNG blob via html2canvas-pro', async () => {
    const blob = await captureNodeToPng(document.createElement('div'));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });
});

// SHOT-FAITHFUL (2026-11-24): the clone html2canvas draws restarted the modal's rise, and the saved picture caught it
// at half its opacity. The capture hands html2canvas a clone hook that switches every animation and transition off,
// and asks for a phone's own density (3x) so its image is the screen's size.
describe('the capture draws the page at rest', () => {
  it('hands html2canvas the hook that stills the clone, at up to 3x', async () => {
    vi.stubGlobal('devicePixelRatio', 3);
    await captureNodeToPng(document.createElement('div'));
    const opts = /** @type {any} */ (vi.mocked(html2canvas).mock.calls.at(-1))[1];
    expect(opts.onclone).toBe(readyClone);
    expect(opts.scale).toBe(3);
    vi.stubGlobal('devicePixelRatio', 4);
    await captureNodeToPng(document.createElement('div'));
    expect(/** @type {any} */ (vi.mocked(html2canvas).mock.calls.at(-1))[1].scale).toBe(3);
  });
  it('the hook turns animations and transitions off in the clone, and leaves the page alone', () => {
    const doc = document.implementation.createHTMLDocument('clone');
    stillClone(doc);
    const css = doc.head.querySelector('style')?.textContent || '';
    expect(css).toMatch(/animation:\s*none\s*!important/);
    expect(css).toMatch(/transition:\s*none\s*!important/);
    expect(css.startsWith('*, *::before, *::after')).toBe(true);
    expect(document.head.querySelector('style')).toBeNull();
  });
});

// SHOT-STYLED (2026-11-25): html2canvas-pro looks at its clone 50 ms after the frame's load, which fires for the empty
// document it closes before the page's copy goes in; a style sheet that came later left the saved picture unstyled.
// The hook the library awaits waits for every sheet of the clone that has not loaded, and for its fonts.
describe('the capture waits for the clone to be the page', () => {
  /** A clone with one sheet: `sheet` is null until it "loads". @param {boolean} loaded */
  const cloneWith = (loaded) => {
    const doc = document.implementation.createHTMLDocument('clone');
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/assets/index-00000000.css';
    let sheet = loaded ? {} : null;
    Object.defineProperty(link, 'sheet', { get: () => sheet });
    doc.head.appendChild(link);
    return { doc, link, arrive: () => { sheet = {}; link.dispatchEvent(new Event('load')); } };
  };
  const settledIn = async (/** @type {Promise<unknown>} */ p) => {
    let done = false;
    p.then(() => { done = true; });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    return done;
  };

  it('does not return while a style sheet of the clone has not loaded, and returns when it has', async () => {
    const { doc, arrive } = cloneWith(false);
    const waiting = readyClone(doc);
    expect(await settledIn(waiting)).toBe(false);
    // Still, already: the hook that stills the clone ran at once.
    expect(doc.head.querySelector('style')?.textContent).toMatch(/animation:\s*none/);
    arrive();
    await waiting;
  });

  it('returns at once for a clone whose sheets are in, and after a sheet that fails', async () => {
    await readyClone(cloneWith(true).doc);
    const { doc, link } = cloneWith(false);
    const waiting = readyClone(doc);
    link.dispatchEvent(new Event('error'));
    await waiting;
  });

  it('gives up on a sheet that never answers, after its wait, and waits for the fonts', async () => {
    vi.useFakeTimers();
    const { doc } = cloneWith(false);
    let fonts = false;
    Object.defineProperty(doc, 'fonts', { value: { ready: Promise.resolve().then(() => { fonts = true; }) } });
    const waiting = readyClone(doc);
    await vi.advanceTimersByTimeAsync(CLONE_SHEET_WAIT_MS - 1);
    expect(await settledIn(waiting)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(fonts).toBe(true);
    vi.useRealTimers();
  });
});

describe('copyNodeImage', () => {
  it('writes an image/png ClipboardItem built around the pending capture', async () => {
    /** @type {any[]} */
    const written = [];
    g.ClipboardItem = class { constructor(/** @type {any} */ items) { /** @type {any} */ (this).items = items; } };
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: vi.fn(async (/** @type {any} */ items) => { written.push(items); }) },
      configurable: true,
    });
    await copyNodeImage(document.createElement('div'));
    expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
    const payload = written[0][0].items['image/png'];
    // The clipboard payload is the still-pending capture promise, not an
    // already-resolved blob — that's what keeps Safari's activation alive.
    expect(typeof payload.then).toBe('function');
    expect(await payload).toBeInstanceOf(Blob);
  });

  it('throws when image clipboard is unsupported', async () => {
    g.ClipboardItem = undefined;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await expect(copyNodeImage(document.createElement('div'))).rejects.toThrow('clipboard-image-unsupported');
  });
});

describe('isCoarsePointer', () => {
  it('reads the (pointer: coarse) media query', () => {
    vi.stubGlobal('matchMedia', vi.fn((/** @type {string} */ q) => ({ matches: q.includes('coarse') })));
    expect(isCoarsePointer()).toBe(true);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    expect(isCoarsePointer()).toBe(false);
  });
});

describe('saveNodeImage', () => {
  it('desktop (fine pointer): downloads the file', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false }))); // not coarse
    const createURL = vi.fn((/** @type {Blob} */ _b) => 'blob:mock');
    vi.stubGlobal('URL', /** @type {any} */ ({ createObjectURL: createURL, revokeObjectURL: vi.fn() }));
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      /** @type {any} */ (this)._clicked = true;
    });
    await saveNodeImage(document.createElement('div'), 'NVDA-2026-06-08.png');
    expect(createURL).toHaveBeenCalledTimes(1);
    expect(createURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('mobile (coarse) + canShare: routes to the native share sheet', async () => {
    vi.stubGlobal('matchMedia', vi.fn((/** @type {string} */ q) => ({ matches: q.includes('coarse') })));
    const share = vi.fn(async (/** @type {any} */ _data) => {});
    Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => true), configurable: true });
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    const createURL = vi.fn((/** @type {Blob} */ _b) => 'blob:mock');
    vi.stubGlobal('URL', /** @type {any} */ ({ createObjectURL: createURL, revokeObjectURL: vi.fn() }));
    await saveNodeImage(document.createElement('div'), 'NVDA-2026-06-08.png');
    expect(share).toHaveBeenCalledTimes(1);
    const arg = share.mock.calls[0][0];
    expect(arg.files[0]).toBeInstanceOf(File);
    expect(arg.files[0].name).toBe('NVDA-2026-06-08.png');
    expect(createURL).not.toHaveBeenCalled(); // shared, not downloaded
  });

  it('mobile share cancelled (AbortError): no download fallback', async () => {
    vi.stubGlobal('matchMedia', vi.fn((/** @type {string} */ q) => ({ matches: q.includes('coarse') })));
    const abort = Object.assign(new Error('cancel'), { name: 'AbortError' });
    Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => true), configurable: true });
    Object.defineProperty(navigator, 'share', { value: vi.fn(async () => { throw abort; }), configurable: true });
    const createURL = vi.fn(() => 'blob:mock');
    vi.stubGlobal('URL', /** @type {any} */ ({ createObjectURL: createURL, revokeObjectURL: vi.fn() }));
    await saveNodeImage(document.createElement('div'), 'NVDA-2026-06-08.png');
    expect(createURL).not.toHaveBeenCalled();
  });

  it('mobile share failure (non-abort): falls back to download', async () => {
    vi.stubGlobal('matchMedia', vi.fn((/** @type {string} */ q) => ({ matches: q.includes('coarse') })));
    Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => true), configurable: true });
    Object.defineProperty(navigator, 'share', { value: vi.fn(async () => { throw new Error('boom'); }), configurable: true });
    const createURL = vi.fn(() => 'blob:mock');
    vi.stubGlobal('URL', /** @type {any} */ ({ createObjectURL: createURL, revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await saveNodeImage(document.createElement('div'), 'NVDA-2026-06-08.png');
    expect(createURL).toHaveBeenCalledTimes(1);
  });
});

// Screenshot helpers for the chart modal's "copy image / save image"
// buttons. Capture goes through html2canvas-pro, pulled in with a DYNAMIC
// import so the heavy library is a separate lazy chunk — the lean main
// bundle and its 115 KB size-limit gate stay untouched; the lib only
// downloads when a user actually clicks a screenshot button. It's the
// `-pro` fork (not the stale original) because the theme's palette is
// authored in oklch(), which the original html2canvas can't parse.

/**
 * The clone html2canvas draws holds still. Its document is a copy of the page's, so every CSS animation in it starts
 * again from its first frame, and the picture is taken a moment later: the modal's rise (`modal-in`, opacity from 0)
 * was caught at about half its opacity, and the saved image showed the title 128,130,122 where the screen showed
 * 244,239,227 (SHOT-FAITHFUL, 2026-11-24; a phone's modal has no rise and was right). With animations and transitions
 * off the clone is drawn as the page stands at rest.
 * @param {Document} doc
 */
export function stillClone(doc) {
  const st = doc.createElement('style');
  st.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
  doc.head.appendChild(st);
}

/**
 * Rasterise a DOM node to a PNG Blob at the device pixel ratio (crisp on
 * retina / mobile, capped at 3×, a phone's own density, to bound memory:
 * at 2× an iPhone's saved image was two thirds the size of its screen). `ignore` lets the
 * caller hide chrome (the action buttons) from the shot.
 * @param {HTMLElement} node
 * @param {(el: Element) => boolean} [ignore]
 * @returns {Promise<Blob>}
 */
export async function captureNodeToPng(node, ignore) {
  const { default: html2canvas } = await import('html2canvas-pro');
  const canvas = await html2canvas(node, {
    backgroundColor: getComputedStyle(node).backgroundColor || '#0c1310',
    scale: Math.min(window.devicePixelRatio || 1, 3),
    useCORS: true,
    logging: false,
    ignoreElements: ignore,
    onclone: stillClone,
  });
  return await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png');
  });
}

/**
 * Copy a node's screenshot to the clipboard as a PNG. The ClipboardItem
 * is built around the still-pending capture promise and `clipboard.write`
 * is called immediately — that's the Safari-safe shape: awaiting the
 * capture first would drop the transient user activation and iOS would
 * reject the write.
 * @param {HTMLElement} node
 * @param {(el: Element) => boolean} [ignore]
 */
export async function copyNodeImage(node, ignore) {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('clipboard-image-unsupported');
  }
  const item = new ClipboardItem({ 'image/png': captureNodeToPng(node, ignore) });
  await navigator.clipboard.write([item]);
}

/** True for touch / mobile viewports — routes save to the share sheet. */
export function isCoarsePointer() {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/**
 * Save a node's screenshot as a PNG. On mobile (coarse pointer) it's
 * handed to the native share sheet so the user can drop it into Photos /
 * 相册; on desktop it triggers a file download. Share falling over (or
 * being unavailable) degrades to a download; a user-cancelled share is a
 * no-op.
 * @param {HTMLElement} node
 * @param {string} filename
 * @param {(el: Element) => boolean} [ignore]
 */
export async function saveNodeImage(node, filename, ignore) {
  const blob = await captureNodeToPng(node, ignore);
  const file = new File([blob], filename, { type: 'image/png' });
  if (isCoarsePointer() && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      // Dismissing the share sheet (AbortError) is a deliberate cancel —
      // don't then surprise the user with a download.
      if (e && /** @type {any} */ (e).name === 'AbortError') return;
      // Any other failure → fall through to the download path.
    }
  }
  downloadBlob(blob, filename);
}

/** @param {Blob} blob @param {string} filename */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// How the build names a chunk (vite.config.js `chunkFileNames`), so the files a read-only viewer must never be sent can
// be told by their names alone: agents-* for the Agents page (Davies, 2026-11-05: "从页面中也下载不到任何关于agents的
// 内容"), admin-* for a page the viewer cannot open ("还有交易记录等不对访客开放的内容"). The service worker's precache
// leaves both out, the viewer's board never warms them, and the site's gate serves them by role.

/** A module of the Agents page (<private>/), by its resolved path on any platform. */
export const AGENTS_DIR_RE = /[\\/]src[\\/]agents[\\/]/;
/**
 * The pages a read-only viewer cannot open (app.jsx: each is shown only `!isReadOnly`), by their modules: the
 * transaction history and the board's editors (edit a holding, add one, the cash). A new page closed to the viewer
 * joins this list; chunk_names.test.js reads app.jsx and fails until it does.
 */
export const ADMIN_PAGE_RE = /[\\/]src[\\/](tables[\\/]transaction_history\.jsx|board[\\/]edit_modals\.jsx)$/;

/**
 * A chunk's file name: agents-* for one with a module of the Agents page, admin-* for one with a page closed to the
 * viewer, else its own name.
 * @param {{ moduleIds: string[] }} chunk
 */
export function chunkFileName(chunk) {
  if (chunk.moduleIds.some((id) => AGENTS_DIR_RE.test(id))) return 'assets/agents-[hash].js';
  if (chunk.moduleIds.some((id) => ADMIN_PAGE_RE.test(id))) return 'assets/admin-[hash].js';
  return 'assets/[name]-[hash].js';
}

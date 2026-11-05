// @vitest-environment node
// The build's chunk names (chunk_names.js; Davies, 2026-11-05: "登录后的访客也下载不了agents的任何文件吧，还有交易记录等不对
// 访客开放的内容"): the Agents page's chunks are agents-*, a page the viewer cannot open admin-*, and the list of those
// pages is app.jsx's own.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN_PAGE_RE, chunkFileName } from './chunk_names.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('chunk names', () => {
  it('names a chunk by what it holds: the Agents page agents-*, a page the viewer cannot open admin-*, the rest its own name', () => {
    const at = (/** @type {string} */ p) => `/repo/src/${p}`;
    expect(chunkFileName({ moduleIds: [at('agents/agents.jsx'), at('agents/agents_chart.js')] })).toBe('assets/agents-[hash].js');
    expect(chunkFileName({ moduleIds: [at('tables/transaction_history.jsx')] })).toBe('assets/admin-[hash].js');
    expect(chunkFileName({ moduleIds: [at('board/edit_modals.jsx')] })).toBe('assets/admin-[hash].js');
    expect(chunkFileName({ moduleIds: [at('tables/holdings_list.jsx')] })).toBe('assets/[name]-[hash].js');
    expect(chunkFileName({ moduleIds: ['C:\\repo\\src\\board\\edit_modals.jsx'] })).toBe('assets/admin-[hash].js');
  });

  it("covers every page app.jsx shows only to the admin: each `&& !isReadOnly` modal's lazy module is an admin page", () => {
    const app = fs.readFileSync(path.join(SRC, 'app', 'app.jsx'), 'utf8');
    const lazy = Object.fromEntries([...app.matchAll(/const (\w+) = lazyPage\(\(\) => import\('\.\.\/([\w/]+\.jsx)'\)/g)].map((m) => [m[1], m[2]]));
    // The state each closed modal opens on, then which lazy page renders under it.
    const closed = [...app.matchAll(/\{(\w+) && !isReadOnly[^\n]*\n([\s\S]*?)\n {6}\)\}/g)];
    const pages = new Set();
    for (const [, , body] of closed) for (const [name, file] of Object.entries(lazy)) if (new RegExp(`<${name}\\b`).test(body)) pages.add(file);
    expect([...pages].sort()).toEqual(['board/edit_modals.jsx', 'tables/transaction_history.jsx']);
    for (const p of pages) expect([p, ADMIN_PAGE_RE.test(`/repo/src/${p}`)]).toEqual([p, true]);
  });
});

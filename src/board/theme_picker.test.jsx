// @vitest-environment jsdom
// DAY-MODE (2026-11-25): the theme's rows at the foot of the menu. Dark, each light theme of app/theme.js and Auto;
// the stored choice is the one ticked; a click draws the theme at once, keeps it, and leaves the other preferences be.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemePicker } from './header_sidebar.jsx';
import { DARK_BAR, LIGHT_THEMES } from '../app/theme.js';

const rows = (/** @type {HTMLElement} */ c) => [...c.querySelectorAll('.theme-item')];
const ticked = (/** @type {HTMLElement} */ c) => rows(c).filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.getAttribute('data-theme-pick'));

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = `<meta name="theme-color" content="${DARK_BAR}">`;
});
afterEach(cleanup);

describe('ThemePicker', () => {
  it('offers Dark, every light theme by its name, and Auto, with Dark ticked on a first visit', () => {
    const { container } = render(<ThemePicker />);
    expect(rows(container).map((r) => r.getAttribute('data-theme-pick'))).toEqual(['dark', ...LIGHT_THEMES.map((t) => t.id), 'system']);
    expect(rows(container).map((r) => r.querySelector('.theme-name')?.textContent)).toEqual(['Dark', ...LIGHT_THEMES.map((t) => t.name), 'Auto']);
    expect(ticked(container)).toEqual(['dark']);
    expect(rows(container).every((r) => r.getAttribute('role') === 'menuitemradio' && !!r.querySelector('.theme-sw'))).toBe(true);
  });

  it('a click draws the theme, ticks its row alone, and stores it beside hide-values', () => {
    localStorage.setItem('dp.prefs', JSON.stringify({ hideValues: true }));
    const { container } = render(<ThemePicker />);
    const pick = LIGHT_THEMES[LIGHT_THEMES.length - 1];
    fireEvent.click(/** @type {Element} */ (container.querySelector(`[data-theme-pick="${pick.id}"]`)));
    expect(document.documentElement.getAttribute('data-theme')).toBe(pick.id);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(pick.bar);
    expect(ticked(container)).toEqual([pick.id]);
    expect(JSON.parse(localStorage.getItem('dp.prefs') ?? '{}')).toEqual({ hideValues: true, theme: pick.id, lightTheme: pick.id });
    fireEvent.click(/** @type {Element} */ (container.querySelector('[data-theme-pick="dark"]')));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(ticked(container)).toEqual(['dark']);
    expect(JSON.parse(localStorage.getItem('dp.prefs') ?? '{}')).toEqual({ hideValues: true, theme: 'dark', lightTheme: pick.id });
  });

  it('opens on the stored choice, and Auto says which light theme it draws by day', () => {
    const byDay = LIGHT_THEMES[1] ?? LIGHT_THEMES[0];
    localStorage.setItem('dp.prefs', JSON.stringify({ theme: 'system', lightTheme: byDay.id }));
    const { container } = render(<ThemePicker />);
    expect(ticked(container)).toEqual(['system']);
    expect(container.querySelector('[data-theme-pick="system"]')?.getAttribute('title')).toContain(byDay.name);
  });
});

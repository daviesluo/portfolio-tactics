// SHOT-FAITHFUL (2026-11-24, Davies: the site's colours on screen and in a screenshot of it differed). His iPhone and
// MacBook have P3 screens: a colour written outside sRGB is drawn there as written, and its screenshot, shared or
// re-encoded as sRGB, holds the nearest sRGB colour instead. Two tokens were outside (the loss red and the forward
// role's orange). Every colour the two stylesheets and the components write is inside sRGB, so a screen and its
// screenshot hold the same colour: no `color(display-p3 …)`, `lab()` or `lch()`, and every `oklch()` inside the gamut.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILES = ['app', 'board', 'charts', 'agents'].flatMap((dir) => fs.readdirSync(path.join(SRC, dir))
  .filter((f) => /\.(css|jsx?)$/.test(f) && !/\.test\./.test(f)).map((f) => `${dir}/${f}`));

/** OKLCH to linear sRGB (Björn Ottosson's matrices): a channel below 0 or above 1 is outside the gamut. */
export function oklchToLinearSrgb(L, C, hDeg) {
  const a = C * Math.cos((hDeg * Math.PI) / 180), b = C * Math.sin((hDeg * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}
const inSrgb = (/** @type {number[]} */ rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

describe('every colour the site writes is inside sRGB', () => {
  it('the conversion: sRGB red is on the edge, the old loss red was outside, today\'s gain green is inside', () => {
    expect(inSrgb(oklchToLinearSrgb(0.62796, 0.25768, 29.234))).toBe(true);
    expect(inSrgb(oklchToLinearSrgb(0.70, 0.20, 25))).toBe(false);
    expect(inSrgb(oklchToLinearSrgb(0.78, 0.16, 40))).toBe(false);
    expect(inSrgb(oklchToLinearSrgb(0.78, 0.17, 150))).toBe(true);
  });
  it('no wide-gamut colour function, and every oklch() inside the gamut', () => {
    /** @type {string[]} */
    const outside = [];
    let seen = 0;
    for (const file of FILES) {
      const text = fs.readFileSync(path.join(SRC, file), 'utf8');
      text.split('\n').forEach((line, i) => {
        if (/color\(\s*(display-p3|rec2020|a98-rgb|prophoto-rgb)|\b(lab|lch)\(/.test(line)) outside.push(`${file}:${i + 1} a wide-gamut colour function`);
        for (const m of line.matchAll(/oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/g)) {
          seen += 1;
          const L = m[2] ? Number(m[1]) / 100 : Number(m[1]);
          if (!inSrgb(oklchToLinearSrgb(L, Number(m[3]), Number(m[4])))) outside.push(`${file}:${i + 1} ${m[0]})`);
        }
      });
    }
    expect(outside).toEqual([]);
    // The check read something: the sheet's tokens are oklch().
    expect(seen).toBeGreaterThan(5);
  });
});

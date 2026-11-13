// The charts' vertical dashed marker: a session's OPEN and CLOSE on a
// ticker's 1D, and 00:00 UTC, where a board strategy's TODAY starts
// (Davies, 2026-11-13: "类似于个股里的open和close线"). One component, so
// the three read as one kind of line on the ticker modal and on the
// Agents page's live price card: the same colour and opacity in both
// themes (`--chalk-dim` is themed), and no pointer events, so the
// crosshair still reads the bar under it.
import React from 'react';

/**
 * @param {{ x: number, y0: number, y1: number, label?: string | null, fontSize?: number, strokeWidth?: number, className?: string }} props
 */
export function SessionLine({ x, y0, y1, label = null, fontSize = 8.5, strokeWidth = 0.8, className = 'session-line' }) {
  const xs = x.toFixed(1);
  return (
    <g className={className} pointerEvents="none">
      <line x1={xs} y1={y0} x2={xs} y2={y1}
            stroke="var(--chalk-dim)" strokeWidth={strokeWidth} strokeDasharray="3,4" opacity="0.6" />
      {label && (
        <text x={xs} y={y0 - 4} textAnchor="middle"
              fontSize={fontSize} fill="var(--chalk-dim)" fontFamily="var(--font-mono)">
          {label}
        </text>
      )}
    </g>
  );
}

/**
 * A 00:00 UTC line's label: named while a window holds one or two, bare beyond (a week's seven would crowd the top, and its
 * x-axis dates already name the days).
 * @param {number} count
 */
export function dayLineLabel(count) {
  return count <= 2 ? '00:00 UTC' : null;
}

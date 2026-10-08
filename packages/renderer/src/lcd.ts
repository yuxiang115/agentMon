// LCD geometry, ported from tuipet src/tuipet/grid.py
// (https://github.com/joeltco/tuipet) — MIT, (c) 2026 Joel Taylor.
//
// agentMon's LCD is the classic 32x16 play window itself (tuipet renders a
// 40x24 LCD with the 32x16 window centred inside it — docs/reference-audit.md
// C1): our window covers the whole screen, and sprites ground 2px above the
// bottom edge.

import { ink, type Bitmap } from "./halfblock";
import type { Rect, ScenePlacement } from "./framebuffer";

/** LCD width in pixels == character columns. */
export const COLS = 32;
/** LCD height in pixels (2 x 8 character rows). */
export const PXH = 16;
/** Terminal rows the LCD occupies. */
export const CHAR_ROWS = 8;
/** One creature cell (two side-by-side == the full grid). */
export const CELL = 16;
/** The play window: the whole LCD for agentMon. */
export const WINDOW: Rect = { x0: 0, x1: COLS, y0: 0, y1: PXH };

/** (leftBound, rightBound) so a roaming sprite stays inside the grid. */
export function roamBounds(spriteW = CELL, areaW = COLS): [number, number] {
  return [0, areaW - spriteW];
}

export function spriteWidth(sprite: Bitmap | null): number {
  return sprite ? Math.max(...sprite.map((r) => r.length)) : 0;
}

/** Trim a sprite to its lit content (creatures carry transparent padding). */
export function crop(sprite: Bitmap | null): Bitmap | null {
  if (!sprite || sprite.length === 0) return sprite;
  const w = Math.max(...sprite.map((r) => r.length));
  const rows = sprite.map((r) => r.padEnd(w, "0"));
  const ys = rows.map((r, y) => (Array.from(r).some((c) => ink(c)) ? y : -1)).filter((y) => y >= 0);
  const xs: number[] = [];
  for (let x = 0; x < w; x++) if (rows.some((r) => ink(r[x]))) xs.push(x);
  if (!ys.length || !xs.length) return sprite;
  return rows
    .slice(ys[0], ys[ys.length - 1] + 1)
    .map((r) => r.slice(xs[0], xs[xs.length - 1] + 1));
}

/** Placement of a (cropped) sprite centred in the grid. */
export function center(sprite: Bitmap | null, mirror = false): ScenePlacement {
  const s = crop(sprite) ?? [];
  return { frame: s, xLeft: Math.floor((COLS - spriteWidth(s)) / 2), mirror };
}

/**
 * Two creatures facing off: left hugs x=0, right hugs the right edge, each
 * fitted to a cell so a centre gap always remains. Sprites face LEFT
 * natively, so the defaults mirror the left one to make them face each other.
 */
export function faceoff(
  left: Bitmap | null,
  right: Bitmap | null,
  leftMirror = true,
  rightMirror = false,
): ScenePlacement[] {
  const ls = crop(left);
  const rs = crop(right);
  const out: ScenePlacement[] = [];
  if (ls && ls.length) out.push({ frame: ls, xLeft: 0, mirror: leftMirror });
  if (rs && rs.length) out.push({ frame: rs, xLeft: COLS - spriteWidth(rs), mirror: rightMirror });
  return out;
}

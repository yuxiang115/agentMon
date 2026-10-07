// Pixel framebuffer + LCD compositor, ported from tuipet src/tuipet/render.py
// (fill_buf / _stamp / _paint_cells / render_screen / render_scene)
// (https://github.com/joeltco/tuipet) — MIT, (c) 2026 Joel Taylor.
//
// Buffer planes: 0 = off, 1 = sprite/prop ink, 2 = free ink (weather-style,
// painted in its own colour). A pixel already inked keeps its ink.

import { UPPER, LOWER, FULL, ink, fgColor, bgColor, RESET, type Bitmap } from "./halfblock";

export interface Point {
  x: number;
  y: number;
}

/** Half-open window [x0, x1) x [y0, y1). */
export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export function blit(bm: Bitmap | null, ox: number, oy: number): Point[] {
  if (!bm) return [];
  const pts: Point[] = [];
  bm.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (ink(row[x])) pts.push({ x: ox + x, y: oy + y });
  });
  return pts;
}

export function stamp(buf: number[][], pts: Point[], clip?: Rect, val = 1): void {
  const cols = buf[0].length;
  const pxH = buf.length;
  const c = clip ?? { x0: 0, x1: cols, y0: 0, y1: pxH };
  for (const p of pts) {
    if (
      p.y >= c.y0 && p.y < c.y1 && p.x >= c.x0 && p.x < c.x1 &&
      p.y >= 0 && p.y < pxH && p.x >= 0 && p.x < cols
    ) {
      buf[p.y][p.x] = buf[p.y][p.x] || val;
    }
  }
}

export interface FillOptions {
  /** Ground on the floor (default) instead of vertical centring. */
  baseline?: boolean;
  mirror?: boolean;
  /** Offset from the horizontally centred position. */
  xshift?: number;
  /** + lifts the sprite (a hop). */
  yshift?: number;
  /**
   * Half-open window over sprite ink and clipped overlays: off-window ink is
   * simply not displayed — which is also HOW things exit (walk off the edge).
   */
  clip?: Rect;
}

export function fillBuf(
  frame: Bitmap | null,
  cols: number,
  pxH: number,
  opts: FillOptions = {},
  overlay?: Point[],
  overlayFree?: Point[],
): number[][] {
  const buf: number[][] = Array.from({ length: pxH }, () => Array<number>(cols).fill(0));
  const clip = opts.clip ?? { x0: 0, x1: cols, y0: 0, y1: pxH };
  if (frame && frame.length) {
    const rows = opts.mirror ? frame.map((r) => [...r].reverse().join("")) : frame;
    const sw = Math.max(...rows.map((r) => r.length));
    const sh = rows.length;
    const ox = Math.floor((cols - sw) / 2) + (opts.xshift ?? 0);
    const oy =
      Math.max(0, opts.baseline === false ? Math.floor((pxH - sh) / 2) : pxH - sh - 2) -
      (opts.yshift ?? 0);
    rows.forEach((line, y) => {
      for (let x = 0; x < line.length; x++) {
        if (!ink(line[x])) continue;
        const py = oy + y;
        const px = ox + x;
        if (
          py >= clip.y0 && py < clip.y1 && px >= clip.x0 && px < clip.x1 &&
          py >= 0 && py < pxH && px >= 0 && px < cols
        ) {
          buf[py][px] = 1;
        }
      }
    });
  }
  if (overlay) stamp(buf, overlay, clip);
  if (overlayFree) stamp(buf, overlayFree, undefined, 2);
  return buf;
}

export interface PaintOptions {
  /** Ink colour. */
  on?: string;
  /**
   * LCD plate background colour. Pass `null` for a TRANSPARENT background:
   * off pixels print a bare space (terminal default, nothing painted) and
   * inked pixels use the four-glyph encoding with foreground colour only.
   */
  bg?: string | null;
  /** Colour for the free-ink (plane 2) pixels; defaults to `on`. */
  freeInk?: string;
  /**
   * Emit plain four-glyph text instead of coloured cells. The ▀-only plate
   * encoding carries pixels in the ANSI colours, so stripped-of-ANSI output
   * would be meaningless; this mode trades the LCD look for pipe/CI-safe text.
   */
  plain?: boolean;
}

/**
 * The compositor, three modes:
 *  - plate (bg set): ONE "▀" per cell; top pixel -> foreground colour, bottom
 *    pixel -> background colour. A dot matrix's dead pixels are modelled by
 *    the LCD background colour.
 *  - transparent (bg null): ink-only four-glyph cells (" ", "▀", "▄", "█")
 *    with no background — off pixels leave the terminal untouched.
 *  - plain: the transparent glyph scheme without any ANSI at all.
 */
export function paintLcd(buf: number[][], opts: PaintOptions = {}): string[] {
  const on = opts.on ?? "#2b2e31";
  const bg = opts.bg === null ? null : (opts.bg ?? "#c6c9cc");
  const fi = opts.freeInk ?? on;
  const pxH = buf.length;
  const cols = buf[0]?.length ?? 0;
  const lines: string[] = [];
  for (let cy = 0; cy < Math.floor(pxH / 2); cy++) {
    let line = "";
    for (let cx = 0; cx < cols; cx++) {
      const tv = buf[cy * 2][cx];
      const bv = buf[cy * 2 + 1][cx];
      if (opts.plain || bg === null) {
        const t = tv !== 0;
        const b = bv !== 0;
        if (!t && !b) {
          line += " ";
          continue;
        }
        const glyph = t && b ? FULL : t ? UPPER : LOWER;
        line += opts.plain ? glyph : fgColor(tv === 2 ? fi : on) + glyph;
        continue;
      }
      const tc = tv === 0 ? bg : tv === 2 ? fi : on;
      const bc = bv === 0 ? bg : bv === 2 ? fi : on;
      line += fgColor(tc) + bgColor(bc) + UPPER;
    }
    lines.push(opts.plain ? line : line + RESET);
  }
  return lines;
}

/** Compose one sprite centred on a cols x charRows LCD screen. */
export function renderScreen(
  frame: Bitmap | null,
  cols: number,
  charRows: number,
  opts: FillOptions & PaintOptions = {},
): string[] {
  return paintLcd(fillBuf(frame, cols, charRows * 2, opts), opts);
}

export interface ScenePlacement {
  frame: Bitmap | null;
  xLeft: number;
  mirror?: boolean;
}

/** Multi-sprite pixel buffer (each sprite grounded on the floor). */
export function fillScene(
  placements: ScenePlacement[],
  cols: number,
  pxH: number,
  clip?: Rect,
): number[][] {
  const buf: number[][] = Array.from({ length: pxH }, () => Array<number>(cols).fill(0));
  const c = clip ?? { x0: 0, x1: cols, y0: 0, y1: pxH };
  for (const { frame, xLeft, mirror } of placements) {
    if (!frame || !frame.length) continue;
    const rows = mirror ? frame.map((r) => [...r].reverse().join("")) : frame;
    const sh = rows.length;
    const oy = Math.max(0, pxH - sh - 2);
    rows.forEach((line, y) => {
      for (let x = 0; x < line.length; x++) {
        if (!ink(line[x])) continue;
        const py = oy + y;
        const px = xLeft + x;
        if (
          py >= c.y0 && py < c.y1 && px >= c.x0 && px < c.x1 &&
          py >= 0 && py < pxH && px >= 0 && px < cols
        ) {
          buf[py][px] = 1;
        }
      }
    });
  }
  return buf;
}

/** Compose several sprites (each baselined on the floor) onto one LCD. */
export function renderScene(
  placements: ScenePlacement[],
  cols: number,
  charRows: number,
  opts: PaintOptions & { clip?: Rect } = {},
): string[] {
  return paintLcd(fillScene(placements, cols, charRows * 2, opts.clip), opts);
}

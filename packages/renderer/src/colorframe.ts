// Full-colour frame rendering, pi-pets style: a pose may carry per-pixel
// colours via a species palette (char -> #rrggbb); each character cell packs
// two vertical pixels as 24-bit ANSI half/full blocks. Transparent pixels
// leave the terminal untouched — no LCD plate behind colour pets.

import { fgColor, bgColor, RESET, UPPER, LOWER, FULL } from "./halfblock";

/** A frame as 16 rows x N cols of "#rrggbb" or null (transparent). */
export type ColorGrid = Array<Array<string | null>>;

export interface ColorPlacement {
  grid: ColorGrid;
  xLeft: number;
  mirror?: boolean;
}

/** Parse palette-indexed pose rows (chars index the palette, '.' = off). */
export function poseToColorGrid(
  rows: readonly string[],
  palette: Record<string, string>,
  height = 16,
): ColorGrid {
  const w = Math.max(1, ...rows.map((r) => r.length));
  const grid: ColorGrid = [];
  for (let y = 0; y < height; y++) {
    const row = rows[y] ?? "";
    const out: Array<string | null> = [];
    for (let x = 0; x < w; x++) {
      const ch = row[x] ?? ".";
      out.push(ch === "." ? null : (palette[ch] ?? null));
    }
    grid.push(out);
  }
  return grid;
}

function cell(top: string | null, bottom: string | null): string {
  if (!top && !bottom) return " ";
  // every coloured cell resets immediately — a bg colour would otherwise
  // bleed across the following transparent cells (the "long shadow" bug)
  if (!top) return fgColor(bottom!) + LOWER + RESET; // ▄ in the bottom pixel's colour
  if (!bottom) return fgColor(top) + UPPER + RESET; // ▀ in the top pixel's colour
  if (top === bottom) return fgColor(top) + FULL + RESET; // █ solid
  return fgColor(top) + bgColor(bottom) + UPPER + RESET; // split cell
}

/**
 * Compose colour placements onto a cols x (charRows*2) canvas and render as
 * ANSI lines. Sprites ground with the same baseline rule as the 1-bit path.
 */
export function renderColorScene(
  placements: readonly ColorPlacement[],
  cols = 32,
  charRows = 8,
): string[] {
  const pxH = charRows * 2;
  const canvas: Array<Array<string | null>> = Array.from({ length: pxH }, () =>
    Array<string | null>(cols).fill(null),
  );
  for (const p of placements) {
    const h = p.grid.length;
    const w = p.grid[0]?.length ?? 0;
    const oy = Math.max(0, pxH - h - 2);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const color = p.grid[y]![p.mirror ? w - 1 - x : x];
        if (!color) continue;
        const px = p.xLeft + x;
        const py = oy + y;
        if (py >= 0 && py < pxH && px >= 0 && px < cols) canvas[py]![px] = color;
      }
    }
  }
  const lines: string[] = [];
  for (let cy = 0; cy < charRows; cy++) {
    let line = "";
    for (let cx = 0; cx < cols; cx++) {
      line += cell(canvas[cy * 2]![cx], canvas[cy * 2 + 1]![cx]);
    }
    lines.push(line);
  }
  return lines;
}

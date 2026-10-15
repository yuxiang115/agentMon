// Quadrant-block compositor: packs 2x2 pixels into one character cell using
// the Unicode quadrant glyphs (▘▝▖▗ and their unions). A cell carries one
// foreground (ink) and one background (LCD plate) colour, so this is the
// MONOCHROME path — but it renders the same 32x16-classic pixel grid at half
// the terminal width of the half-block LCD, and emits one ANSI prefix per
// line instead of per cell (colour pets keep the half-block path).

import { fgColor, bgColor, RESET } from "./halfblock";
import { fillScene, type ScenePlacement } from "./framebuffer";
import { BG_DEFAULT, composeColorCanvas, type ColorPlacement } from "./colorframe";

/** Quadrant bits: TL=8, TR=4, BL=2, BR=1. */
export const QUAD_GLYPHS: Readonly<Record<number, string>> = {
  0b0000: " ",
  0b1000: "▘",
  0b0100: "▝",
  0b0010: "▖",
  0b0001: "▗",
  0b1100: "▀",
  0b1010: "▌",
  0b1001: "▚",
  0b0110: "▞",
  0b0101: "▐",
  0b0011: "▄",
  0b1011: "▛",
  0b1101: "▜",
  0b0111: "▙",
  0b1110: "▟",
  0b1111: "█",
};

export interface QuadOptions {
  on?: string;
  bg?: string;
}

/** Paint a pixel buffer as quadrant blocks (2x2 px per cell). */
export function paintQuad(buf: number[][], opts: QuadOptions = {}): string[] {
  const on = opts.on ?? "#2b2e31";
  const bg = opts.bg ?? "#c6c9cc";
  const pxH = buf.length;
  const pxW = buf[0]?.length ?? 0;
  const cellCols = Math.ceil(pxW / 2);
  const cellRows = Math.ceil(pxH / 2);
  const lines: string[] = [];
  for (let cy = 0; cy < cellRows; cy++) {
    let line = fgColor(on) + bgColor(bg);
    for (let cx = 0; cx < cellCols; cx++) {
      let bits = 0;
      if (buf[cy * 2]?.[cx * 2]) bits |= 0b1000;
      if (buf[cy * 2]?.[cx * 2 + 1]) bits |= 0b0100;
      if (buf[cy * 2 + 1]?.[cx * 2]) bits |= 0b0010;
      if (buf[cy * 2 + 1]?.[cx * 2 + 1]) bits |= 0b0001;
      line += QUAD_GLYPHS[bits] ?? " ";
    }
    lines.push(line + RESET);
  }
  return lines;
}

/**
 * Compose floor-grounded sprite placements onto a cols x charRows quadrant
 * LCD — the pixel grid is cols*2 x charRows*2, exactly the half-block grid
 * for the same sprite size.
 */
export function renderQuadScene(
  placements: readonly ScenePlacement[],
  cols: number,
  charRows: number,
  opts: QuadOptions = {},
): string[] {
  return paintQuad(fillScene([...placements], cols * 2, charRows * 2), opts);
}

/**
 * The palette-species quadrant LCD. A cell carries one fg + one bg, so a
 * 2x2-px cell renders EXACTLY while it holds at most two colours (with or
 * without transparent holes — holes get the terminal default background,
 * like the half-block colour path). Rarer 3+-colour cells keep the two most
 * used colours and fold the rest into the background: measured on the
 * hand-authored digivice sprites, 0.5–10% of cells per species.
 */
export function renderQuadColorScene(
  placements: readonly ColorPlacement[],
  cols: number,
  charRows: number,
): string[] {
  const canvas = composeColorCanvas(placements, cols * 2, charRows);
  const lines: string[] = [];
  for (let cy = 0; cy < charRows; cy++) {
    let line = "";
    for (let cx = 0; cx < cols; cx++) {
      const quad = [
        canvas[cy * 2]?.[cx * 2] ?? null,
        canvas[cy * 2]?.[cx * 2 + 1] ?? null,
        canvas[cy * 2 + 1]?.[cx * 2] ?? null,
        canvas[cy * 2 + 1]?.[cx * 2 + 1] ?? null,
      ] as Array<string | null>;
      const counts = new Map<string, number>();
      for (const c of quad) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
      if (!counts.size) {
        // an explicit default background stops the previous cell's bg from
        // bleeding into this hole (the "long shadow" lesson)
        line += BG_DEFAULT + " ";
        continue;
      }
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      const majority = ranked[0]![0];
      const second = ranked[1];
      const holes = quad.includes(null);
      let bits = 0;
      if (second && !holes) {
        // exactly two colours, no holes: bg carries the majority, the glyph
        // marks the minority colour's quadrants — a lossless cell
        quad.forEach((c, i) => {
          if (c === second[0]) bits |= 1 << (3 - i);
        });
        line += fgColor(second[0]) + bgColor(majority) + QUAD_GLYPHS[bits]!;
      } else {
        // one colour (or holes force transparency): fg ink on default bg;
        // every lit quadrant keeps its ink, extra colours approximate to
        // the majority ink
        quad.forEach((c, i) => {
          if (c) bits |= 1 << (3 - i);
        });
        line += fgColor(majority) + BG_DEFAULT + QUAD_GLYPHS[bits]!;
      }
    }
    lines.push(line + RESET);
  }
  return lines;
}

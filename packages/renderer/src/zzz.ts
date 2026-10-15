// The sleeping tell: a little "z" rising beside the pet's head, growing as
// it goes (the classic V-Pet snooze). Pure bitmaps — both the mono and the
// colour compositors take them as ordinary floor-grounded placements, and a
// column of transparent padding lifts the glyph because placements ground on
// the floor.

import type { Bitmap } from "./halfblock";
import { scaleRows } from "./scale";

/** One rise step every 1.2 s; three steps make a full z-z-Z cycle. */
export const ZZZ_BEAT = 12;

/** Authored glyphs: the diagonal pixel must survive every render size, so
 *  3px is hand-drawn and anything bigger upscales from the 4x4 (upscaling
 *  samples every source row; downscaling to 3 would skip the diagonal). */
const Z_GLYPH: Bitmap = ["####", "...#", ".#..", "####"];
const Z_GLYPH_3: Bitmap = ["###", "..#", "###"];

function zGlyph(edge: number): Bitmap {
  return edge < 4 ? Z_GLYPH_3 : scaleRows(Z_GLYPH, edge);
}

export type ZzzPhase = 0 | 1 | 2;

export function zzzPhase(tick: number): ZzzPhase {
  return (Math.floor(tick / ZZZ_BEAT) % 3) as ZzzPhase;
}

/** The glyph edge in pixels for a sprite rendered `size` px (capped: it must
 *  fit the 16px roam margin beside the pet). */
export function zzzGlyphSize(size: number): number {
  return Math.min(7, Math.max(3, Math.round(size / 5)));
}

/**
 * The bottom-grounded z column for rise phase 0..2: the glyph sits `h` px
 * above the floor, `h` climbing with the phase, so it floats up beside the
 * pet's head. All-`.` padding rows carry the lift.
 */
export function zzzColumn(size: number, phase: ZzzPhase, areaPxH: number): Bitmap {
  const glyph = zGlyph(zzzGlyphSize(size));
  const lift = Math.min(
    Math.round(size * (0.55 + 0.18 * phase)),
    Math.max(0, areaPxH - 2),
  );
  const pad = Math.max(0, lift - glyph.length);
  return [...Array.from({ length: pad }, () => ".".repeat(glyph.length)), ...glyph];
}

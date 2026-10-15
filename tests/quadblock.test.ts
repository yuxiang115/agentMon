import { describe, expect, it } from "vitest";
import { BLINK_CLOSED_TICKS, BLINK_PERIOD_TICKS, pickActivityIndex, pickFrame } from "../packages/renderer/src/animation";
import { paintQuad, QUAD_GLYPHS, renderQuadColorScene, renderQuadScene } from "../packages/renderer/src/quadblock";
import { zzzColumn, zzzGlyphSize, zzzPhase, ZZZ_BEAT } from "../packages/renderer/src/zzz";
import type { ColorGrid } from "../packages/renderer/src/colorframe";

const strip = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, "");
const buf = (rows: number[][]): number[][] => rows;

describe("quadrant compositor", () => {
  it("maps all 16 quadrant bit patterns to distinct glyphs", () => {
    const glyphs = Object.values(QUAD_GLYPHS);
    expect(glyphs).toHaveLength(16);
    expect(new Set(glyphs).size).toBe(16);
    expect(QUAD_GLYPHS[0b0000]).toBe(" ");
    expect(QUAD_GLYPHS[0b1111]).toBe("█");
    expect(QUAD_GLYPHS[0b1000]).toBe("▘");
    expect(QUAD_GLYPHS[0b0001]).toBe("▗");
  });

  it("packs a 2x2 pixel block into one quadrant cell, ink once per line", () => {
    const lines = paintQuad(buf([[1, 1], [1, 1]]));
    expect(lines).toHaveLength(1);
    expect(strip(lines[0]!)).toBe("█");
    expect(lines[0]).toMatch(/^\u001b\[38;2;/); // one fg prefix, not per cell
    expect(lines[0]!.endsWith("\u001b[0m")).toBe(true);
  });

  it("renders each lone quadrant", () => {
    expect(strip(paintQuad(buf([[1, 0], [0, 0]]))[0]!)).toBe("▘");
    expect(strip(paintQuad(buf([[0, 1], [0, 0]]))[0]!)).toBe("▝");
    expect(strip(paintQuad(buf([[0, 0], [1, 0]]))[0]!)).toBe("▖");
    expect(strip(paintQuad(buf([[0, 0], [0, 1]]))[0]!)).toBe("▗");
  });

  it("grounds sprites 2px above the floor like the half-block path", () => {
    // 4px-high grid (2 cell rows): a 2px sprite grounds at py0-1, bottom stays clear
    const lines = renderQuadScene([{ frame: ["##", "##"], xLeft: 0 }], 1, 2);
    expect(lines.map(strip)).toEqual(["█", " "]);
  });

  it("handles odd pixel widths (last column is a half-cell)", () => {
    // 3px wide grid -> 2 cell columns; the odd trailing px feeds the LAST
    // cell's top-left quadrant only
    const lines = paintQuad(buf([[1, 0, 1], [0, 0, 0]]));
    expect(strip(lines[0]!)).toBe("▘▘");
  });
});

describe("natural blinking", () => {
  it("holds eyes open ~2.9s, then closes for one classic hold", () => {
    const open = (t: number) => pickActivityIndex(2, t, 3, true);
    for (let t = 0; t < BLINK_PERIOD_TICKS - BLINK_CLOSED_TICKS; t++) {
      expect(open(t)).toBe(0); // eyes open
    }
    for (let t = BLINK_PERIOD_TICKS - BLINK_CLOSED_TICKS; t < BLINK_PERIOD_TICKS; t++) {
      expect(open(t)).toBe(1); // the blink
    }
    expect(open(BLINK_PERIOD_TICKS)).toBe(0); // and again
  });

  it("leaves non-blink loops (3+ frames, explicit non-blink) on the plain cycle", () => {
    expect([0, 1, 2, 3, 4, 5].map((t) => pickActivityIndex(3, t, 3))).toEqual([0, 0, 0, 1, 1, 1]);
    expect([0, 1, 2, 3, 4, 5].map((t) => pickActivityIndex(2, t, 3, false))).toEqual([0, 0, 0, 1, 1, 1]);
    expect(pickFrame(["a", "b"], 3, 3)).toBe("b"); // the base cycle is untouched
  });
});

describe("palette quadrant cells (best-effort two-colour packing)", () => {
  const grid = (rows: string[][]): ColorGrid => rows.map((r) => r.map((c) => (c === "." ? null : c)));

  it("packs a two-colour cell losslessly: bg = majority, glyph = minority", () => {
    // one red quadrant among three blue — glyph marks exactly the red one
    const [line] = renderQuadColorScene([{ grid: grid([["#0000ff", "#0000ff"], ["#ff0000", "#0000ff"]]), xLeft: 0 }], 1, 1);
    expect(line).toContain("\u001b[38;2;255;0;0m"); // fg = red (the minority)
    expect(line).toContain("\u001b[48;2;0;0;255m"); // bg = blue (the majority)
    expect(line.replace(/\u001b\[[0-9;]*m/g, "")).toBe("▖");
  });

  it("keeps transparency with the default background and never bleeds", () => {
    // lit cell followed by a hole: the hole must reset the background
    const [line] = renderQuadColorScene([{ grid: grid([["#ff0000", "."], [".", "."]]), xLeft: 0 }], 2, 1);
    const plain = line.replace(/\u001b\[[0-9;]*m/g, "");
    expect(plain).toBe("▘ ");
    expect(line).toContain("\u001b[49m "); // explicit default bg before the hole
  });

  it("folds 3+-colour cells: majority bg, second-colour fg, rest join the bg", () => {
    const [line] = renderQuadColorScene([{ grid: grid([["#ff0000", "#ff0000",], ["#00ff00", "#0000ff"]]), xLeft: 0 }], 1, 1);
    const plain = line.replace(/\u001b\[[0-9;]*m/g, "");
    expect(plain).toBe("▖"); // the green quadrant stays ink; blue folds into the red bg
    expect(line).toContain("\u001b[38;2;0;255;0m"); // fg = the second colour
    expect(line).toContain("\u001b[48;2;255;0;0m"); // bg = the majority colour
  });
});

describe("the sleeping zzz", () => {
  it("cycles three rise phases on a 1.2s beat", () => {
    expect([0, ZZZ_BEAT - 1, ZZZ_BEAT, 2 * ZZZ_BEAT, 3 * ZZZ_BEAT].map(zzzPhase)).toEqual([0, 0, 1, 2, 0]);
  });

  it("grows a bottom-grounded z column that climbs with the phase", () => {
    const cols = [0, 1, 2].map((p) => zzzColumn(16, p as 0 | 1 | 2, 16));
    // heights climb with the phase, glyph rides on top of '.' padding
    cols.forEach((c) => expect(c[0]!.trim()).toBeTruthy());
    expect(cols[0]!.length).toBeLessThan(cols[1]!.length);
    expect(cols[1]!.length).toBeLessThan(cols[2]!.length);
    // every glyph row carries z ink (the diagonal survives every size)
    const zs = zzzGlyphSize(16);
    for (const c of cols) {
      expect(c.length).toBeGreaterThanOrEqual(zs);
      expect(c.slice(-zs).every((r) => r.includes("#"))).toBe(true);
    }
  });

  it("caps the glyph so it fits the roam margin, and the lift so it stays on screen", () => {
    expect(zzzGlyphSize(60)).toBe(7);
    expect(zzzGlyphSize(16)).toBeGreaterThanOrEqual(3);
    const tall = zzzColumn(60, 2, 30);
    expect(tall.length).toBeLessThanOrEqual(30 - 2); // never clips the panel top
  });
});

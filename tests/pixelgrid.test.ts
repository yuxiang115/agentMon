// Pixel-art recovery: an upscaled sprite with soft edges comes back as its
// exact native pixels; flat shapes that aren't pixel art are left alone.

import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { detectPixelGrid, extractPixelArt } from "../pets/pixelgrid";

const COLORS: Record<string, number[]> = {
  k: [5, 5, 5],
  y: [252, 196, 2],
  o: [246, 140, 0],
  g: [17, 171, 1],
};

/** A 20x20 sprite: outlined body, orange belly, one green eye pixel. */
function art(): string[] {
  const rows: string[] = [];
  for (let y = 0; y < 20; y++) {
    let r = "";
    for (let x = 0; x < 20; x++) {
      const inside = x >= 3 && x <= 16 && y >= 2 && y <= 19;
      const edge = inside && (x === 3 || x === 16 || y === 2 || y === 19);
      r += !inside ? "." : edge ? "k" : x === 12 && y === 6 ? "g" : y >= 12 && x >= 7 && x <= 11 ? "o" : "y";
    }
    rows.push(r);
  }
  return rows;
}

/** Upscale by a non-integer factor onto a white canvas, then blur edges
 *  (a 3x3 box over boundaries) like a resized/compressed export. */
function upscale(rows: string[], factor: number, offset: number, canvas = 320): PNG {
  const png = new PNG({ width: canvas, height: canvas });
  const at = (x: number, y: number): number[] => {
    const ax = Math.floor((x - offset) / factor);
    const ay = Math.floor((y - offset) / factor);
    const c = rows[ay]?.[ax];
    return c && c !== "." ? COLORS[c]! : [255, 255, 255];
  };
  for (let y = 0; y < canvas; y++) for (let x = 0; x < canvas; x++) {
    const sum = [0, 0, 0];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = at(x + dx, y + dy);
      for (let i = 0; i < 3; i++) sum[i] += c[i]!;
    }
    png.data.set([...sum.map((v) => Math.round(v / 9)), 255], (y * canvas + x) * 4);
  }
  return png;
}

const hexOf = (c: number[]) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");

describe("pixel-art grid recovery", () => {
  it("finds the art grid's period through blurred edges", () => {
    const grid = detectPixelGrid([upscale(art(), 13.2, 7)]);
    expect(grid).not.toBeNull();
    expect(grid!.period).toBeCloseTo(13.2, 0);
  });

  it("recovers the native pixels exactly, accents included", () => {
    const result = extractPixelArt([upscale(art(), 13.2, 7)]);
    expect(result).not.toBeNull();
    const [native, fine] = result!.layers;
    const want = art().filter((r) => r.includes("k") || r.includes("y")); // lit rows
    const got = native!.frames[0]!.filter((r) => r.some(Boolean));
    expect(got).toHaveLength(want.length);
    const left = Math.min(...native!.frames[0]!.flatMap((r) => r.flatMap((c, x) => (c ? [x] : []))));
    want.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (x < 3 || x > 16) return;
        expect(got[y]![left + x - 3], `pixel ${x},${y}`).toBe(ch === "." ? null : hexOf(COLORS[ch]!));
      });
    });
    // the 2x layer is the same art, each pixel a 2x2 block
    expect(fine!.size).toBeGreaterThanOrEqual(native!.size * 2 - 2);
    expect(result!.palette).toContain(hexOf(COLORS.g!)); // one-pixel eye survives
  });

  it("frames on one canvas share one lattice (animation offsets survive)", () => {
    const a = art();
    const shifted = a.map((r) => "." + r.slice(0, -1)); // the same sprite, one art pixel right
    const result = extractPixelArt([upscale(a, 13.2, 7), upscale(shifted, 13.2, 7)])!;
    const firstLit = (g: Array<Array<string | null>>) => Math.min(...g.flatMap((r) => r.flatMap((c, x) => (c ? [x] : []))));
    const [f0, f1] = result.layers[0]!.frames;
    expect(firstLit(f1!) - firstLit(f0!)).toBe(1);
  });

  it("leaves flat shapes and photos alone", () => {
    const png = new PNG({ width: 64, height: 64 });
    for (let i = 0; i < 64 * 64; i++) png.data.set([255, 255, 255, 255], i * 4);
    for (let y = 20; y < 44; y++) for (let x = 12; x < 52; x++) png.data.set([240, 150, 40, 255], (y * 64 + x) * 4);
    expect(extractPixelArt([png])).toBeNull();
  });
});

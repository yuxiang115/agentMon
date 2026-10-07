import { describe, expect, it } from "vitest";
import {
  bitmapText,
  downsample,
  marquee,
  stripAnsi,
  styleLines,
  FULL,
  LOWER,
  UPPER,
} from "../packages/renderer/src/halfblock";
import { BYTE } from "../pets/sprites/byte";

describe("bitmapText — plan.md §10's four cases", () => {
  it("00 -> space", () => {
    expect(bitmapText(["00", "00"])[0]).toBe("  ");
  });

  it("10 -> ▀ (top pixel on)", () => {
    expect(bitmapText(["10", "00"])[0]).toBe(UPPER + " ");
  });

  it("01 -> ▄ (bottom pixel on)", () => {
    expect(bitmapText(["00", "01"])[0]).toBe(" " + LOWER);
  });

  it("11 -> █ (both pixels on)", () => {
    expect(bitmapText(["11", "11"])[0]).toBe(FULL + FULL);
  });

  it("accepts '#'/'. pixels too", () => {
    expect(bitmapText(["#.", ".."])[0]).toBe(UPPER + " ");
  });

  it("pads odd heights with an empty row", () => {
    expect(bitmapText(["10"])).toEqual([UPPER + " "]);
  });

  it("returns no ANSI — styling is a separate step", () => {
    for (const line of bitmapText(BYTE.poses.idleA)) expect(line).not.toMatch(/\x1b/);
  });

  it("a 16x16 sprite renders as 8 lines x 16 columns", () => {
    const lines = bitmapText(BYTE.poses.idleA);
    expect(lines).toHaveLength(8);
    for (const line of lines) expect(line.length).toBe(16);
  });

  it("styleLines adds ANSI that stripAnsi removes", () => {
    const styled = styleLines(bitmapText(BYTE.poses.idleA), "#2b2e31", "#c6c9cc");
    expect(styled[0]).toMatch(/\x1b\[/);
    expect(stripAnsi(styled[0])).toBe(bitmapText(BYTE.poses.idleA)[0]);
  });
});

describe("marquee", () => {
  it("returns text unchanged when it fits", () => {
    expect(marquee("abc", 5, 99)).toBe("abc");
  });

  it("holds on the head, then slides", () => {
    const s = "abcdef";
    expect(marquee(s, 3, 0)).toBe("abc");
    expect(marquee(s, 3, 8)).toBe("abc"); // still holding (hold=8)
    expect(marquee(s, 3, 9)).toBe("bcd"); // starts sliding
    expect(marquee(s, 3, 12)).toBe("ef ");
  });
});

describe("downsample", () => {
  it("halves a 2x2 block by majority rule", () => {
    const out = downsample(["11", "10"], 2);
    expect(out).toEqual(["1"]);
    expect(downsample(["10", "00"], 2)).toEqual(["0"]);
  });
});

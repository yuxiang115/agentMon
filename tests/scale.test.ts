// Pet-size scaling (16..60): scaleRows resamples authored poses without
// inventing colours, and the display geometry helpers keep the classic
// 32x16 LCD at the default size.

import { describe, expect, it } from "vitest";
import { scaleRows } from "../packages/renderer/src/scale";
import {
  PET_SIZE_DEFAULT,
  PET_SIZE_MAX,
  PET_SIZE_MIN,
  clampPetSize,
  overlayWidthFor,
  petAreaWidth,
  petCharRows,
  petSizeOf,
} from "../packages/pi-extension/widget";
import { freshState } from "../packages/core/pet";

describe("scaleRows — nearest-neighbour pose resampling", () => {
  const pose = [
    "..aa..",
    "..aa..",
    "bbbbbb",
    "..cc..",
  ];

  it("integer upscale duplicates pixels without inventing values", () => {
    const up = scaleRows(pose, 12); // 4x6 -> 12x12 (3x each axis)
    expect(up).toHaveLength(12);
    expect(up.every((r) => r.length === 12)).toBe(true);
    expect(new Set(up.join(""))).toEqual(new Set("abc."));
    // source row 0 (..aa..) maps to output rows 0-2, each pixel tripling
    expect(up[0]).toBe("....aaaa....");
    expect(up[2]).toBe("....aaaa....");
    expect(up[6]).toBe("bbbbbbbbbbbb"); // source row 2 (bbbbbb) -> rows 6-8
  });

  it("identity at the source size", () => {
    const rows16 = Array.from({ length: 16 }, (_, y) => (y === 8 ? "....xxxx........" : ".".repeat(16)));
    expect(scaleRows(rows16, 16)).toEqual(rows16);
  });

  it("non-multiple sizes sample every source pixel neighbourhood", () => {
    const up = scaleRows(["ab"], 3); // 1x2 -> 3 wide, 3 rows
    expect(up).toEqual(["abb", "abb", "abb"]); // the b half is wider at 3/2
  });

  it("treats short rows as transparent padding", () => {
    const up = scaleRows(["ab", "a"], 4); // 2x2 -> 4x4
    expect(up).toEqual(["aabb", "aabb", "aa..", "aa.."]); // row "a" pads with '.'
  });
});

describe("pet size settings (16..60)", () => {
  it("clamps into range with sensible defaults", () => {
    expect(PET_SIZE_MIN).toBe(16);
    expect(PET_SIZE_MAX).toBe(60);
    expect(PET_SIZE_DEFAULT).toBe(16);
    expect(clampPetSize(48)).toBe(48);
    expect(clampPetSize(4)).toBe(16);
    expect(clampPetSize(500)).toBe(60);
    expect(clampPetSize(NaN)).toBe(16);
  });

  it("default geometry is the classic 32x16 LCD; larger sizes grow it", () => {
    expect(petAreaWidth(16)).toBe(32); // 16 sprite + 16 walking room
    expect(petCharRows(16)).toBe(8);
    expect(overlayWidthFor(16)).toBe(36); // + border and padding
    expect(petAreaWidth(60)).toBe(76);
    expect(petCharRows(60)).toBe(30);
    expect(overlayWidthFor(60)).toBe(80);
    expect(petCharRows(25)).toBe(13); // odd sizes round up a row
  });

  it("petSizeOf reads persisted ui settings and clamps corrupt values", () => {
    expect(petSizeOf(freshState(0))).toBe(16);
    expect(petSizeOf({ ...freshState(0), ui: { petSize: 40 } })).toBe(40);
    expect(petSizeOf({ ...freshState(0), ui: { petSize: 9999 } })).toBe(60);
  });
});

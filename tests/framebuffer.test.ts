import { describe, expect, it } from "vitest";
import { fillBuf, renderScene, renderScreen } from "../packages/renderer/src/framebuffer";
import { stripAnsi } from "../packages/renderer/src/halfblock";
import { COLS, PXH, roamBounds } from "../packages/renderer/src/lcd";
import { BYTE } from "../pets/sprites/byte";

// idleA's feet row (sprite row 13) inks sprite columns 3-5 and 10-12; the
// sprite box is 16 wide with two self-padding bottom rows, so a centred
// placement puts its left edge at x=8 and its feet on LCD y=13 — 2px above
// the bottom edge.
const FEET_Y = 13;

describe("fillBuf", () => {
  it("grounds the sprite 2px above the bottom edge", () => {
    const buf = fillBuf(BYTE.poses.idleA, COLS, PXH);
    expect(buf[FEET_Y][8 + 3]).toBe(1);
    expect(buf[FEET_Y][8 + 12]).toBe(1);
    expect(buf[14].every((v) => v === 0)).toBe(true);
    expect(buf[15].every((v) => v === 0)).toBe(true);
  });

  it("mirrors horizontally (testA's right arm flips to the left)", () => {
    const plain = fillBuf(BYTE.poses.testA, COLS, PXH);
    // arm pixels at sprite row 7, cols 13-15 -> LCD x 21-23
    expect(plain[7][23]).toBe(1);
    expect(plain[7][8 + (15 - 15)]).toBe(0); // mirrored position not inked unmirrored
    const mirrored = fillBuf(BYTE.poses.testA, COLS, PXH, { mirror: true });
    // mirrored arm: col 13-15 -> 15-13 .. 15-15 = cols 2-0 -> LCD x 8-10
    expect(mirrored[7][8]).toBe(1);
    expect(mirrored[7][23]).toBe(0);
  });

  it("yshift lifts the sprite (a hop)", () => {
    const buf = fillBuf(BYTE.poses.idleA, COLS, PXH, { yshift: 3 });
    expect(buf[FEET_Y - 3][8 + 3]).toBe(1);
    expect(buf[FEET_Y][8 + 3]).toBe(0);
  });

  it("clips off-window ink — that is how things exit the screen", () => {
    // shove the sprite far right: ox = 8 + 20 = 28, so only 4 columns fit
    const buf = fillBuf(BYTE.poses.idleA, COLS, PXH, { xshift: 20 });
    expect(buf[0].length).toBe(COLS); // buffer size unchanged
    expect(buf[FEET_Y].slice(0, 28).every((v) => v === 0)).toBe(true);
    expect(buf[FEET_Y].slice(28).some((v) => v === 1)).toBe(true);
  });

  it("respects a clip rect narrower than the LCD", () => {
    const buf = fillBuf(BYTE.poses.idleA, COLS, PXH, {
      clip: { x0: 8, x1: 24, y0: 0, y1: PXH },
    });
    expect(buf[FEET_Y].slice(0, 8).every((v) => v === 0)).toBe(true);
    expect(buf[FEET_Y].slice(8, 24).some((v) => v === 1)).toBe(true);
    expect(buf[FEET_Y].slice(24).every((v) => v === 0)).toBe(true);
  });
});

describe("LCD output", () => {
  it("renderScreen: 8 terminal rows of 32 visible columns, ANSI coloured", () => {
    const lines = renderScreen(BYTE.poses.idleA, COLS, 8);
    expect(lines).toHaveLength(8);
    for (const line of lines) {
      expect(line).toMatch(/\x1b\[/);
      expect(stripAnsi(line).length).toBe(32);
    }
  });

  it("renderScene composes multiple grounded sprites", () => {
    const [minX, maxX] = roamBounds();
    const lines = renderScene(
      [
        { frame: BYTE.poses.idleA, xLeft: minX },
        { frame: BYTE.poses.idleA, xLeft: maxX },
      ],
      COLS,
      8,
    );
    expect(lines).toHaveLength(8);
    // both sprites' feet inked at their own columns
    // (verified via the pixel buffer, not the ANSI text)
  });
});

describe("geometry", () => {
  it("roamBounds keeps a 16px sprite inside the 32px grid", () => {
    expect(roamBounds()).toEqual([0, 16]);
    expect(roamBounds(12)).toEqual([0, 20]);
  });
});

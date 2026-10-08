import { describe, expect, it } from "vitest";
import {
  bitmapText,
  detectColorMode,
  downsample,
  fgColor,
  bgColor,
  marquee,
  quantize256,
  setColorMode,
  stripAnsi,
  styleLines,
  FULL,
  LOWER,
  UPPER,
} from "../packages/renderer/src/halfblock";
import { poseToColorGrid, renderColorScene } from "../packages/renderer/src/colorframe";
import { afterEach } from "vitest";
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

describe("256-colour fallback (terminals without truecolor)", () => {
  afterEach(() => setColorMode("true"));

  it("quantizes known colours to their xterm-256 indices", () => {
    // exact palette members match the base-16 entries first
    expect(quantize256("#000000")).toBe(0);
    expect(quantize256("#ff0000")).toBe(9); // bright red
    expect(quantize256("#ffffff")).toBe(15);
    expect(quantize256("#808080")).toBe(244); // grey ramp hit exactly
    // off-palette colours snap to the nearest cube step
    expect(quantize256("#ff8700")).toBe(208); // cube (255,135,0)
  });

  it("fgColor/bgColor emit 38;5 / 48;5 in 256 mode, 38;2 in truecolor", () => {
    expect(fgColor("#ff0000")).toBe("\x1b[38;2;255;0;0m");
    expect(bgColor("#ff0000")).toBe("\x1b[48;2;255;0;0m");
    setColorMode("256");
    expect(fgColor("#ff0000")).toBe("\x1b[38;5;9m");
    expect(bgColor("#ff0000")).toBe("\x1b[48;5;9m");
  });

  it("detectColorMode: COLORTERM/TERM truecolor or the AGENTMON_COLOR override", () => {
    expect(detectColorMode({ COLORTERM: "truecolor" } as NodeJS.ProcessEnv)).toBe("true");
    expect(detectColorMode({ COLORTERM: "24bit" } as NodeJS.ProcessEnv)).toBe("true");
    expect(detectColorMode({ TERM: "xterm-truecolor" } as NodeJS.ProcessEnv)).toBe("true");
    // macOS Terminal.app: neither is set
    expect(detectColorMode({ TERM: "xterm-256color" } as NodeJS.ProcessEnv)).toBe("256");
    expect(detectColorMode({} as NodeJS.ProcessEnv)).toBe("256");
    // manual override wins both ways
    expect(detectColorMode({ COLORTERM: "truecolor", AGENTMON_COLOR: "256" } as NodeJS.ProcessEnv)).toBe("256");
    expect(detectColorMode({ AGENTMON_COLOR: "true" } as NodeJS.ProcessEnv)).toBe("true");
  });

  it("the colour render path honours the mode end-to-end", () => {
    const grid = poseToColorGrid(["aa", "aa"].concat(Array(14).fill("..")), { a: "#ff0000" }, 16);
    expect(renderColorScene([{ grid, xLeft: 0 }], 16, 8)[0]).toContain("\x1b[38;2;255;0;0m");
    setColorMode("256");
    expect(renderColorScene([{ grid, xLeft: 0 }], 16, 8)[0]).toContain("\x1b[38;5;9m");
  });
});

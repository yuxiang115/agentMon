import { describe, expect, it } from "vitest";
import {
  paletteFromHexGrids,
  pngToHexGrid,
} from "../pets/imagepack";
import {
  poseToColorGrid,
  renderColorScene,
} from "../packages/renderer/src/colorframe";
import { stripAnsi, UPPER, LOWER, FULL } from "../packages/renderer/src/halfblock";
import { PNG } from "pngjs";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPetPacks } from "../pets/packs";

describe("renderColorScene — pi-pets-style cells", () => {
  const grid = poseToColorGrid(
    ["................",
     "........aa......",
     "........bb......",
     "........cc......",
     "........cc......",
     "........cc......"].concat(Array(10).fill("................")),
    { a: "#ff0000", b: "#0000ff", c: "#00ff00", d: "#00ff00" },
  );

  it("maps pixel pairs to the four cell shapes with 24-bit colours", () => {
    const lines = renderColorScene([{ grid, xLeft: 8 }], 32, 8);
    expect(lines).toHaveLength(8);
    // pixel rows pair as (0,1)(2,3)(4,5): (empty,red) (blue,green) (green,green)
    expect(lines[0]).toContain(`\x1b[38;2;255;0;0m${LOWER}`); // bottom-only: red ▄
    expect(lines[1]).toContain(`\x1b[38;2;0;0;255m\x1b[48;2;0;255;0m${UPPER}`); // blue over green
    expect(lines[2]).toContain(`\x1b[38;2;0;255;0m${FULL}`); // same colour: green █
    // empty columns are plain spaces
    const stripped = stripAnsi(lines[7]);
    expect(stripped).toBe(" ".repeat(32));
  });

  it("top-only pixels render ▀, bottom-only render ▄", () => {
    const g = poseToColorGrid(
      ["..a.............",
       "................",
       "................",
       "..............b."].concat(Array(12).fill("................")),
      { a: "#ff0000", b: "#0000ff" },
    );
    const lines = renderColorScene([{ grid: g, xLeft: 0 }], 16, 8);
    expect(lines[0]).toContain(`\x1b[38;2;255;0;0m${UPPER}`); // pixel row 0: top only
    expect(lines[1]).toContain(`\x1b[38;2;0;0;255m${LOWER}`); // pixel row 3: bottom only
  });

  it("every coloured cell resets immediately — no bg bleeding into trailing spaces", () => {
    const g = poseToColorGrid(
      ["..a.............", "..b............."].concat(Array(14).fill("................")),
      { a: "#ff0000", b: "#0000ff" },
    );
    const lines = renderColorScene([{ grid: g, xLeft: 0 }], 16, 8);
    // the split cell resets right after the glyph, and the rest of the row is bare spaces
    expect(lines[0]).toContain(`\x1b[38;2;255;0;0m\x1b[48;2;0;0;255m${UPPER}\x1b[0m `);
    const after = lines[0]!.slice(lines[0]!.indexOf(`m${UPPER}\x1b[0m `) + UPPER.length + 5);
    expect(after).toBe(" ".repeat(13)); // nothing but spaces to the row's end
  });

  it("mirrors the placement horizontally", () => {
    const g = poseToColorGrid(
      ["..a.............", "................"].concat(Array(14).fill("................")),
      { a: "#ff0000" },
    );
    const plain = renderColorScene([{ grid: g, xLeft: 0 }], 16, 8);
    const mirrored = renderColorScene([{ grid: g, xLeft: 0, mirror: true }], 16, 8);
    const p = stripAnsi(plain[0]).indexOf(UPPER);
    const m = stripAnsi(mirrored[0]).lastIndexOf(UPPER);
    expect(m).toBeGreaterThan(p);
    expect(p + m).toBe(15); // symmetric flip within the 16-wide row
  });
});

describe("colour extraction", () => {
  function pngWith(px: (x: number, y: number) => [number, number, number] | null): PNG {
    const png = new PNG({ width: 16, height: 16 });
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const i = (16 * y + x) << 2;
        const c = px(x, y);
        if (c) {
          png.data[i] = c[0];
          png.data[i + 1] = c[1];
          png.data[i + 2] = c[2];
        } else {
          png.data[i] = png.data[i + 1] = png.data[i + 2] = 255;
        }
        png.data[i + 3] = 255;
      }
    }
    return png;
  }

  it("aspect-fills the canvas; enclosed white (eye) stays a pixel, border bg is transparent", () => {
    // orange body with a white eye, on a white background
    const png = pngWith((x, y) => {
      if (x >= 4 && x < 12 && y >= 4 && y < 12) {
        if (x === 6 && y === 6) return [255, 255, 255]; // eye == background colour
        return [240, 150, 40];
      }
      return null;
    });
    const grid = pngToHexGrid(png, {});
    expect(grid[8]![7]).toBe("#ffa020"); // quantized orange (240/150/40 -> 255/160/32)
    expect(grid[0]![0]).toBeNull(); // canvas padding transparent
    // GPT-converter fidelity rule: only BORDER-CONNECTED background is
    // transparent; the enclosed eye stays a literal white pixel
    expect(grid[4]![4]).toBe("#ffffff");
    // bbox crop + aspect fill: the 8x8 content scales up to span 14 cells
    const xs: number[] = [];
    grid.forEach((row, y) => row.forEach((c, x) => { if (c) xs.push(x); }));
    expect(Math.min(...xs)).toBe(1);
    expect(Math.max(...xs)).toBe(14);

    const { palette, rows } = paletteFromHexGrids([grid]);
    expect(Object.keys(palette)).toHaveLength(2); // orange + enclosed white
    expect(rows[0]![8]![8]).not.toBe(".");
    expect(rows[0]![4]![4]).not.toBe("."); // the eye renders, not a hole
  });

  it("folds rare colours into the nearest kept colour", () => {
    const png = pngWith((x, y) => {
      if (x >= 4 && x < 12 && y >= 4 && y < 12) return [240, 150, 40];
      if (x === 2 && y === 8) return [10, 10, 200]; // one rare blue pixel
      return null;
    });
    const { palette, rows } = paletteFromHexGrids([pngToHexGrid(png, {})], 1);
    expect(Object.keys(palette)).toHaveLength(1); // only orange kept
    // the blue pixel sits at the crop's left edge (grid col 1, row 7 after
    // bbox re-centring) and folds to orange instead of dropping out
    expect(rows[0]![7]![1]).not.toBe(".");
  });
});

describe("colour pack round-trip through the loader", () => {
  it("a palette pack loads and renders in colour", () => {
    const rows = ["....aaaa....", "..aaaaaaaa.."].concat(Array(14).fill("............"));
    // pad rows to 16 cols
    const padded = rows.map((r) => r.padEnd(16, "."));
    const pack = {
      name: "Colourmon pack",
      species: [
        {
          id: "colourmon",
          name: "Colourmon",
          stage: "branch",
          palette: { a: "#f0a020" },
          poses: { idle1: padded },
          roles: { idle: ["idle1"] },
        },
      ],
    };
    const dir = mkdtempSync(join(tmpdir(), "agentmon-colour-"));
    try {
      mkdirSync(join(dir, "cm-pack"), { recursive: true });
      writeFileSync(join(dir, "cm-pack", "pack.json"), JSON.stringify(pack), "utf8");
      const loaded = loadPetPacks(dir);
      expect(loaded.errors).toEqual([]);
      const sp = loaded.species[0]!;
      expect(sp.palette).toEqual({ a: "#f0a020" });
      const lines = renderColorScene(
        [{ grid: poseToColorGrid(sp.poses.idle1!, sp.palette!), xLeft: 8 }],
      );
      expect(lines.join("")).toContain("\x1b[38;2;");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("palette rows referencing unknown chars are rejected", () => {
    const rows = Array(16).fill("....zzzz........");
    const pack = {
      name: "Bad pack",
      species: [{ id: "badmon", palette: { a: "#ff0000" }, poses: { idle1: rows }, roles: { idle: ["idle1"] } }],
    };
    const dir = mkdtempSync(join(tmpdir(), "agentmon-badcolour-"));
    try {
      mkdirSync(join(dir, "bp"), { recursive: true });
      writeFileSync(join(dir, "bp", "pack.json"), JSON.stringify(pack), "utf8");
      const loaded = loadPetPacks(dir);
      expect(loaded.errors[0]).toContain("idle1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

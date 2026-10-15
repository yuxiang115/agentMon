import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { applyPalette, buildPaletteFromHexGrids, pngToHexGrid, prepareImage, sampleImage, sharedViewport, type HexGrid } from "../pets/image-color";
import { pngToPosesLayers } from "../pets/imagepack";
import { petArguments } from "../packages/pi-extension/args";

function canvas(size: number, color: number[] = [255, 255, 255, 255]): PNG {
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < size * size; i++) png.data.set(color, i * 4);
  return png;
}
function rect(png: PNG, x: number, y: number, w: number, h: number, color: number[]) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) png.data.set(color, (yy * png.width + xx) * 4);
}

describe("faithful image imports", () => {
  it("masks at source resolution, preserving enclosed white and explicit alpha holes", () => {
    const png = canvas(32);
    rect(png, 4, 4, 24, 24, [5, 5, 5, 255]);
    rect(png, 5, 5, 22, 22, [255, 255, 255, 255]);
    rect(png, 14, 14, 4, 4, [255, 0, 255, 0]);
    const image = prepareImage(png);
    expect(image.foreground[0]).toBe(0);
    expect(image.foreground[10 * 32 + 10]).toBe(1);
    expect(image.foreground[15 * 32 + 15]).toBe(0);
    const grid = sampleImage(image, { size: 16 });
    expect(grid.flat()).toContain("#ffffff");
    expect(grid.flat()).not.toContain("#ff00ff");
    expect(grid[8][8]).toBeNull();
  });

  it("uses alpha rather than erasing white body parts on a transparent canvas", () => {
    const png = canvas(16, [0, 0, 0, 0]);
    rect(png, 4, 4, 8, 8, [255, 255, 255, 255]);
    expect(pngToHexGrid(png).flat().filter(Boolean).every((c) => c === "#ffffff")).toBe(true);
  });

  it("keeps a shared body stationary when a later frame adds a prop", () => {
    const a = canvas(64), b = canvas(64);
    for (const png of [a, b]) rect(png, 20, 20, 16, 32, [245, 160, 20, 255]);
    rect(b, 40, 20, 16, 10, [0, 100, 255, 255]);
    const images = [prepareImage(a), prepareImage(b)];
    const viewport = sharedViewport(images);
    const body = (grid: HexGrid) => grid.flatMap((row, y) => row.flatMap((c, x) => c === "#f5a014" ? [`${x},${y}`] : []));
    expect(body(sampleImage(images[0], { size: 40, viewport }))).toEqual(body(sampleImage(images[1], { size: 40, viewport })));
  });

  it("preserves tiny details in high-res palettes even when absent from the 16px base", () => {
    // Transparent border so the orange body is the subject: edge-flood
    // background removal keeps it, and the 1px green speck survives only
    // in the hi-res layers (nearest sampling skips it at 16px).
    const png = canvas(64, [0, 0, 0, 0]);
    rect(png, 1, 1, 62, 62, [240, 150, 40, 255]);
    rect(png, 30, 30, 1, 1, [0, 255, 0, 255]);
    const result = pngToPosesLayers(png);
    const green = Object.entries(result.palette).find(([, color]) => color === "#00ff00")?.[0];
    expect(green).toBeTruthy();
    expect(result.poses.idleA.join("")).not.toContain(green);
    expect(result.hiPoses["64"].idleA.join("")).toContain(green);
    expect(result.hiPoses["40"].idleA).toHaveLength(40);
  });

  it("area sampling excludes removed background from its RGB average", () => {
    const png = canvas(64);
    rect(png, 16, 16, 32, 32, [210, 80, 10, 255]);
    const grid = pngToHexGrid(png, { size: 16, sampling: "area" });
    expect(new Set(grid.flat().filter(Boolean))).toEqual(new Set(["#d2500a"]));
  });

  it("keeps neutral ramps instead of collapsing all light shades, and maps arbitrary palette keys", () => {
    const grid = [["#c0c0c0", "#dddddd", "#ffffff", "#445566"]];
    expect(Object.values(buildPaletteFromHexGrids([grid]))).toHaveLength(4);
    expect(applyPalette([[['#ff0000', null]]], { Z: "#ff0000" })).toEqual([["Z."]]);
    const many = [Array.from({ length: 256 }, (_, n) => `#${n.toString(16).padStart(2, "0").repeat(3)}`)];
    const palette = buildPaletteFromHexGrids([many]);
    expect(Object.keys(palette)).toHaveLength(64);
    expect(applyPalette([many], palette)[0][0]).toHaveLength(256);
  });

  it("imports quoted Windows paths with spaces without eating backslashes", () => {
    expect(petArguments('import "C:\\My Sprites\\source_crops" "Agumon HD"')).toEqual(["import", "C:\\My Sprites\\source_crops", "Agumon HD"]);
    expect(petArguments("rename Agumon's friend")).toEqual(["rename", "Agumon's", "friend"]);
    expect(() => petArguments('import "unfinished')).toThrow("unclosed quote");
  });
});

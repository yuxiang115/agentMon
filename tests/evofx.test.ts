// The digivolve moment: phase plan math, colour washing, and the shared
// evoPoseGrid integration (old/new species at any render size).

import { describe, expect, it } from "vitest";
import {
  EVO_BURST_MS,
  EVO_CHARGE_MS,
  EVO_TOTAL_MS,
  evolvePlan,
  silhouetteGrid,
  whiten,
  whitenGrid,
} from "../packages/renderer/src/evofx";
import { evoPoseGrid, dominantColorOf, speciesPoseGrid } from "../packages/pi-extension/widget";
import { BYTE } from "../pets/sprites/byte";
import { SCOUT } from "../pets/sprites/scout";
import type { ColorGrid } from "../packages/renderer/src/colorframe";

describe("evolvePlan — the three-phase transform", () => {
  it("charge: old form, whiteness ramps 0 -> 1, flicker on", () => {
    const start = evolvePlan(0);
    expect(start.stage).toBe("charge");
    expect(start.form).toBe("old");
    expect(start.whiteness).toBe(0);
    expect(start.flicker).toBe(true);
    const mid = evolvePlan(EVO_CHARGE_MS / 2);
    expect(mid.whiteness).toBeCloseTo(0.5);
    expect(evolvePlan(EVO_CHARGE_MS - 1).whiteness).toBeLessThan(1);
  });

  it("burst: new-form silhouette strobing white every other 100ms beat", () => {
    const b = evolvePlan(EVO_CHARGE_MS + 50);
    expect(b.stage).toBe("burst");
    expect(b.form).toBe("new");
    expect(b.silhouette).toBe(true);
    expect(b.flashWhite).toBe(true); // beat 12 of the 100ms grid
    expect(evolvePlan(EVO_CHARGE_MS + 150).flashWhite).toBe(false); // beat 13
  });

  it("reveal: new form washes back from white; then done", () => {
    const r = evolvePlan(EVO_CHARGE_MS + EVO_BURST_MS);
    expect(r.stage).toBe("reveal");
    expect(r.whiteness).toBe(1);
    expect(evolvePlan(EVO_TOTAL_MS - 1).whiteness).toBeGreaterThan(0);
    expect(evolvePlan(EVO_TOTAL_MS).stage).toBe("done");
    expect(evolvePlan(EVO_TOTAL_MS + 5_000).stage).toBe("done");
  });
});

describe("colour math", () => {
  it("whiten lerps toward white and clamps", () => {
    expect(whiten("#000000", 0)).toBe("#000000");
    expect(whiten("#000000", 1)).toBe("#ffffff");
    expect(whiten("#804020", 0.5)).toBe("#c0a090");
    expect(whiten("#ff0000", 2)).toBe("#ffffff"); // over-drive clamps
    expect(whiten("#ff0000", -1)).toBe("#ff0000");
  });

  it("whitenGrid keeps transparent cells null; t=0 is identity", () => {
    const grid: ColorGrid = [[null, "#010203"], ["#010203", null]];
    expect(whitenGrid(grid, 0)).toBe(grid);
    const washed = whitenGrid(grid, 1);
    expect(washed[0]![0]).toBeNull();
    expect(washed[0]![1]).toBe("#ffffff");
  });

  it("silhouetteGrid flattens lit pixels to one colour", () => {
    const grid: ColorGrid = [[null, "#ff0000"], ["#00ff00", null]];
    const sil = silhouetteGrid(grid, "#123456");
    expect(sil).toEqual([[null, "#123456"], ["#123456", null]]);
  });
});

describe("evoPoseGrid — shared view integration", () => {
  it("charge draws the OLD species washed toward white", () => {
    const grid = evoPoseGrid(evolvePlan(0), BYTE, SCOUT, "idle", 3, 16);
    expect(grid).toBeTruthy();
    // byte is mono: the grid is its flat ink colour, unwashed at t=0
    const lit = grid!.flat().filter((c): c is string => c !== null);
    expect(lit.length).toBeGreaterThan(0);
    expect(new Set(lit)).toEqual(new Set([BYTE.ink ?? "#2b2e31"]));
  });

  it("mid-charge washes every lit pixel lighter than the pure ink", () => {
    const grid = evoPoseGrid(evolvePlan(EVO_CHARGE_MS / 2), BYTE, SCOUT, "idle", 3, 16);
    const lit = grid!.flat().filter((c): c is string => c !== null);
    for (const c of lit) expect(c).not.toBe("#000000");
  });

  it("burst strobes the NEW species as a flat silhouette", () => {
    const plan = evolvePlan(EVO_CHARGE_MS + 50); // flashWhite beat
    const grid = evoPoseGrid(plan, BYTE, SCOUT, "idle", 3, 16);
    const lit = grid!.flat().filter((c): c is string => c !== null);
    expect(new Set(lit)).toEqual(new Set(["#ffffff"]));
    const colourBeat = evoPoseGrid(evolvePlan(EVO_CHARGE_MS + 150), BYTE, SCOUT, "idle", 3, 16);
    const lit2 = colourBeat!.flat().filter((c): c is string => c !== null);
    expect(new Set(lit2).size).toBe(1);
    expect(lit2[0]).not.toBe("#ffffff"); // the dominant-colour beat
  });

  it("done returns null so views fall back to normal rendering", () => {
    expect(evoPoseGrid(evolvePlan(EVO_TOTAL_MS), BYTE, SCOUT, "idle", 3, 16)).toBeNull();
  });

  it("works at hi-res sizes: charge washes the OLD species' layer-scaled ink", () => {
    const paletteSpecies = {
      id: "p",
      name: "P",
      stage: "branch" as const,
      palette: { a: "#ff8c00", b: "#ffffff" },
      poses: { idle1: Array.from({ length: 16 }, () => "a".repeat(16)) },
      roles: { idle: ["idle1"] },
      hiPoses: { "32": { idle1: Array.from({ length: 32 }, () => "b".repeat(32)) } },
    };
    const grid = evoPoseGrid(evolvePlan(EVO_CHARGE_MS / 2), BYTE, paletteSpecies, "idle", 3, 32);
    expect(grid).toHaveLength(32);
    const lit = grid!.flat().filter((c): c is string => c !== null);
    expect(new Set(lit)).toEqual(new Set([whiten("#2b2e31", 0.5)])); // BYTE (old form) ink, washed
    expect(dominantColorOf(paletteSpecies, Array.from({ length: 16 }, () => "ab".repeat(8)))).toBe("#ff8c00");
    expect(dominantColorOf(BYTE, BYTE.poses.idleA!)).toBe("#2b2e31"); // mono default ink, never white
  });

  it("speciesPoseGrid maps mono poses to a flat ink grid", () => {
    const grid = speciesPoseGrid(BYTE, BYTE.poses.idleA!, 16);
    const lit = grid.flat().filter((c): c is string => c !== null);
    expect(lit.length).toBeGreaterThan(0);
    expect(new Set(lit).size).toBe(1);
  });
});

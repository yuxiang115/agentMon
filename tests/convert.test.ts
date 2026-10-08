import { describe, expect, it } from "vitest";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  DEFAULT_TUIPET_POSE_MAP,
  parsePoseMapArg,
  slugify,
  tuipetRecordsToPack,
  type TuipetSpriteRecord,
} from "../pets/convert";
import { loadPetPacks } from "../pets/packs";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Synthetic, ORIGINAL fixtures — simple distinct patterns, nothing extracted.
function frame(fill: string): string[] {
  return Array.from({ length: 16 }, (_, y) =>
    (fill + (y % 10)).padEnd(16, "0").slice(0, 16),
  );
}

const RECORD: TuipetSpriteRecord = {
  num: 1,
  name: "Testmon",
  stage: "Rookie",
  w: 16,
  h: 16,
  frames: Array.from({ length: 11 }, (_, i) => frame("1".repeat(i + 1))),
};

describe("tuipet converter", () => {
  it("builds a loadable pack from a record", () => {
    const r = tuipetRecordsToPack([RECORD], ["Testmon"], { map: DEFAULT_TUIPET_POSE_MAP });
    expect(r.missing).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.pack.species[0]).toMatchObject({ id: "testmon", name: "Testmon", stage: "branch" });

    // end-to-end: write it out and load with the real pack loader
    const dir = mkdtempSync(join(tmpdir(), "agentmon-conv-"));
    try {
      const packDir = join(dir, "conv");
      mkdirSync(packDir, { recursive: true });
      writeFileSync(join(packDir, "pack.json"), JSON.stringify(r.pack), "utf8");
      const loaded = loadPetPacks(dir);
      expect(loaded.errors).toEqual([]);
      expect(loaded.species[0]!.id).toBe("testmon");
      expect(loaded.species[0]!.poses.think).toEqual(frame("1".repeat(4 + 1)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("missing/null frames fall back to frame 0 and are padded to 16x16", () => {
    const sparse: TuipetSpriteRecord = {
      name: "Sparse",
      frames: [frame("1111"), null, ["11", "1"], ...Array(8).fill(null)],
    };
    const r = tuipetRecordsToPack([sparse], ["Sparse"], { map: DEFAULT_TUIPET_POSE_MAP });
    expect(r.warnings).toEqual([]);
    const poses = r.pack.species[0]!.poses as Record<string, string[]>;
    expect(poses.sleep.length).toBe(16);
    expect(poses.sleep[0]!.length).toBe(16);
    // short rows padded, not rejected
    expect(poses.codeA.every((row) => row.length === 16)).toBe(true);
  });

  it("reports requested names that don't exist", () => {
    const r = tuipetRecordsToPack([RECORD], ["Testmon", "Nope"], { map: DEFAULT_TUIPET_POSE_MAP });
    expect(r.missing).toEqual(["Nope"]);
    expect(r.pack.species).toHaveLength(1);
  });

  it("--chain wires byte -> each name with rotating axes", () => {
    const second: TuipetSpriteRecord = { ...RECORD, name: "Bigmon" };
    const r = tuipetRecordsToPack(
      [RECORD, second],
      ["Testmon", "Bigmon"],
      { map: DEFAULT_TUIPET_POSE_MAP, chain: true },
    );
    expect(r.pack.evolutions).toEqual([
      { from: "byte", to: "testmon", gates: expect.objectContaining({ axis: "research" }) },
      { from: "testmon", to: "bigmon", gates: expect.objectContaining({ axis: "implementation" }) },
    ]);
  });

  it("parsePoseMapArg overrides specific slots and rejects garbage", () => {
    const { map, errors } = parsePoseMapArg("think=3,codeA=7");
    expect(errors).toEqual([]);
    expect(map.think).toBe(3);
    expect(map.codeA).toBe(7);
    expect(map.idleA).toBe(DEFAULT_TUIPET_POSE_MAP.idleA);
    const bad = parsePoseMapArg("nope=1,think=x");
    expect(bad.errors).toHaveLength(2);
  });

  it("slugify tames arbitrary names", () => {
    expect(slugify("Agumon (Black)")).toBe("agumon-black");
    expect(slugify("亚古兽")).toBe("pet"); // non-ASCII falls back — use romaji ids
  });

  it("gzipped extraction files decode transparently (CLI handles .gz)", () => {
    const gz = gzipSync(JSON.stringify([RECORD]));
    const back = JSON.parse(gunzipSync(gz).toString("utf8")) as TuipetSpriteRecord[];
    const r = tuipetRecordsToPack(back, ["Testmon"], { map: DEFAULT_TUIPET_POSE_MAP });
    expect(r.pack.species).toHaveLength(1);
  });
});

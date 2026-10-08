import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  autoPoses,
  buildImagePack,
  collectActivityFiles,
  pngToBitmap,
  posesFromFolder,
  posesFromFrames,
  sheetToBitmaps,
} from "../pets/imagepack";
import { loadPetPacks } from "../pets/packs";

/** A synthetic PNG: dark blob of the given size centered on transparent bg. */
function blobPng(w: number, h: number, blobW = 8, blobH = 8, darken = true): PNG {
  const png = new PNG({ width: w, height: h });
  const x0 = Math.floor((w - blobW) / 2);
  const y0 = Math.floor((h - blobH) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (w * y + x) << 2;
      const inside = x >= x0 && x < x0 + blobW && y >= y0 && y < y0 + blobH;
      const v = inside && darken ? 20 : 255; // ink: near-black; bg: white
      png.data[i] = v;
      png.data[i + 1] = v;
      png.data[i + 2] = v;
      png.data[i + 3] = 255;
    }
  }
  return png;
}

function writePng(path: string, png: PNG): void {
  writeFileSync(path, PNG.sync.write(png), "utf8");
}

describe("pngToBitmap (nearest-neighbour, luminance-margin ink)", () => {
  it("downsamples a blob into a 16x16 bitmap with 16 rows", () => {
    const bmp = pngToBitmap(blobPng(64, 64, 32, 32), {});
    expect(bmp).toHaveLength(16);
    expect(bmp.every((r) => r.length === 16 && /^[#.]+$/.test(r))).toBe(true);
    expect(bmp[7]).toContain("#"); // ink around the middle
    expect(bmp[0]).not.toContain("#"); // blob doesn't reach the top
    expect(bmp[15]).not.toContain("#");
  });

  it("threshold is the luminance margin below the background", () => {
    const pale = blobPng(32, 32, 16, 16);
    for (let i = 0; i < pale.data.length; i += 4) {
      if (pale.data[i] === 20) {
        pale.data[i] = pale.data[i + 1] = pale.data[i + 2] = 220; // gap 35 < default 40
      }
    }
    expect(pngToBitmap(pale, {}).join("")).not.toContain("#");
    expect(pngToBitmap(pale, { threshold: 20 }).join("")).toContain("#");
  });

  it("white eye details on a coloured body become holes", () => {
    // dark body with two white eye pixels: body = ink, eyes = holes
    const png = blobPng(16, 16, 12, 12);
    for (const [ex, ey] of [[6, 6], [9, 6]] as Array<[number, number]>) {
      const i = (16 * ey + ex) << 2;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = 255;
    }
    const bmp = pngToBitmap(png, {});
    const inkBefore = bmp.join("").split("").filter((c) => c === "#").length;
    expect(inkBefore).toBeGreaterThan(20); // body mostly ink
    // the nearest-neighbour samples hit the eye pixels at 1:1 scale
    expect(bmp[6]).toContain(".");
    expect(bmp[6].split("").filter((c) => c === "." ).length).toBeGreaterThanOrEqual(2);
  });
});

describe("autoPoses", () => {
  it("derives 11 distinct-enough poses from one bitmap", () => {
    // asymmetric blob (left half blanked) so the mirrored search pose differs
    const png = blobPng(32, 32, 16, 16);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 16; x++) {
        const i = (32 * y + x) << 2;
        png.data[i] = png.data[i + 1] = png.data[i + 2] = 255;
      }
    }
    const base = pngToBitmap(png, {});
    const poses = autoPoses(base);
    expect(Object.keys(poses)).toHaveLength(11);
    for (const rows of Object.values(poses)) {
      expect(rows).toHaveLength(16);
      expect(rows.every((r) => r.length === 16)).toBe(true);
    }
    expect(poses.search).not.toEqual(poses.idleA); // mirror of an asymmetric blob
    expect(poses.idleB).not.toEqual(poses.idleA); // bounce
  });
});

describe("sheet path", () => {
  it("splits a horizontal strip and maps 11 frames via the tuipet table", () => {
    // 11 cells of 16px, each a 8x8 blob at a different height so frames differ
    const cellW = 16;
    const png = new PNG({ width: cellW * 11, height: 32 });
    for (let f = 0; f < 11; f++) {
      const y0 = 2 + f; // distinct vertical offsets
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < cellW; x++) {
          const i = (png.width * y + f * cellW + x) << 2;
          const inside = x >= 4 && x < 12 && y >= y0 && y < y0 + 8;
          const v = inside ? 20 : 255;
          png.data[i] = png.data[i + 1] = png.data[i + 2] = v;
          png.data[i + 3] = 255;
        }
      }
    }
    const frames = sheetToBitmaps(png, 11, {});
    expect(frames).toHaveLength(11);
    const poses = posesFromFrames(frames);
    expect(poses.think).toEqual(frames[4]); // tuipet map: think <- frame 4
    expect(poses.happy).toEqual(frames[5]);
  });
});

describe("end-to-end: image pack validates", () => {
  it("single image -> pack -> loadPetPacks OK", () => {
    const poses = autoPoses(pngToBitmap(blobPng(48, 48, 24, 24), {}));
    const pack = buildImagePack(poses, { name: "Blobmon", chain: true });
    const dir = mkdtempSync(join(tmpdir(), "agentmon-img-"));
    try {
      mkdirSync(join(dir, "blobmon-pack"), { recursive: true });
      writeFileSync(join(dir, "blobmon-pack", "pack.json"), JSON.stringify(pack), "utf8");
      const r = loadPetPacks(dir);
      expect(r.errors).toEqual([]);
      expect(r.species[0]!.id).toBe("blobmon");
      expect(r.rules).toHaveLength(1); // byte -> blobmon from --chain
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("pose folders: N frames per activity", () => {
  it("collects numbered frames per activity and builds multi-frame roles", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentmon-folder-"));
    try {
      // idle×3, code×2, happy×1 — everything else falls back to idle
      const plan: Array<[string, number]> = [["idle", 3], ["code", 2], ["happy", 1]];
      for (const [activity, count] of plan) {
        for (let i = 1; i <= count; i++) {
          writePng(join(dir, `${activity}${i}.png`), blobPng(32, 32, 12, 10 + i));
        }
      }
      const r = posesFromFolder(dir, {}); // default: colour mode
      expect(r.error).toBeUndefined();
      expect(r.counts).toEqual({ idle: 3, code: 2, happy: 1 });
      expect(r.roles.idle).toEqual(["idle1", "idle2", "idle3"]);
      expect(r.roles.walk).toEqual(["idle1", "idle2", "idle3"]);
      expect(r.roles.code).toEqual(["code1", "code2"]);
      expect(r.roles.think).toEqual(["idle1", "idle2", "idle3"]); // fallback
      expect(r.palette).toBeTruthy();
      // the generated pack validates with the real loader
      const pack = buildImagePack(r.poses, { name: "Foldermon", roles: r.roles, palette: r.palette });
      const packDir = join(dir, "x");
      mkdirSync(packDir);
      writeFileSync(join(packDir, "pack.json"), JSON.stringify(pack), "utf8");
      // loadPetPacks treats `dir` itself as a pack folder — use a clean root
      const root = mkdtempSync(join(tmpdir(), "agentmon-folder-root-"));
      try {
        mkdirSync(join(root, "fm-pack"), { recursive: true });
        writeFileSync(join(root, "fm-pack", "pack.json"), JSON.stringify(pack), "utf8");
        const loaded = loadPetPacks(root);
        expect(loaded.errors).toEqual([]);
        expect(loaded.species[0]!.roles.code).toEqual(["code1", "code2"]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sorts numbered frames in numeric order and accepts legacy names", () => {
    const files = ["idle10.png", "idle2.png", "idle1.png", "idleA.png"];
    expect(collectActivityFiles(files, "idle")).toEqual(["idleA.png", "idle1.png", "idle2.png", "idle10.png"]);
  });

  it("requires at least one idle frame", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentmon-nofolder-"));
    try {
      writePng(join(dir, "code1.png"), blobPng(32, 32, 12, 12));
      expect(posesFromFolder(dir, {}).error).toContain("idle");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

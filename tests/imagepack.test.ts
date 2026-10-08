import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  autoPoses,
  buildImagePack,
  pngToBitmap,
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

describe("pngToBitmap", () => {
  it("downsamples a blob into a grounded 16x16 bitmap", () => {
    const bmp = pngToBitmap(blobPng(64, 64, 32, 32), {});
    expect(bmp).toHaveLength(16);
    expect(bmp.every((r) => r.length === 16 && /^[#.]+$/.test(r))).toBe(true);
    expect(bmp[14]).toMatch(/^\.+$/); // grounding pads
    expect(bmp[15]).toMatch(/^\.+$/);
    expect(bmp[7]).toContain("#"); // ink around the middle
    expect(bmp[0]).not.toContain("#"); // blob doesn't reach the top
  });

  it("threshold controls what counts as ink", () => {
    const pale = blobPng(32, 32, 16, 16);
    // make the blob mid-grey (200) — below default? no: 200 > 140 -> not ink
    for (let i = 0; i < pale.data.length; i += 4) {
      if (pale.data[i] === 20) {
        pale.data[i] = pale.data[i + 1] = pale.data[i + 2] = 200;
      }
    }
    expect(pngToBitmap(pale, {}).join("")).not.toContain("#");
    expect(pngToBitmap(pale, { threshold: 230 }).join("")).toContain("#");
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
      expect(rows[14]).toMatch(/^\.+$/);
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

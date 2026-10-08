// Image -> pet-pack generation: skip hand-assembling 16x16 character grids.
// Feed any PNG — a single illustration, an N-frame horizontal sprite sheet,
// or a folder of pose-named images — and get a valid pack.json out.
//
//   single image  : 11 poses auto-derived (bounce/mirror shifts) — good for a
//                   static illustration you want ALIVE quickly
//   --frames N    : horizontal sheet; N==11 maps with the tuipet pose table,
//                   otherwise frames are assigned to poses in order (cycled)
//   pose folder   : idleA.png idleB.png think.png search.png codeA.png
//                   codeB.png testA.png testB.png happy.png sad.png sleep.png
//
// Ink rule: a pixel is on when its alpha >= 0.5 and its luminance is below
// the threshold (dark-on-light / dark-on-transparent sprites). Everything is
// area-averaged down into a 16x14 cell and grounded with 2 padding rows, so
// imported pets line up with the built-ins.

import { PNG } from "pngjs";
import { POSE_NAMES, type PoseName } from "./registry";
import { DEFAULT_TUIPET_POSE_MAP, slugify } from "./convert";

export const CONTENT_ROWS = 14; // rows 0..13; rows 14/15 stay empty (grounding)

export interface BitmapOptions {
  /** 0..255 luminance cut; dark pixels below it are ink. Default 140. */
  threshold?: number;
}

/** Decode one PNG into a grounded 16x16 bitmap ('#' ink / '.' off). */
export function pngToBitmap(png: PNG, opts: BitmapOptions = {}): string[] {
  const threshold = opts.threshold ?? 140;
  const W = 16;

  const cell = (x: number, y: number): boolean => {
    // average the source rectangle mapped to cell (x, y) of the 16x14 grid
    const x0 = Math.floor((x * png.width) / W);
    const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * png.width) / W));
    const y0 = Math.floor((y * png.height) / CONTENT_ROWS);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * png.height) / CONTENT_ROWS));
    let inkCount = 0;
    let total = 0;
    for (let sy = y0; sy < y1; sy++) {
      for (let sx = x0; sx < x1; sx++) {
        const i = (png.width * sy + sx) << 2;
        const alpha = png.data[i + 3]! / 255;
        const lum =
          (0.299 * png.data[i]! + 0.587 * png.data[i + 1]! + 0.114 * png.data[i + 2]!) ;
        total++;
        if (alpha >= 0.5 && lum < threshold) inkCount++;
      }
    }
    return total > 0 && inkCount * 2 >= total; // majority rule
  };

  const rows: string[] = [];
  for (let y = 0; y < CONTENT_ROWS; y++) {
    let row = "";
    for (let x = 0; x < W; x++) row += cell(x, y) ? "#" : ".";
    rows.push(row);
  }
  rows.push(".".repeat(W), ".".repeat(W)); // grounding pad
  return rows;
}

function shiftContent(bitmap: string[], dy: number): string[] {
  const content = bitmap.slice(0, CONTENT_ROWS);
  const blank = ".".repeat(16);
  const moved: string[] = [];
  for (let y = 0; y < CONTENT_ROWS; y++) {
    const src = y - dy;
    moved.push(src >= 0 && src < CONTENT_ROWS ? content[src]! : blank);
  }
  return [...moved, blank, blank];
}

function mirrorContent(bitmap: string[]): string[] {
  return bitmap.map((r) => [...r].reverse().join(""));
}

/**
 * Derive all 11 poses from ONE bitmap — subtle bounces, a mirror for search,
 * slumps for sleep/sad. Real sheets look better, but this makes any single
 * image alive in seconds.
 */
export function autoPoses(base: string[]): Record<PoseName, string[]> {
  return {
    idleA: base,
    idleB: shiftContent(base, 1),
    think: shiftContent(base, -1),
    search: mirrorContent(base),
    codeA: base,
    codeB: shiftContent(base, 1),
    testA: shiftContent(base, -1),
    testB: shiftContent(base, 1),
    happy: shiftContent(base, -2),
    sad: shiftContent(base, 1),
    sleep: shiftContent(base, 2),
  };
}

/** Split a horizontal sheet into per-frame bitmaps (each a 16-row array). */
export function sheetToBitmaps(png: PNG, frameCount: number, opts: BitmapOptions = {}): string[][] {
  const threshold = opts.threshold ?? 140;
  const bitmaps: string[][] = [];
  for (let f = 0; f < frameCount; f++) {
    const cellPng = new PNG({ width: Math.floor(png.width / frameCount), height: png.height });
    const cw = cellPng.width;
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < cw; x++) {
        const src = (png.width * y + f * cw + x) << 2;
        const dst = (cw * y + x) << 2;
        cellPng.data[dst] = png.data[src]!;
        cellPng.data[dst + 1] = png.data[src + 1]!;
        cellPng.data[dst + 2] = png.data[src + 2]!;
        cellPng.data[dst + 3] = png.data[src + 3]!;
      }
    }
    bitmaps.push(pngToBitmap(cellPng, { threshold }));
  }
  return bitmaps;
}

/** Assign sheet frames to pose slots (tuipet map for 11-frame strips). */
export function posesFromFrames(frames: readonly string[][]): Record<PoseName, string[]> {
  const poses = {} as Record<PoseName, string[]>;
  for (const pose of POSE_NAMES) {
    const idx =
      frames.length === 11 ? DEFAULT_TUIPET_POSE_MAP[pose] : DEFAULT_TUIPET_POSE_MAP[pose] % frames.length;
    poses[pose] = frames[Math.min(idx, frames.length - 1)]!;
  }
  return poses;
}

export interface ImagePackOptions {
  name: string;
  id?: string;
  stage?: "baby" | "branch";
  description?: string;
  /** Wire byte -> this species with gentle default gates. */
  chain?: boolean;
}

export function buildImagePack(poses: Record<PoseName, string[]>, opts: ImagePackOptions): Record<string, unknown> {
  const id = opts.id ?? slugify(opts.name);
  const pack: Record<string, unknown> = {
    name: `${opts.name} pack`,
    species: [
      {
        id,
        name: opts.name,
        stage: opts.stage ?? "branch",
        description: opts.description ?? "generated from an image",
        poses,
      },
    ],
  };
  if (opts.chain) {
    pack.evolutions = [
      {
        from: "byte",
        to: id,
        gates: { minLevel: 2, axis: "research", minTraitShare: 0.4, minTasks: 3, maxCareMistakes: 3 },
      },
    ];
  }
  return pack;
}

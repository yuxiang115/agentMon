// Image -> pet-pack generation: skip hand-assembling 16x16 character grids.
// Feed any PNG — a single illustration, an N-frame horizontal sprite sheet,
// or a folder of pose-named images — and get a valid pack.json out.
//
// Extraction (the pi-pets lessons applied to our 1-bit LCD):
//  - NEAREST-NEIGHBOR sampling: authored pixel details (eyes, mouths)
//    survive; area-averaging turned coloured bodies into solid blobs.
//  - Luminance-relative ink: ink = darker than the detected background by
//    `threshold` (default 40). White eyes on an orange body become holes;
//    dark outlines stay ink. Transparent backgrounds: any opaque pixel.
//  - The dominant ink colour is extracted and stored as the species' `ink`
//    so the pet renders in ITS colour instead of black.
//  - Frames keep all 16 rows (no 14-row squeeze); the renderer grounds them.

import { PNG } from "pngjs";
import { readFileSync, readdirSync } from "node:fs";
import { POSE_NAMES, type PoseName } from "./registry";
import { DEFAULT_TUIPET_POSE_MAP, slugify } from "./convert";

export const CONTENT_ROWS = 16;

export interface BitmapOptions {
  /**
   * Luminance margin below the detected background for ink (0..255,
   * default 40). Lower it if pale art comes out blank; raise it if the
   * background is off-white and gets picked up as ink.
   */
  threshold?: number;
}

interface InkModel {
  isInk(i: number): boolean;
  transparentMode: boolean;
  bgLum: number;
}

function buildInkModel(png: PNG, threshold: number): InkModel {
  // background detection from the border ring
  let transparentBorder = 0;
  let borderTotal = 0;
  let luma = 0;
  let opaqueCount = 0;
  const consider = (x: number, y: number) => {
    const i = (png.width * y + x) << 2;
    borderTotal++;
    if (png.data[i + 3]! < 128) {
      transparentBorder++;
      return;
    }
    luma += 0.299 * png.data[i]! + 0.587 * png.data[i + 1]! + 0.114 * png.data[i + 2]!;
    opaqueCount++;
  };
  for (let x = 0; x < png.width; x++) {
    consider(x, 0);
    consider(x, png.height - 1);
  }
  for (let y = 1; y < png.height - 1; y++) {
    consider(0, y);
    consider(png.width - 1, y);
  }
  const transparentMode = transparentBorder * 2 >= borderTotal;
  const bgLum = opaqueCount ? luma / opaqueCount : 255;
  const isInk = (i: number): boolean => {
    if (png.data[i + 3]! < 128) return false;
    if (transparentMode) return true;
    const lum = 0.299 * png.data[i]! + 0.587 * png.data[i + 1]! + 0.114 * png.data[i + 2]!;
    return bgLum - lum >= threshold;
  };
  return { isInk, transparentMode, bgLum };
}

/** Decode one PNG into a 16x16 bitmap ('#' ink / '.' off), nearest-neighbour. */
export function pngToBitmap(png: PNG, opts: BitmapOptions = {}): string[] {
  const model = buildInkModel(png, opts.threshold ?? 40);
  const W = 16;
  const rows: string[] = [];
  for (let y = 0; y < CONTENT_ROWS; y++) {
    const sy = Math.min(png.height - 1, Math.floor(((y + 0.5) * png.height) / CONTENT_ROWS));
    let row = "";
    for (let x = 0; x < W; x++) {
      const sx = Math.min(png.width - 1, Math.floor(((x + 0.5) * png.width) / W));
      row += model.isInk((png.width * sy + sx) << 2) ? "#" : ".";
    }
    rows.push(row);
  }
  return rows;
}

/** The dominant colour among ink pixels, as #rrggbb (for the species' ink). */
export function dominantInkColor(png: PNG, opts: BitmapOptions = {}): string | undefined {
  const model = buildInkModel(png, opts.threshold ?? 40);
  const buckets = new Map<number, number>();
  const step = Math.max(1, Math.floor((png.width * png.height) / 4096)); // sample cap
  let n = 0;
  for (let i = 0; i < png.width * png.height; i += step) {
    const px = i << 2;
    if (!model.isInk(px)) continue;
    if (png.data[px + 3]! < 128) continue;
    const r = png.data[px]!;
    const g = png.data[px + 1]!;
    const b = png.data[px + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
    n++;
  }
  if (!n) return undefined;
  let bestKey = 0;
  let bestCount = -1;
  for (const [key, count] of buckets) {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }
  const hex = (v: number) => ((v << 4) | 0x8).toString(16).padStart(2, "0");
  return `#${hex((bestKey >> 8) & 0xf)}${hex((bestKey >> 4) & 0xf)}${hex(bestKey & 0xf)}`;
}

// --- colour extraction: photo-faithful, pi-pets-style -----------------------

/** A frame as 16 rows x 16 cols of quantized "#rrggbb" or null (transparent). */
export type HexGrid = Array<Array<string | null>>;

export interface ColorExtractOptions {
  /**
   * 0..255 colour distance from the detected background for a pixel to count
   * as part of the sprite (default 60). Pixels keep their OWN colour.
   */
  threshold?: number;
}

const quant = (v: number): number => Math.min(255, Math.round(v / 32) * 32);

/**
 * Extract a 16x16 colour grid (nearest-neighbour). Ink decision is
 * differs-from-background; colour is the pixel's own quantized colour.
 */
export function pngToHexGrid(png: PNG, opts: ColorExtractOptions = {}): HexGrid {
  const threshold = opts.threshold ?? 60;
  // background from the border ring
  let transparentBorder = 0;
  let borderTotal = 0;
  let br = 0;
  let bgc = 0;
  let bb = 0;
  let opaqueCount = 0;
  const consider = (x: number, y: number) => {
    const i = (png.width * y + x) << 2;
    borderTotal++;
    if (png.data[i + 3]! < 128) {
      transparentBorder++;
      return;
    }
    br += png.data[i]!;
    bgc += png.data[i + 1]!;
    bb += png.data[i + 2]!;
    opaqueCount++;
  };
  for (let x = 0; x < png.width; x++) {
    consider(x, 0);
    consider(x, png.height - 1);
  }
  for (let y = 1; y < png.height - 1; y++) {
    consider(0, y);
    consider(png.width - 1, y);
  }
  const transparentMode = transparentBorder * 2 >= borderTotal;
  const bcr = opaqueCount ? br / opaqueCount : 255;
  const bcg = opaqueCount ? bgc / opaqueCount : 255;
  const bcb = opaqueCount ? bb / opaqueCount : 255;

  const grid: HexGrid = [];
  for (let y = 0; y < 16; y++) {
    const sy = Math.min(png.height - 1, Math.floor(((y + 0.5) * png.height) / 16));
    const row: Array<string | null> = [];
    for (let x = 0; x < 16; x++) {
      const sx = Math.min(png.width - 1, Math.floor(((x + 0.5) * png.width) / 16));
      const i = (png.width * sy + sx) << 2;
      if (png.data[i + 3]! < 128) {
        row.push(null);
        continue;
      }
      if (!transparentMode) {
        const dr = png.data[i]! - bcr;
        const dg = png.data[i + 1]! - bcg;
        const db = png.data[i + 2]! - bcb;
        if (Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3) < threshold) {
          row.push(null); // background — transparent
          continue;
        }
      }
      const hex = (v: number) => quant(v).toString(16).padStart(2, "0");
      row.push(`#${hex(png.data[i]!)}${hex(png.data[i + 1]!)}${hex(png.data[i + 2]!)}`);
    }
    grid.push(row);
  }
  return grid;
}

const PALETTE_CHARS = "abcdefghijklmnopqrstuvwxyz23456789".split("");

/**
 * Build a shared palette (char -> colour) across grids and emit
 * palette-indexed pose rows ('.' = transparent). Rare colours beyond the
 * palette cap fold into their nearest kept colour.
 */
export function paletteFromHexGrids(
  grids: readonly HexGrid[],
  maxColors = 32,
): { palette: Record<string, string>; rows: string[][] } {
  const counts = new Map<string, number>();
  for (const grid of grids) {
    for (const row of grid) {
      for (const color of row) {
        if (color) counts.set(color, (counts.get(color) ?? 0) + 1);
      }
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const kept = ranked.slice(0, Math.min(maxColors, PALETTE_CHARS.length));
  const palette: Record<string, string> = {};
  kept.forEach((color, i) => {
    palette[PALETTE_CHARS[i]!] = color;
  });
  const nearest = (color: string): string => {
    if (kept.includes(color)) return color;
    let best = kept[0]!;
    let bestD = Infinity;
    for (const k of kept) {
      const d =
        Math.abs(parseInt(color.slice(1, 3), 16) - parseInt(k.slice(1, 3), 16)) +
        Math.abs(parseInt(color.slice(3, 5), 16) - parseInt(k.slice(3, 5), 16)) +
        Math.abs(parseInt(color.slice(5, 7), 16) - parseInt(k.slice(5, 7), 16));
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  };
  const charFor = new Map(kept.map((c, i) => [c, PALETTE_CHARS[i]!] as const));
  const rows = grids.map((grid) =>
    grid.map((row) =>
      row.map((color) => (color ? charFor.get(nearest(color))! : ".")).join(""),
    ),
  );
  return { palette, rows };
}

function shiftContent(bitmap: string[], dy: number): string[] {
  const blank = ".".repeat(16);
  const moved: string[] = [];
  for (let y = 0; y < CONTENT_ROWS; y++) {
    const src = y - dy;
    moved.push(src >= 0 && src < CONTENT_ROWS ? bitmap[src]! : blank);
  }
  return moved;
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
  const threshold = opts.threshold ?? 40;
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

/** Split a horizontal sheet into per-frame COLOUR grids. */
export function sheetToHexGrids(png: PNG, frameCount: number, opts: ColorExtractOptions = {}): HexGrid[] {
  const grids: HexGrid[] = [];
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
    grids.push(pngToHexGrid(cellPng, opts));
  }
  return grids;
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
  /** Species ink colour (#rrggbb) — the pet renders in this instead of black. */
  ink?: string;
  /** Colour palette: pose rows index it, pet renders full-colour. */
  palette?: Record<string, string>;
}

export function buildImagePack(
  poses: Record<string, string[]>,
  opts: ImagePackOptions & { roles?: Record<string, string[]> },
): Record<string, unknown> {
  const id = opts.id ?? slugify(opts.name);
  const species: Record<string, unknown> = {
    id,
    name: opts.name,
    stage: opts.stage ?? "branch",
    description: opts.description ?? "generated from an image",
    poses,
  };
  if (opts.roles) species.roles = opts.roles;
  if (opts.palette) species.palette = opts.palette;
  else if (opts.ink) species.ink = opts.ink;
  const pack: Record<string, unknown> = {
    name: `${opts.name} pack`,
    species: [species],
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

// --- pose-folder mode: N frames per activity, numbered files ----------------
//
// Folder layout (any subset; only idle is required — missing activities fall
// back to the idle loop, matching the renderer):
//   idle1.png idle2.png idle3.png idle4.png
//   think1.png think2.png · search1.png search2.png
//   code1.png code2.png code3.png · test1.png test2.png
//   happy1.png happy2.png · sad1.png sad2.png · sleep1.png sleep2.png
// Legacy single names also work: idleA.png, codeA.png, think.png, ...

export const ACTIVITIES = ["idle", "think", "search", "code", "test", "happy", "sad", "sleep"] as const;
export type ActivityName = (typeof ACTIVITIES)[number];

const LEGACY_LETTERS: Partial<Record<ActivityName, string[]>> = {
  idle: ["A", "B"],
  code: ["A", "B"],
  test: ["A", "B"],
};

/** Files of one activity, sorted bare -> A/B -> numbered 1..N. */
export function collectActivityFiles(files: readonly string[], activity: ActivityName): string[] {
  const hits: Array<{ file: string; order: number }> = [];
  for (const f of files) {
    const lower = f.toLowerCase();
    if (lower === `${activity}.png` || lower === `${activity}.jpg`) {
      hits.push({ file: f, order: 0 });
      continue;
    }
    const letters = LEGACY_LETTERS[activity] ?? [];
    const suffix = lower.slice(activity.length, -4);
    const li = letters.findIndex((l) => l.toLowerCase() === suffix);
    if (li !== -1 && lower.startsWith(activity) && (lower.endsWith(".png") || lower.endsWith(".jpg"))) {
      hits.push({ file: f, order: li + 1 });
      continue;
    }
    const m = new RegExp(`^${activity}(\\d+)\\.(png|jpg)$`, "i").exec(lower);
    if (m) hits.push({ file: f, order: Number(m[1]) * 10 });
  }
  return hits.sort((a, b) => a.order - b.order).map((h) => h.file);
}

export interface FolderPosesResult {
  poses: Record<string, string[]>;
  roles: Record<string, string[]>;
  counts: Record<string, number>;
  /** Dominant ink colour across all frames (mono mode). */
  ink?: string;
  /** Shared colour palette (colour mode). */
  palette?: Record<string, string>;
  error?: string;
}

/**
 * Build poses + roles from a folder of activity-named images. `idle` is
 * required; every other activity falls back to the idle loop when absent.
 * Colour mode (default): photo-faithful palette-indexed rows.
 */
export function posesFromFolder(
  dir: string,
  opts: BitmapOptions & { color?: boolean } = {},
): FolderPosesResult {
  const files = readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f));
  const color = opts.color ?? true;
  const poses: Record<string, string[]> = {};
  const roles: Record<string, string[]> = {};
  const counts: Record<string, number> = {};
  const gridsByActivity = new Map<string, HexGrid[]>();
  let idleKeys: string[] | undefined;
  let ink: string | undefined;

  for (const activity of ACTIVITIES) {
    const activityFiles = collectActivityFiles(files, activity);
    if (!activityFiles.length) continue;
    const grids: HexGrid[] = [];
    const monoRows: string[][] = [];
    for (const file of activityFiles) {
      const png = PNG.sync.read(readFileSync(`${dir}/${file}`));
      if (color) {
        grids.push(pngToHexGrid(png, { threshold: 60 }));
      } else {
        monoRows.push(pngToBitmap(png, opts));
        ink = ink ?? dominantInkColor(png, opts);
      }
    }
    if (color) {
      gridsByActivity.set(activity, grids);
      counts[activity] = grids.length;
    } else {
      const keys: string[] = [];
      monoRows.forEach((rows, i) => {
        const key = `${activity}${i + 1}`;
        poses[key] = rows;
        keys.push(key);
      });
      counts[activity] = keys.length;
      roles[activity] = keys;
      if (activity === "idle") idleKeys = keys;
    }
  }

  if (color) {
    const all = [...gridsByActivity.values()].flat();
    if (!all.length) {
      return { poses, roles, counts, error: "folder needs at least idle1.png (or idle.png / idleA.png)" };
    }
    const { palette, rows } = paletteFromHexGrids(all);
    let off = 0;
    for (const [activity, grids] of gridsByActivity) {
      const keys: string[] = [];
      grids.forEach((_, i) => {
        const key = `${activity}${i + 1}`;
        poses[key] = rows[off + i]!;
        keys.push(key);
      });
      off += grids.length;
      counts[activity] = keys.length;
      roles[activity] = keys;
      if (activity === "idle") idleKeys = keys;
    }
    if (!idleKeys) {
      return { poses, roles, counts, error: "folder needs at least idle1.png (or idle.png / idleA.png)" };
    }
    roles.walk = idleKeys;
    for (const activity of ACTIVITIES) {
      if (!roles[activity]) roles[activity] = idleKeys;
    }
    return { poses, roles, counts, palette };
  }

  if (!idleKeys) {
    return { poses, roles, counts, error: "folder needs at least idle1.png (or idle.png / idleA.png)" };
  }
  roles.walk = idleKeys; // walking reuses the idle loop
  for (const activity of ACTIVITIES) {
    if (!roles[activity]) roles[activity] = idleKeys;
  }
  return { poses, roles, counts, ink };
}

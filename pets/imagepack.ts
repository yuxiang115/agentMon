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
  /** Output grid edge in pixels (default 16). 32/64 feed the hi-res layers. */
  size?: number;
}

const quant = (v: number): number => Math.min(255, Math.round(v / 32) * 32);

// GPT-converter geometry (agumon_tui_demo_white): crop to content, then
// aspect-fill the canvas so the sprite fills ~88% of it — whole-image
// sampling shrank padded cutouts into a huddled blob in the middle.
const FILL = 0.88;

/** Near-white, low-saturation background test (GPT: min>237, max-min<15). */
function isNearWhite(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return min > 237 && max - min < 15;
}

/**
 * Extract a 16x16 colour grid. Content is bbox-cropped and aspect-filled;
 * only background-classified cells CONNECTED TO THE BORDER are transparent
 * (edge flood-fill) — enclosed whites (claws, belly) stay real pixels.
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
  const borderNearWhite = isNearWhite(bcr, bcg, bcb);
  const isBg = (x: number, y: number): boolean => {
    const i = (png.width * y + x) << 2;
    if (png.data[i + 3]! < 128) return true;
    if (transparentMode) return false;
    if (borderNearWhite) return isNearWhite(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
    const dr = png.data[i]! - bcr;
    const dg = png.data[i + 1]! - bcg;
    const db = png.data[i + 2]! - bcb;
    return Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3) < threshold;
  };

  // bbox of content in source pixels
  let x0 = png.width;
  let y0 = png.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (!isBg(x, y)) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  const size = opts.size ?? 16;
  const grid: HexGrid = Array.from({ length: size }, () => Array<string | null>(size).fill(null));
  if (x1 < 0) return grid; // no content at all
  const cropW = x1 - x0 + 1;
  const cropH = y1 - y0 + 1;
  const usable = Math.floor(size * FILL);
  const scale = Math.min(usable / cropW, usable / cropH);
  const outW = Math.max(1, Math.round(cropW * scale));
  const outH = Math.max(1, Math.round(cropH * scale));
  const offX = (size - outW) >> 1;
  const offY = (size - outH) >> 1;
  const hex = (v: number) => quant(v).toString(16).padStart(2, "0");
  for (let y = 0; y < outH; y++) {
    const sy = Math.min(png.height - 1, y0 + Math.floor(((y + 0.5) * cropH) / outH));
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(png.width - 1, x0 + Math.floor(((x + 0.5) * cropW) / outW));
      const i = (png.width * sy + sx) << 2;
      // background-classified cells keep their literal colour for now —
      // enclosed ones (white claws, belly) must STAY pixels; the edge flood
      // below decides which background cells are actually transparent
      grid[offY + y]![offX + x] = `#${hex(png.data[i]!)}${hex(png.data[i + 1]!)}${hex(png.data[i + 2]!)}`;
    }
  }
  // edge flood: only border-connected background cells become transparent
  const bgCell = (gx: number, gy: number): boolean => {
    const sx = Math.min(png.width - 1, x0 + Math.floor(((gx - offX + 0.5) * cropW) / outW));
    const sy = Math.min(png.height - 1, y0 + Math.floor(((gy - offY + 0.5) * cropH) / outH));
    return isBg(sx, sy);
  };
  const seen = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const todo: Array<[number, number]> = [];
  for (let x = 0; x < size; x++) {
    todo.push([x, 0], [x, size - 1]);
  }
  for (let y = 1; y < size - 1; y++) {
    todo.push([0, y], [size - 1, y]);
  }
  while (todo.length) {
    const [gx, gy] = todo.pop()!;
    if (gx < 0 || gy < 0 || gx >= size || gy >= size || seen[gy]![gx]!) continue;
    seen[gy]![gx] = true;
    if (!bgCell(gx, gy)) continue;
    grid[gy]![gx] = null;
    todo.push([gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]);
  }
  return grid;
}

const PALETTE_CHARS = "abcdefghijklmnopqrstuvwxyz23456789".split("");

const l1 = (a: string, b: string): number =>
  Math.abs(parseInt(a.slice(1, 3), 16) - parseInt(b.slice(1, 3), 16)) +
  Math.abs(parseInt(a.slice(3, 5), 16) - parseInt(b.slice(3, 5), 16)) +
  Math.abs(parseInt(a.slice(5, 7), 16) - parseInt(b.slice(5, 7), 16));

/**
 * Build a shared palette (char -> colour) across grids and emit
 * palette-indexed pose rows ('.' = transparent). Two noise filters:
 *  - ranked colours closer than MIN_SEPARATION (L1) to a kept colour fold in;
 *  - LOW-SATURATION (neutral) candidates collapse to one per luminance band
 *    (dark / mid / light) — anti-aliasing between outline and background
 *    produces a whole grey RAMP that separation alone can't stop (each step
 *    is far enough from the last), but art only ever has one true neutral
 *    per band (the GPT converter's K/S/W).
 */
const MIN_SEPARATION = 72;
const NEUTRAL_SAT = 48; // max-min channel spread below this = neutral

type Band = "dark" | "mid" | "light" | null;

function neutralBand(color: string): Band {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  if (Math.max(r, g, b) - Math.min(r, g, b) >= NEUTRAL_SAT) return null; // saturated
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum < 85 ? "dark" : lum > 170 ? "light" : "mid";
}

/** Select the kept palette colours (char -> #rrggbb) from all grids' pixels. */
export function buildPaletteFromHexGrids(
  grids: readonly HexGrid[],
  maxColors = 32,
): Record<string, string> {
  const counts = new Map<string, number>();
  for (const grid of grids) {
    for (const row of grid) {
      for (const color of row) {
        if (color) counts.set(color, (counts.get(color) ?? 0) + 1);
      }
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const kept: string[] = [];
  const neutralTaken = new Set<Band>();
  for (const color of ranked) {
    if (kept.length >= Math.min(maxColors, PALETTE_CHARS.length)) break;
    const band = neutralBand(color);
    if (band && neutralTaken.has(band)) continue; // this band's neutral is already kept
    if (kept.some((k) => l1(k, color) < MIN_SEPARATION)) continue;
    kept.push(color);
    if (band) neutralTaken.add(band);
  }
  const palette: Record<string, string> = {};
  kept.forEach((color, i) => {
    palette[PALETTE_CHARS[i]!] = color;
  });
  return palette;
}

/** Index grids onto a palette ('.' = transparent), folding off-palette colours. */
export function applyPalette(
  grids: readonly HexGrid[],
  palette: Record<string, string>,
): string[][] {
  const kept = Object.values(palette);
  const nearest = (color: string): string => {
    let best = kept[0]!;
    let bestD = Infinity;
    for (const k of kept) {
      const d = l1(color, k);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  };
  const charFor = new Map(kept.map((c, i) => [c, PALETTE_CHARS[i]!] as const));
  return grids.map((grid) =>
    grid.map((row) =>
      row.map((color) => (color ? charFor.get(nearest(color))! : ".")).join(""),
    ),
  );
}

/**
 * Build a shared palette (char -> colour) across grids and emit
 * palette-indexed pose rows ('.' = transparent). Two noise filters:
 *  - ranked colours closer than MIN_SEPARATION (L1) to a kept colour fold in;
 *  - LOW-SATURATION (neutral) candidates collapse to one per luminance band
 *    (dark / mid / light) — anti-aliasing between outline and background
 *    produces a whole grey RAMP that separation alone can't stop (each step
 *    is far enough from the last), but art only ever has one true neutral
 *    per band (the GPT converter's K/S/W).
 */
export function paletteFromHexGrids(
  grids: readonly HexGrid[],
  maxColors = 32,
): { palette: Record<string, string>; rows: string[][] } {
  const palette = buildPaletteFromHexGrids(grids, maxColors);
  return { palette, rows: applyPalette(grids, palette) };
}

function shiftContent(bitmap: string[], dy: number): string[] {
  const size = bitmap.length || CONTENT_ROWS;
  const blank = ".".repeat(bitmap[0]?.length ?? CONTENT_ROWS);
  const moved: string[] = [];
  for (let y = 0; y < size; y++) {
    const src = y - dy;
    moved.push(src >= 0 && src < size ? bitmap[src]! : blank);
  }
  return moved;
}

function mirrorContent(bitmap: string[]): string[] {
  return bitmap.map((r) => [...r].reverse().join(""));
}

/**
 * Derive all 11 poses from ONE bitmap — subtle bounces, a mirror for search,
 * slumps for sleep/sad. Real sheets look better, but this makes any single
 * image alive in seconds. Works at ANY square resolution (16 base, 32/64
 * hi-res layers).
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

/**
 * One image -> full pose set at every layer: the 16x16 base defines the
 * palette, then the SAME image is resampled at 32/64 and snapped onto it —
 * single-image imports keep the hi-res detail folder imports have.
 */
export function pngToPosesLayers(
  png: PNG,
  opts: ColorExtractOptions = {},
): {
  poses: Record<PoseName, string[]>;
  palette: Record<string, string>;
  hiPoses: Record<string, Record<string, string[]>>;
} {
  const base = pngToHexGrid(png, opts);
  const palette = buildPaletteFromHexGrids([base]);
  const poses = autoPoses(applyPalette([base], palette)[0]!);
  const hiPoses: Record<string, Record<string, string[]>> = {};
  for (const layer of HI_LAYERS) {
    const grid = pngToHexGrid(png, { ...opts, size: layer });
    hiPoses[String(layer)] = autoPoses(applyPalette([grid], palette)[0]!);
  }
  return { poses, palette, hiPoses };
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
  /** Hi-res pose layers ({"32", "64"}) — /pet size above 16 gains detail. */
  hiPoses?: Record<string, Record<string, string[]>>;
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
  if (opts.hiPoses) species.hiPoses = opts.hiPoses;
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
  /** Hi-res layers ({"32": poses, "64": poses}), colour mode from images. */
  hiPoses?: Record<string, Record<string, string[]>>;
  error?: string;
}

/** Hi-res layers extracted from source images — /pet size gains real detail. */
export const HI_LAYERS = [32, 64] as const;

/**
 * Build poses + roles from a folder of activity-named images. `idle` is
 * required; every other activity falls back to the idle loop when absent.
 * Colour mode (default): photo-faithful palette-indexed rows at 16x16 PLUS
 * hi-res layers resampled from the originals (a shared palette across all
 * sizes keeps colours consistent when the render switches layers).
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
  const hiGridsByActivity = new Map<string, Map<number, HexGrid[]>>();
  let idleKeys: string[] | undefined;
  let ink: string | undefined;

  for (const activity of ACTIVITIES) {
    const activityFiles = collectActivityFiles(files, activity);
    if (!activityFiles.length) continue;
    const grids: HexGrid[] = [];
    const hi = new Map<number, HexGrid[]>();
    const monoRows: string[][] = [];
    for (const file of activityFiles) {
      const png = PNG.sync.read(readFileSync(`${dir}/${file}`));
      if (color) {
        grids.push(pngToHexGrid(png, { threshold: opts.threshold ?? 60 }));
        for (const layer of HI_LAYERS) {
          const list = hi.get(layer) ?? [];
          list.push(pngToHexGrid(png, { threshold: opts.threshold ?? 60, size: layer }));
          hi.set(layer, list);
        }
      } else {
        monoRows.push(pngToBitmap(png, opts));
        ink = ink ?? dominantInkColor(png, opts);
      }
    }
    if (color) {
      gridsByActivity.set(activity, grids);
      hiGridsByActivity.set(activity, hi);
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
    // ONE palette, defined by the 16x16 grids (the colour identity the user
    // sees at the default size) — hi-res layers snap onto it, so their
    // anti-aliased edge blends fold into real colours instead of flooding
    // the palette with shades (the GPT converter's hard-palette behaviour)
    const palette = buildPaletteFromHexGrids(all);
    const rows = applyPalette(all, palette);
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
    const hiPoses: Record<string, Record<string, string[]>> = {};
    for (const layer of HI_LAYERS) {
      const layerPoses: Record<string, string[]> = {};
      for (const [activity, grids] of gridsByActivity) {
        const layerGrids = hiGridsByActivity.get(activity)?.get(layer) ?? [];
        const indexed = applyPalette(layerGrids, palette);
        grids.forEach((_, i) => {
          layerPoses[`${activity}${i + 1}`] = indexed[i]!;
        });
      }
      hiPoses[String(layer)] = layerPoses;
    }
    return { poses, roles, counts, palette, hiPoses };
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

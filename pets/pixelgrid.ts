// Pixel-art recovery: most "pixel art" PNGs are a small native sprite
// (e.g. 24x24) blown up ~13x and saved with soft edges. Resampling them to
// arbitrary sizes misses the art's grid — pixels double or vanish and edge
// blur becomes muddy palette entries. Instead, find the grid (one period
// shared by every frame, a phase per frame), read each art pixel from the
// centre of its cell, and keep a small palette of the real colours.

import type { PNG } from "pngjs";
import { prepareImage, type HexGrid, type PreparedImage } from "./image-color";

export interface PixelGrid {
  /** Source pixels per art pixel (same for every frame). */
  period: number;
  /** Per-frame offset of the first grid line, in source pixels. */
  phases: Array<{ x: number; y: number }>;
}

type Profile = Float64Array;

/** Colour-change energy between neighbouring columns / rows. */
function edgeProfiles(png: PNG): { col: Profile; row: Profile } {
  const { width: w, height: h, data } = png;
  const diff = (a: number, b: number) =>
    Math.abs(data[a]! - data[b]!) + Math.abs(data[a + 1]! - data[b + 1]!) + Math.abs(data[a + 2]! - data[b + 2]!) +
    Math.abs(data[a + 3]! - data[b + 3]!);
  const col = new Float64Array(w + 1);
  const row = new Float64Array(h + 1);
  for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) col[x] += diff((y * w + x) * 4, (y * w + x - 1) * 4);
  for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) row[y] += diff((y * w + x) * 4, ((y - 1) * w + x) * 4);
  return { col, row };
}

/**
 * The edge profile's Fourier component at `period`: edges sitting on one
 * lattice add up in phase (magnitude ~ their total energy), edges off it
 * cancel. Returns the coherent share of the edge energy (0..1) and the
 * lattice phase — where the grid lines fall.
 */
function lattice(p: Profile, period: number): { score: number; phase: number } {
  let re = 0, im = 0, total = 0;
  for (let x = 0; x < p.length; x++) {
    const e = p[x]!;
    if (!e) continue;
    const a = (2 * Math.PI * x) / period;
    re += e * Math.cos(a);
    im += e * Math.sin(a);
    total += e;
  }
  if (!total) return { score: 0, phase: 0 };
  const turn = Math.atan2(im, re) / (2 * Math.PI);
  return { score: Math.hypot(re, im) / total, phase: (((turn * period) % period) + period) % period };
}

/** Mean edge energy on the lines phase + k*period (linear interpolation):
 *  sharper than the Fourier score, so it polishes period and phase once
 *  the Fourier sweep has found the right neighbourhood. */
function lineEnergy(p: Profile, period: number, phase: number): number {
  let sum = 0;
  let n = 0;
  for (let k = phase; k < p.length - 1; k += period) {
    const i = Math.floor(k);
    const f = k - i;
    sum += p[i]! * (1 - f) + p[i + 1]! * f;
    n++;
  }
  return n ? sum / n : 0;
}

function bestPhase(p: Profile, period: number): { phase: number; energy: number } {
  let best = { phase: 0, energy: -1 };
  for (let phase = 0; phase < period; phase += 0.1) {
    const energy = lineEnergy(p, period, phase);
    if (energy > best.energy) best = { phase, energy };
  }
  return best;
}

/** Edges coherent with the lattice, as a share of all edge energy. Clean
 *  upscales score ~0.9, soft AI "pixel art" ~0.35; noise and photos stay
 *  under ~0.1. */
const MIN_GRID_SCORE = 0.2;
/** Upscaled at least 4x — finer "grids" are just texture. */
const MIN_PERIOD = 4;
/** A real sprite spans at least this many art pixels; less is a few
 *  flat shapes that happen to line up with some period. */
const MIN_ART_PIXELS = 16;

/**
 * Find the art's pixel grid across same-sized frames: the period whose
 * lattice holds the most edge energy, summed over every frame and both
 * axes. Multiples of the true period lose half their edges to
 * cancellation; divisors lose to the sub-pixel jitter of rounded edges.
 * Returns null when the images aren't upscaled pixel art, so callers fall
 * back to plain resampling.
 */
export function detectPixelGrid(pngs: readonly PNG[]): PixelGrid | null {
  if (!pngs.length) return null;
  const size = Math.min(...pngs.map((p) => Math.min(p.width, p.height)));
  if (size < 32) return null; // already tiny: nothing to recover
  const profiles = pngs.flatMap((png) => {
    const { col, row } = edgeProfiles(png);
    return [col, row];
  });
  const scoreAt = (period: number) =>
    profiles.reduce((a, p) => a + lattice(p, period).score, 0) / profiles.length;
  let best = { period: 0, score: -1 };
  for (let period = MIN_PERIOD; period <= size / 8; period += 0.05) {
    const score = scoreAt(period);
    if (score > best.score) best = { period, score };
  }
  for (let period = best.period - 0.05; period <= best.period + 0.05; period += 0.005) {
    const score = scoreAt(period);
    if (score > best.score) best = { period, score };
  }
  if (best.score < MIN_GRID_SCORE) return null;
  // polish within ±1.5%: the period whose grid lines carry the most edge
  // energy (each profile normalised so busy frames don't dominate)
  const means = profiles.map((p) => p.reduce((a, v) => a + v, 0) / p.length || 1);
  const sharpness = (period: number) =>
    profiles.reduce((a, p, i) => a + bestPhase(p, period).energy / means[i]!, 0);
  let period = best.period;
  let top = sharpness(period);
  for (let t = best.period * 0.985; t <= best.period * 1.015; t += 0.01) {
    const v = sharpness(t);
    if (v > top) { top = v; period = t; }
  }
  return {
    period,
    phases: pngs.map((_, i) => ({
      x: bestPhase(profiles[i * 2]!, period).phase,
      y: bestPhase(profiles[i * 2 + 1]!, period).phase,
    })),
  };
}

const rgbOf = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexOf = (c: readonly number[]): string => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/**
 * The colour most of a cell's pixels share: bucket coarsely, take the
 * biggest bucket, average its members. A per-channel median would blend a
 * half-black, half-yellow cell into olive that exists nowhere in the art.
 */
function dominantColor(px: readonly number[][]): string {
  const buckets = new Map<number, number[][]>();
  for (const p of px) {
    const key = ((p[0]! >> 5) << 6) | ((p[1]! >> 5) << 3) | (p[2]! >> 5);
    const list = buckets.get(key);
    if (list) list.push(p);
    else buckets.set(key, [p]);
  }
  let best: number[][] = [];
  for (const list of buckets.values()) if (list.length > best.length) best = list;
  return hexOf([0, 1, 2].map((c) => best.reduce((a, p) => a + p[c]!, 0) / best.length));
}

/**
 * Read one frame's art pixels. Cells are indexed on a canvas-wide lattice
 * (cell k starts near k*period after removing the frame's phase), so the
 * same art pixel lands in the same cell in every frame. Each cell samples
 * its inner half — soft edges never reach the median.
 */
function sampleCells(image: PreparedImage, grid: PixelGrid, frame: number, cols: number, rows: number): HexGrid {
  const { png, foreground } = image;
  const { width: w, height: h, data } = png;
  const { period } = grid;
  const phase = grid.phases[frame]!;
  // lattice origin snapped near 0 so frames with different phases agree
  const ox = phase.x - Math.floor(phase.x / period + 0.5) * period;
  const oy = phase.y - Math.floor(phase.y / period + 0.5) * period;
  const out: HexGrid = [];
  for (let cy = 0; cy < rows; cy++) {
    const line: Array<string | null> = [];
    const y0 = oy + cy * period;
    for (let cx = 0; cx < cols; cx++) {
      const x0 = ox + cx * period;
      const px: number[][] = [];
      let total = 0;
      for (let y = Math.ceil(y0 + period * 0.25); y < y0 + period * 0.75; y++) {
        for (let x = Math.ceil(x0 + period * 0.25); x < x0 + period * 0.75; x++) {
          total++;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const i = y * w + x;
          if (!foreground[i]) continue;
          px.push([data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!]);
        }
      }
      if (!total || px.length * 2 < total) {
        line.push(null);
        continue;
      }
      line.push(dominantColor(px));
    }
    out.push(line);
  }
  return out;
}

/** Colours within this RGB distance are one palette entry (JPEG/blur noise). */
const MERGE_DISTANCE = 48;
/** A rare colour this close to a common one is edge blur, not an accent. */
const FOLD_DISTANCE = 80;
const FOLD_SHARE = 0.004;

/**
 * The art's real palette: merge near-identical colours, then fold rare
 * in-between colours (blur) into their common neighbour. Rare but distinct
 * accents — an eye, a tear, a red mouth — survive.
 */
export function pixelArtPalette(grids: readonly HexGrid[]): string[] {
  const entries: Array<{ c: number[]; n: number }> = [];
  const counts = new Map<string, number>();
  let total = 0;
  for (const g of grids) for (const r of g) for (const c of r) if (c) { counts.set(c, (counts.get(c) ?? 0) + 1); total++; }
  for (const [hex, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    const c = rgbOf(hex);
    const near = entries.find((e) => dist(e.c, c) < MERGE_DISTANCE);
    if (near) near.n += n;
    else entries.push({ c, n });
  }
  const kept = entries.filter((e, i) => {
    if (e.n >= total * FOLD_SHARE) return true;
    return !entries.some((o, j) => j !== i && o.n >= total * FOLD_SHARE && dist(o.c, e.c) < FOLD_DISTANCE);
  });
  return kept.map((e) => hexOf(e.c));
}

export function snapToPalette(grids: readonly HexGrid[], palette: readonly string[]): HexGrid[] {
  const pal = palette.map(rgbOf);
  const cache = new Map<string, string>();
  const snap = (hex: string) => {
    let hit = cache.get(hex);
    if (hit) return hit;
    const c = rgbOf(hex);
    let best = 0;
    pal.forEach((p, i) => { if (dist(p, c) < dist(pal[best]!, c)) best = i; });
    hit = palette[best]!;
    cache.set(hex, hit);
    return hit;
  };
  return grids.map((g) => g.map((r) => r.map((c) => (c ? snap(c) : null))));
}

/**
 * Drop edge blur that survived sampling: a lit cell on the silhouette
 * with at most one lit 4-neighbour, whose colour
 * none of its neighbours share. Real 1-px details sit inside the outline
 * or match a neighbour; a stray speck does neither.
 */
function despeckle(grid: HexGrid): HexGrid {
  const at = (x: number, y: number) => grid[y]?.[x] ?? null;
  return grid.map((row, y) => row.map((c, x) => {
    if (!c) return c;
    const n4 = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
    const lit = n4.filter(Boolean);
    if (lit.length > 1) return c;
    const n8 = [...n4, at(x - 1, y - 1), at(x + 1, y - 1), at(x - 1, y + 1), at(x + 1, y + 1)];
    return n8.includes(c) ? c : null;
  }));
}

/** One exact-size rendering of the art: frames on a shared square canvas. */
export interface PixelArtLayer {
  size: number;
  frames: HexGrid[];
  /** Lit extent (the larger of width/height) before square padding. */
  content: number;
}

/**
 * Sample every frame on a lattice of `period`, then place all frames on
 * ONE shared square canvas: frames keep their relative positions
 * (animation offsets survive), the canvas hugs the union of lit cells,
 * and content grounds on the bottom edge.
 */
function layerAt(images: readonly PreparedImage[], grid: PixelGrid, period: number): PixelArtLayer | null {
  const lattice = { ...grid, period };
  const cols = Math.ceil(Math.max(...images.map((i) => i.png.width)) / period) + 1;
  const rows = Math.ceil(Math.max(...images.map((i) => i.png.height)) / period) + 1;
  const raw = images.map((image, i) => despeckle(sampleCells(image, lattice, i, cols, rows)));
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const g of raw) g.forEach((r, y) => r.forEach((c, x) => {
    if (!c) return;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }));
  if (x1 < 0) return null;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const size = Math.max(17, w, h); // > 16: the 16x16 base stays a separate layer
  const padX = Math.floor((size - w) / 2);
  const padY = size - h; // ground on the floor
  const frames = raw.map((g) =>
    Array.from({ length: size }, (_, y) =>
      Array.from({ length: size }, (_, x) => g[y - padY + y0]?.[x - padX + x0] ?? null),
    ),
  );
  return { size, frames, content: Math.max(w, h) };
}

/**
 * Recover upscaled pixel art at its exact sizes: the art grid itself (1x)
 * and a half-step grid (2x). Generated "pixel art" often places eyes,
 * highlights and nostrils on half-pixel offsets; the 2x layer keeps them,
 * while every 1x art pixel still maps to exactly 2x2 cells. Both layers
 * share one palette. Null when the images aren't upscaled pixel art.
 */
export function extractPixelArt(
  pngs: readonly PNG[],
  opts: { threshold?: number; grid?: PixelGrid } = {},
): { grid: PixelGrid; layers: PixelArtLayer[]; palette: string[] } | null {
  const grid = opts.grid ?? detectPixelGrid(pngs);
  if (!grid) return null;
  const images = pngs.map((png) => prepareImage(png, opts.threshold));
  const layers: PixelArtLayer[] = [];
  for (const sub of [1, 2]) {
    const layer = layerAt(images, grid, grid.period / sub);
    if (!layer || layer.size > 128) break;
    if (sub === 1 && layer.content < MIN_ART_PIXELS) return null;
    layers.push(layer);
  }
  if (!layers.length) return null;
  // learn the palette from the finest layer: it carries the small accents
  const palette = pixelArtPalette(layers.at(-1)!.frames);
  for (const layer of layers) layer.frames = snapToPalette(layer.frames, palette);
  return { grid, layers, palette };
}

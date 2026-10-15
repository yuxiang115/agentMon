// Source-resolution masking and sampling for faithful terminal sprites.
// Keep transparency decisions separate from resizing: a thin outline may
// disappear at 16px without turning an enclosed white eye into background.
import type { PNG } from "pngjs";

export type HexGrid = Array<Array<string | null>>;
export type Crop = { x: number; y: number; width: number; height: number };
export interface ColorExtractOptions {
  threshold?: number;
  size?: number;
  sampling?: "area" | "nearest";
  /** Shared normalized source viewport, for frames on the same canvas. */
  viewport?: Crop;
}
export interface PreparedImage {
  png: PNG;
  foreground: Uint8Array;
  bounds: Crop | null;
}
const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (channels: number[]): string => "#" + channels.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

export function prepareImage(png: PNG, threshold = 60): PreparedImage {
  const { width: w, height: h, data } = png;
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  const opaque = border.filter((i) => data[i * 4 + 3] >= 128);
  const alphaBackground = opaque.length <= border.length / 2;
  const median = (channel: number) => {
    const values = opaque.map((i) => data[i * 4 + channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 255;
  };
  const bg = [median(0), median(1), median(2)];
  const nearWhite = Math.min(...bg) > 237 && Math.max(...bg) - Math.min(...bg) < 20;
  const background = (pixel: number): boolean => {
    const i = pixel * 4;
    if (data[i + 3] < 128) return true;
    if (alphaBackground) return false;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (nearWhite) return Math.min(r, g, b) > 237 && Math.max(r, g, b) - Math.min(r, g, b) < 20;
    return Math.hypot(r - bg[0], g - bg[1], b - bg[2]) < threshold * Math.sqrt(3);
  };
  const foreground = new Uint8Array(w * h);
  // Explicit alpha holes are transparent even when enclosed by the sprite.
  for (let i = 0; i < foreground.length; i++) foreground[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const visit = (i: number) => {
    if (visited[i]) return;
    visited[i] = 1;
    if (!background(i)) return;
    foreground[i] = 0;
    queue[tail++] = i;
  };
  border.forEach(visit);
  while (head < tail) {
    const i = queue[head++], x = i % w, y = Math.floor(i / w);
    if (x > 0) visit(i - 1);
    if (x + 1 < w) visit(i + 1);
    if (y > 0) visit(i - w);
    if (y + 1 < h) visit(i + w);
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < foreground.length; i++) {
    if (!foreground[i]) continue;
    const x = i % w, y = Math.floor(i / w);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { png, foreground, bounds: x1 < 0 ? null : { x: x0 / w, y: y0 / h, width: (x1 - x0 + 1) / w, height: (y1 - y0 + 1) / h } };
}

export function sharedViewport(images: readonly PreparedImage[]): Crop | undefined {
  const bounds = images.flatMap((image) => image.bounds ? [image.bounds] : []);
  if (!bounds.length) return undefined;
  const x = Math.min(...bounds.map((b) => b.x)), y = Math.min(...bounds.map((b) => b.y));
  return { x, y, width: Math.max(...bounds.map((b) => b.x + b.width)) - x, height: Math.max(...bounds.map((b) => b.y + b.height)) - y };
}

export function sampleImage(image: PreparedImage, opts: ColorExtractOptions = {}): HexGrid {
  const size = opts.size ?? 16;
  if (!Number.isInteger(size) || size < 1 || size > 128) throw new Error("image grid size must be 1..128");
  const grid: HexGrid = Array.from({ length: size }, () => Array<string | null>(size).fill(null));
  if (!image.bounds) return grid;
  const { png, foreground } = image, { width: w, height: h, data } = png;
  const crop = opts.viewport ?? image.bounds;
  const x0 = crop.x * w, y0 = crop.y * h, cropW = crop.width * w, cropH = crop.height * h;
  const scale = Math.floor(size * 0.88) / Math.max(cropW, cropH);
  const outW = Math.max(1, Math.round(cropW * scale)), outH = Math.max(1, Math.round(cropH * scale));
  const offX = Math.floor((size - outW) / 2), offY = Math.floor((size - outH) / 2);
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
    const left = x0 + x * cropW / outW, top = y0 + y * cropH / outH;
    const right = x0 + (x + 1) * cropW / outW, bottom = y0 + (y + 1) * cropH / outH;
    if (opts.sampling !== "area" || scale >= 1) {
      const sx = Math.min(w - 1, Math.floor((left + right) / 2)), sy = Math.min(h - 1, Math.floor((top + bottom) / 2));
      const pixel = sy * w + sx;
      if (foreground[pixel]) grid[offY + y][offX + x] = hex([data[pixel * 4], data[pixel * 4 + 1], data[pixel * 4 + 2]]);
      continue;
    }
    // Coverage-weighted box filter. Removed white background cannot bleed
    // into the silhouette; opaque white eyes/claws remain in the sample.
    let weight = 0;
    const sum = [0, 0, 0];
    for (let sy = Math.max(0, Math.floor(top)); sy < Math.min(h, Math.ceil(bottom)); sy++) {
      const dy = Math.min(bottom, sy + 1) - Math.max(top, sy);
      for (let sx = Math.max(0, Math.floor(left)); sx < Math.min(w, Math.ceil(right)); sx++) {
        const pixel = sy * w + sx;
        if (!foreground[pixel]) continue;
        const coverage = dy * (Math.min(right, sx + 1) - Math.max(left, sx)) * data[pixel * 4 + 3] / 255;
        weight += coverage;
        for (let c = 0; c < 3; c++) sum[c] += data[pixel * 4 + c] * coverage;
      }
    }
    if (weight >= (right - left) * (bottom - top) * 0.5) grid[offY + y][offX + x] = hex(sum.map((v) => v / weight));
  }
  return grid;
}

export function pngToHexGrid(png: PNG, opts: ColorExtractOptions = {}): HexGrid {
  return sampleImage(prepareImage(png, opts.threshold), opts);
}

const PALETTE_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@%";
type ColorSample = { channels: number[]; count: number };

/** Weighted median-cut palette learned from detailed layers, not just 16px. */
export function buildPaletteFromHexGrids(grids: readonly HexGrid[], maxColors = 64): Record<string, string> {
  const histogram = new Map<string, number>();
  for (const grid of grids) for (const row of grid) for (const color of row) {
    if (color) histogram.set(color, (histogram.get(color) ?? 0) + 1);
  }
  const limit = Math.max(1, Math.min(64, Math.floor(maxColors)));
  if (histogram.size <= limit) return Object.fromEntries([...histogram].sort((a, b) => b[1] - a[1]).map(([color], i) => [PALETTE_CHARS[i], color]));
  const boxes: ColorSample[][] = [[...histogram].map(([color, count]) => ({ channels: rgb(color), count }))];
  const stats = (box: ColorSample[]) => {
    const count = box.reduce((n, c) => n + c.count, 0);
    const mean = [0, 1, 2].map((a) => box.reduce((n, c) => n + c.channels[a] * c.count, 0) / count);
    const variance = mean.map((m, a) => box.reduce((n, c) => n + (c.channels[a] - m) ** 2 * c.count, 0));
    const axis = variance.indexOf(Math.max(...variance));
    return { count, mean, axis, error: variance.reduce((n, v) => n + v, 0) };
  };
  while (boxes.length < limit) {
    let index = -1, score = -1;
    boxes.forEach((box, i) => { const error = stats(box).error; if (box.length > 1 && error > score) { score = error; index = i; } });
    if (index < 0) break;
    const box = boxes[index], { axis, count } = stats(box);
    box.sort((a, b) => a.channels[axis] - b.channels[axis]);
    let cumulative = 0, split = 1;
    for (let i = 0; i < box.length - 1; i++) { cumulative += box[i].count; split = i + 1; if (cumulative >= count / 2) break; }
    boxes.splice(index, 1, box.slice(0, split), box.slice(split));
  }
  return Object.fromEntries(boxes.map((box, i) => [PALETTE_CHARS[i], hex(stats(box).mean)]));
}

export function applyPalette(grids: readonly HexGrid[], palette: Record<string, string>): string[][] {
  const entries = Object.entries(palette).map(([key, color]) => ({ key, channels: rgb(color) }));
  const cache = new Map<string, string>();
  const nearest = (color: string): string => {
    const cached = cache.get(color);
    if (cached) return cached;
    if (!entries.length) throw new Error("nontransparent image needs a palette");
    const channels = rgb(color);
    let key = entries[0].key, distance = Infinity;
    for (const entry of entries) {
      const d = channels.reduce((n, v, i) => n + (v - entry.channels[i]) ** 2, 0);
      if (d < distance) { distance = d; key = entry.key; }
    }
    cache.set(color, key);
    return key;
  };
  return grids.map((grid) => grid.map((row) => row.map((c) => c ? nearest(c) : ".").join("")));
}

export function paletteFromHexGrids(grids: readonly HexGrid[], maxColors = 64): { palette: Record<string, string>; rows: string[][] } {
  const palette = buildPaletteFromHexGrids(grids, maxColors);
  return { palette, rows: applyPalette(grids, palette) };
}

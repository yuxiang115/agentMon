// Pet size scaling: poses are authored 16x16; the display renders them at
// any pixel size (16..60) by nearest-neighbour resampling of the character
// grid — palette-indexed colour rows and 1-bit ink rows alike pass through
// unchanged, since every non-'.' char is opaque ink and '.' stays off.

/**
 * Resample an N x N char pose to `size` x `size` rows, nearest-neighbour
 * (authored pixel details survive; no interpolation, no new colours).
 * Downscaling below the source height also works (majority-free NN pick).
 */
export function scaleRows(rows: readonly string[], size: number): string[] {
  const h = rows.length;
  const w = Math.max(1, ...rows.map((r) => r.length));
  const out: string[] = [];
  for (let y = 0; y < size; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / size));
    const src = rows[sy] ?? "";
    let line = "";
    for (let x = 0; x < size; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / size));
      line += src[sx] ?? ".";
    }
    out.push(line);
  }
  return out;
}

/**
 * Shrink an N x N char pose to `size` x `size` by majority vote: each output
 * pixel takes the most common char in the source pixels it covers (ties go
 * to ink over '.'). Uneven by nature — some source pixels merge, others
 * don't — but cleaner than nearest-neighbour, which drops thin lines and
 * single-pixel accents at random.
 */
export function downscaleRows(rows: readonly string[], size: number): string[] {
  const h = rows.length;
  const w = Math.max(1, ...rows.map((r) => r.length));
  if (size >= h) return scaleRows(rows, size);
  const out: string[] = [];
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor((y * h) / size);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / size));
    let line = "";
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor((x * w) / size);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / size));
      const counts = new Map<string, number>();
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const c = rows[sy]?.[sx] ?? ".";
          counts.set(c, (counts.get(c) ?? 0) + 1);
        }
      }
      let best = ".";
      let bestN = -1;
      for (const [c, n] of counts) if (n > bestN || (n === bestN && best === ".")) { best = c; bestN = n; }
      line += best;
    }
    out.push(line);
  }
  return out;
}

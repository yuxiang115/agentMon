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

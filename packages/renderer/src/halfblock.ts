// Half-block text encodings, ported from tuipet src/tuipet/render.py
// (https://github.com/joeltco/tuipet) — MIT, (c) 2026 Joel Taylor.
//
// Two encodings exist (docs/reference-audit.md C2):
//  - bitmapText(): the four-glyph form (" ", "▀", "▄", "█") for icons and
//    previews — this is plan.md §10's renderBitmap.
//  - The single-glyph "▀" + ANSI fg/bg LCD compositor (dead-pixel model)
//    lives in framebuffer.ts (paintLcd).

export const UPPER = "▀"; // \u2580
export const LOWER = "▄"; // \u2584
export const FULL = "█"; // \u2588

/** A 1-bit sprite frame: rows of '0'/'1' ('#'/'.' also accepted). */
export type Bitmap = string[];

export function ink(c: string | undefined): boolean {
  return c === "1" || c === "#";
}

// --- ANSI 24-bit color helpers ---

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function fgColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[38;2;${r};${g};${b}m`;
}

export function bgColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[48;2;${r};${g};${b}m`;
}

export const RESET = "\x1b[0m";

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * bitmap_text(): 1-bit rows -> half-block lines (square pixels).
 * Returns RAW glyph lines (no ANSI) so tests can assert on characters;
 * wrap with styleLines() for terminal output.
 */
export function bitmapText(rows: Bitmap | null, padTo = 0): string[] {
  if (!rows || rows.length === 0) return [];
  const w = Math.max(...rows.map((r) => r.length));
  const g = rows.map((r) => r.padEnd(w, "0"));
  if (g.length % 2) g.push("0".repeat(w));
  const out: string[] = [];
  for (let y = 0; y < g.length; y += 2) {
    let line = "";
    for (let x = 0; x < w; x++) {
      const top = ink(g[y][x]);
      const bot = ink(g[y + 1][x]);
      line += top && bot ? FULL : top ? UPPER : bot ? LOWER : " ";
    }
    if (padTo && w < padTo) line += " ".repeat(padTo - w);
    out.push(line);
  }
  return out;
}

export function styleLines(lines: string[], on: string, bg: string): string[] {
  return lines.map((l) => fgColor(on) + bgColor(bg) + l + RESET);
}

/**
 * marquee(): text that fits its slot renders unchanged; longer text holds on
 * the head, then slides a width-wide window through a gap loop.
 */
export function marquee(
  s: string,
  width: number,
  step: number,
  gap = "   ",
  hold = 8,
): string {
  if (s.length <= width) return s;
  const loop = s + gap;
  const t = step % (loop.length + hold);
  const off = t < hold ? 0 : t - hold;
  return (loop + loop).slice(off, off + width);
}

/** downsample(): box-downsample a bitmap by integer factor f (majority rule). */
export function downsample(rows: Bitmap | null, f: number): Bitmap | null {
  if (!rows || rows.length === 0 || f <= 1) return rows;
  const w = Math.max(...rows.map((r) => r.length));
  const padded = rows.map((r) => r.padEnd(w, "0"));
  const h = padded.length;
  const out: string[] = [];
  for (let y = 0; y < Math.floor(h / f); y++) {
    let line = "";
    for (let x = 0; x < Math.floor(w / f); x++) {
      let c = 0;
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++)
          if (ink(padded[y * f + dy][x * f + dx])) c++;
      line += c * 2 >= f * f ? "1" : "0";
    }
    out.push(line);
  }
  return out;
}

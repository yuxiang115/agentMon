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

// --- ANSI 24-bit color helpers ---------------------------------------------
//
// Truecolor terminals get per-pixel 24-bit SGR; terminals without it (macOS
// Terminal.app famously never sets COLORTERM and drops 38;2 sequences)
// get the nearest xterm-256 index instead — the pet keeps its colours
// instead of collapsing into unstyled glyph mush. The extension entry picks
// the mode from the environment at startup; the renderer default stays
// truecolor so tests are deterministic.

export type ColorMode = "true" | "256";

let colorMode: ColorMode = "true";

export function setColorMode(mode: ColorMode): void {
  colorMode = mode;
}

export function colorModeNow(): ColorMode {
  return colorMode;
}

/**
 * Detect what the terminal actually supports. AGENTMON_COLOR=256|trueforce
 * an override; otherwise COLORTERM (truecolor/24bit) or a TERM advertising
 * direct colour keeps 24-bit, and everything else gets the 256 palette.
 */
export function detectColorMode(env: NodeJS.ProcessEnv = process.env): ColorMode {
  const forced = (env.AGENTMON_COLOR ?? "").toLowerCase();
  if (forced === "256") return "256";
  if (forced === "true") return "true";
  const colorterm = (env.COLORTERM ?? "").toLowerCase();
  if (colorterm.includes("truecolor") || colorterm.includes("24bit")) return "true";
  const term = (env.TERM ?? "").toLowerCase();
  if (term.includes("truecolor") || term.includes("direct")) return "true";
  return "256";
}

// The xterm-256 palette: 16 ANSI base colours, a 6x6x6 colour cube, and a
// 24-step grey ramp.
const XTERM_256: ReadonlyArray<readonly [number, number, number]> = (() => {
  const palette: Array<readonly [number, number, number]> = [
    [0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0], [0, 0, 238], [205, 0, 205],
    [0, 205, 205], [229, 229, 229], [127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0],
    [92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
  ];
  const ramp = [0, 95, 135, 175, 215, 255];
  for (const r of ramp) for (const g of ramp) for (const b of ramp) palette.push([r, g, b]);
  for (let i = 0; i < 24; i++) palette.push([8 + i * 10, 8 + i * 10, 8 + i * 10]);
  return palette;
})();

const quantCache = new Map<string, number>();

/** Nearest xterm-256 palette index for a #rrggbb colour. */
export function quantize256(hex: string): number {
  const cached = quantCache.get(hex);
  if (cached !== undefined) return cached;
  const [r, g, b] = hexToRgb(hex);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < XTERM_256.length; i++) {
    const [pr, pg, pb] = XTERM_256[i]!;
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  quantCache.set(hex, best);
  return best;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function fgColor(hex: string): string {
  if (colorMode === "256") return `\x1b[38;5;${quantize256(hex)}m`;
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[38;2;${r};${g};${b}m`;
}

export function bgColor(hex: string): string {
  if (colorMode === "256") return `\x1b[48;5;${quantize256(hex)}m`;
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

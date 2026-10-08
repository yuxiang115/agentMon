// Evolution animation — the digivolve moment, in three phases over 2.4 s
// (driven by the display's 10 Hz tick; the reducer's 3x-TTL happy
// celebration keeps playing long after, so the fx owns only the transform):
//
//   CHARGE  0 – 1.2 s   the OLD form flickers through its poses (every 2
//                       ticks) while whiteness climbs 0 -> 1 — the sprite
//                       "overcharges" until it reads as a white silhouette
//   BURST   1.2 – 1.6 s one-tick strobe: full-white NEW silhouette vs its
//                       dominant-colour silhouette, alternating
//   REVEAL  1.6 – 2.4 s the NEW form at whiteness 1 -> 0 — colours bleed
//                       back in and it settles into the celebration
//
// Pure colour-grid math: views pick the poses (old/new species at the render
// size), then apply whiten/silhouette per this plan. Mono pets fold through
// the same path as single-colour grids (their ink colour).

import type { ColorGrid } from "./colorframe";

export const EVO_CHARGE_MS = 1200;
export const EVO_BURST_MS = 400;
export const EVO_TOTAL_MS = 2400;

export type EvoStage = "charge" | "burst" | "reveal" | "done";

export interface EvoPlan {
  stage: EvoStage;
  /** 0..1 — how washed-out toward white the sprite renders right now. */
  whiteness: number;
  /** Which form's poses to draw. */
  form: "old" | "new";
  /** Charge-phase pose flicker: advance the pose loop every 2 ticks. */
  flicker: boolean;
  /** Burst-phase strobe: true on even 100 ms beats (white flash). */
  flashWhite: boolean;
  /** Render as a flat silhouette (burst phase) in white or the dominant colour. */
  silhouette: boolean;
}

export function evolvePlan(elapsedMs: number): EvoPlan {
  if (elapsedMs < 0) return { stage: "charge", whiteness: 0, form: "old", flicker: true, flashWhite: false, silhouette: false };
  if (elapsedMs < EVO_CHARGE_MS) {
    return {
      stage: "charge",
      whiteness: elapsedMs / EVO_CHARGE_MS,
      form: "old",
      flicker: true,
      flashWhite: false,
      silhouette: false,
    };
  }
  if (elapsedMs < EVO_CHARGE_MS + EVO_BURST_MS) {
    return {
      stage: "burst",
      whiteness: 1,
      form: "new",
      flicker: false,
      flashWhite: Math.floor(elapsedMs / 100) % 2 === 0,
      silhouette: true,
    };
  }
  if (elapsedMs < EVO_TOTAL_MS) {
    return {
      stage: "reveal",
      whiteness: 1 - (elapsedMs - EVO_CHARGE_MS - EVO_BURST_MS) / (EVO_TOTAL_MS - EVO_CHARGE_MS - EVO_BURST_MS),
      form: "new",
      flicker: false,
      flashWhite: false,
      silhouette: false,
    };
  }
  return { stage: "done", whiteness: 0, form: "new", flicker: false, flashWhite: false, silhouette: false };
}

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/** Lerp a #rrggbb colour toward white by t (0 = unchanged, 1 = pure white). */
export function whiten(hex: string, t: number): string {
  const k = clamp01(t);
  const ch = (i: number): number =>
    Math.round(parseInt(hex.slice(i, i + 2), 16) + (255 - parseInt(hex.slice(i, i + 2), 16)) * k);
  const b = (v: number): string => v.toString(16).padStart(2, "0");
  return `#${b(ch(1))}${b(ch(3))}${b(ch(5))}`;
}

/** Wash a whole grid toward white (null stays transparent). */
export function whitenGrid(grid: ColorGrid, t: number): ColorGrid {
  const k = clamp01(t);
  if (k === 0) return grid;
  return grid.map((row) => row.map((c) => (c ? whiten(c, k) : null)));
}

/** Flatten every lit pixel to one colour (the strobe silhouette). */
export function silhouetteGrid(grid: ColorGrid, color: string): ColorGrid {
  return grid.map((row) => row.map((c) => (c ? color : null)));
}

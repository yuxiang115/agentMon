// The species registry — every creature agentMon knows. ORIGINAL art only
// (docs/reference-audit.md §2.2 red line: no Bandai/Digimon-derived designs).

import type { Bitmap } from "../packages/renderer/src/halfblock";
import { BYTE } from "./sprites/byte";
import { SCOUT } from "./sprites/scout";
import { BUILDER } from "./sprites/builder";
import { GUARDIAN } from "./sprites/guardian";

export const POSE_NAMES = [
  "idleA",
  "idleB",
  "think",
  "search",
  "codeA",
  "codeB",
  "testA",
  "testB",
  "happy",
  "sad",
  "sleep",
] as const;

export type PoseName = (typeof POSE_NAMES)[number];

export interface SpeciesDef {
  id: string;
  name: string;
  /** "baby" — can evolve; "branch" — a Stage-5 evolution target. */
  stage: "baby" | "branch";
  description?: string;
  /**
   * Pose bitmaps keyed by pose name. Built-ins use the canonical 11; pet
   * packs may use ANY names (idle1..idle4, code1..code3, ...) as long as
   * `roles` references poses that exist and includes "idle".
   */
  poses: Record<string, Bitmap>;
  /**
   * Optional ink colour (#rrggbb): the pet renders in this colour instead of
   * the default dark ink — image imports pick the body's dominant colour.
   */
  ink?: string;
  /**
   * Optional colour palette (single char -> #rrggbb). When present, pose
   * rows are palette-indexed (any char but '.' selects its colour) and the
   * pet renders full-colour, pi-pets style — photo-faithful imports.
   */
  palette?: Record<string, string>;
  /**
   * Higher-resolution pose layers resampled from the ORIGINAL images
   * ({"32": {...}, "64": {...}}), keyed like `poses`. Image imports store
   * these so `/pet size` above 16 gains real detail instead of blocky
   * upscaling of the 16x16 grid (the GPT-converter's 32x32 lesson).
   */
  hiPoses?: Record<string, Record<string, string[]>>;
  /**
   * activity -> pose loop (the coding role grammar). A loop may hold any
   * number of frames; the animator cycles them at ~3 switches/sec.
   */
  roles: Record<string, string[]>;
}

export const SPECIES: Record<string, SpeciesDef> = {
  byte: BYTE,
  scout: SCOUT,
  builder: BUILDER,
  guardian: GUARDIAN,
};

// --- runtime (pet-pack) species — see docs/pet-packs.md ---------------------
// Pet packs are USER-SUPPLIED sprite data loaded at runtime (the tuipet
// model: the repo ships original art + loaders only; Bandai-derived data, if
// any, lives on the user's machine at the user's own responsibility).

const customSpecies = new Map<string, SpeciesDef>();

/** Register pack species; a pack id may reskin a built-in (pack wins). */
export function registerSpecies(...defs: SpeciesDef[]): void {
  for (const def of defs) customSpecies.set(def.id, def);
}

export function resetCustomSpecies(): void {
  customSpecies.clear();
}

/** Every species, built-ins first, then pack species. */
export function allSpecies(): SpeciesDef[] {
  return [...Object.values(SPECIES), ...customSpecies.values()];
}

export function speciesSource(id: string): "builtin" | "pack" | "unknown" {
  if (customSpecies.has(id)) return "pack";
  if (id in SPECIES) return "builtin";
  return "unknown";
}

/** Species lookup with a safe fallback to the baby form. */
export function speciesFor(id: string): SpeciesDef {
  return customSpecies.get(id) ?? SPECIES[id] ?? BYTE;
}

/**
 * The pose rows to render at `size`: the smallest hi-res layer that is at
 * least `size` (downsampled the rest of the way), the largest layer when
 * `size` exceeds them all, or the 16x16 base when there are no layers.
 */
export function poseRowsFor(species: SpeciesDef, poseName: string, size: number): string[] {
  const base = species.poses[poseName] ?? species.poses[species.roles.idle[0]!] ?? [];
  const baseSize = base.length || 16;
  if (!species.hiPoses || size <= baseSize) return base;
  const layers = Object.keys(species.hiPoses)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > baseSize)
    .sort((a, b) => a - b);
  const target = layers.find((n) => n >= size) ?? layers[layers.length - 1];
  if (target === undefined) return base;
  return species.hiPoses[String(target)]?.[poseName] ?? base;
}

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
  poses: Record<PoseName, Bitmap>;
  /** activity -> pose loop (the coding role grammar shared by all species). */
  roles: Record<string, PoseName[]>;
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

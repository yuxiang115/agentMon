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

/** Species lookup with a safe fallback to the baby form. */
export function speciesFor(id: string): SpeciesDef {
  return SPECIES[id] ?? BYTE;
}

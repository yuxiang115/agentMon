// Local pet-pack loader — the tuipet model (docs/pet-packs.md): the agentMon
// repo ships ORIGINAL art and this loader only. Users who want other sprites
// (e.g. extracted from their own DVPet copy, as tuipet documents) drop a
// pack.json under <pi agent dir>/agentmon/pets/<slug>/ on THEIR machine.
// Bandai-derived data never enters this repository.
//
// Loading is strictly validated and fail-soft: a broken pack is skipped with
// an error message, never a crash in the host agent (the tamagotchi lesson,
// audit C6). Format (pet-pack format spirit after AgentPet's pet.json):

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Bitmap } from "../packages/renderer/src/halfblock";
import { POSE_NAMES, SPECIES, type PoseName, type SpeciesDef } from "./registry";
import type { EvolutionGates, EvolutionRule, TraitAxis } from "../packages/core/evolution";

/** The standard coding role table, used when a pack omits `roles`. */
export const DEFAULT_ROLES: Record<string, PoseName[]> = {
  idle: ["idleA", "idleB"],
  walk: ["idleA", "idleB"],
  think: ["think"],
  search: ["search"],
  code: ["codeA", "codeB"],
  test: ["testA", "testB"],
  happy: ["happy"],
  sad: ["sad"],
  sleep: ["sleep"],
};

export interface LoadedPack {
  slug: string;
  name: string;
  species: SpeciesDef[];
  rules: EvolutionRule[];
}

export interface PetPackLoadResult {
  packs: LoadedPack[];
  species: SpeciesDef[];
  rules: EvolutionRule[];
  /** Human-readable problems; empty when everything loaded. */
  errors: string[];
}

function validPose(pose: unknown): boolean {
  return (
    Array.isArray(pose) &&
    pose.length === 16 &&
    pose.every((row) => typeof row === "string" && row.length === 16 && /^[01#.]*$/.test(row)) &&
    pose.some((row) => /[1#]/.test(row))
  );
}

function parseSpecies(
  raw: unknown,
  context: string,
  errors: string[],
): SpeciesDef | null {
  if (typeof raw !== "object" || raw === null) {
    errors.push(`${context}: species entry is not an object`);
    return null;
  }
  const s = raw as Record<string, unknown>;
  const id = typeof s.id === "string" ? s.id.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    errors.push(`${context}: species id must be lowercase letters/digits/dashes (got ${JSON.stringify(id)})`);
    return null;
  }
  const name = typeof s.name === "string" && s.name.trim() ? s.name.trim() : id;
  const stage = s.stage === "baby" ? "baby" : "branch";
  const poses: Partial<Record<PoseName, Bitmap>> = {};
  if (typeof s.poses !== "object" || s.poses === null) {
    errors.push(`${context}/${id}: missing poses`);
    return null;
  }
  for (const poseName of POSE_NAMES) {
    const pose = (s.poses as Record<string, unknown>)[poseName];
    if (!validPose(pose)) {
      errors.push(`${context}/${id}: pose ${poseName} must be 16 rows of 16 chars of 1/0/#/. with ink`);
      return null;
    }
    poses[poseName] = pose as Bitmap;
  }
  let roles = DEFAULT_ROLES;
  if (s.roles !== undefined) {
    if (typeof s.roles !== "object" || s.roles === null) {
      errors.push(`${context}/${id}: roles must be an object`);
      return null;
    }
    roles = {};
    for (const [activity, posesList] of Object.entries(s.roles as Record<string, unknown>)) {
      if (
        !Array.isArray(posesList) ||
        posesList.length === 0 ||
        !posesList.every((p) => typeof p === "string" && (POSE_NAMES as readonly string[]).includes(p))
      ) {
        errors.push(`${context}/${id}: roles.${activity} must be a non-empty list of pose names`);
        return null;
      }
      roles[activity] = posesList as PoseName[];
    }
  }
  return {
    id,
    name,
    stage,
    description: typeof s.description === "string" ? s.description : undefined,
    poses: poses as Record<PoseName, Bitmap>,
    roles,
  };
}

function parseGates(raw: unknown, context: string, errors: string[]): EvolutionGates | null {
  if (typeof raw !== "object" || raw === null) {
    errors.push(`${context}: gates must be an object`);
    return null;
  }
  const g = raw as Record<string, unknown>;
  const int = (v: unknown): number | null =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
  const minLevel = int(g.minLevel);
  const minTasks = int(g.minTasks);
  const maxCareMistakes = int(g.maxCareMistakes);
  const shareOk = typeof g.minTraitShare === "number" && g.minTraitShare > 0 && g.minTraitShare <= 1;
  const axisOk = typeof g.axis === "string" && ["research", "implementation", "validation"].includes(g.axis);
  if (minLevel === null || minLevel < 1 || minTasks === null || maxCareMistakes === null || !shareOk || !axisOk) {
    errors.push(
      `${context}: gates need integer minLevel>=1, minTasks, maxCareMistakes, minTraitShare in (0,1], axis in research|implementation|validation`,
    );
    return null;
  }
  const gates: EvolutionGates = {
    minLevel,
    axis: g.axis as TraitAxis,
    minTraitShare: g.minTraitShare as number,
    minTasks,
    maxCareMistakes,
  };
  if (g.minValidatedRatio !== undefined) {
    if (typeof g.minValidatedRatio !== "number" || g.minValidatedRatio <= 0 || g.minValidatedRatio > 1) {
      errors.push(`${context}: gates.minValidatedRatio must be in (0,1]`);
      return null;
    }
    gates.minValidatedRatio = g.minValidatedRatio;
  }
  return gates;
}

/**
 * Load every pack under `dir`. Unknown directories are an empty result (not
 * an error). Species ids may collide with built-ins or other packs — the
 * loader keeps them all; registration order decides (later pack wins).
 */
export function loadPetPacks(dir: string): PetPackLoadResult {
  const result: PetPackLoadResult = { packs: [], species: [], rules: [], errors: [] };
  if (!existsSync(dir)) return result;

  const pendingRules: Array<{ rule: EvolutionRule; context: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const file = join(dir, slug, "pack.json");
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      result.errors.push(`${slug}: no pack.json`);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      result.errors.push(`${slug}: pack.json is not valid JSON (${(e as Error).message})`);
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { species?: unknown }).species)) {
      result.errors.push(`${slug}: pack.json must have a "species" array`);
      continue;
    }
    const p = parsed as Record<string, unknown>;
    const packName = typeof p.name === "string" && p.name.trim() ? p.name.trim() : slug;
    const loaded: LoadedPack = { slug, name: packName, species: [], rules: [] };
    for (const entry2 of (parsed as { species: unknown[] }).species) {
      const species = parseSpecies(entry2, `${slug}`, result.errors);
      if (species) loaded.species.push(species);
    }
    if (Array.isArray(p.evolutions)) {
      p.evolutions.forEach((r, i) => {
        if (typeof r !== "object" || r === null) {
          result.errors.push(`${slug}: evolutions[${i}] is not an object`);
          return;
        }
        const rr = r as Record<string, unknown>;
        if (typeof rr.from !== "string" || typeof rr.to !== "string") {
          result.errors.push(`${slug}: evolutions[${i}] needs string from/to`);
          return;
        }
        const gates = parseGates(rr.gates, `${slug}: evolutions[${i}]`, result.errors);
        if (gates) pendingRules.push({ rule: { from: rr.from, to: rr.to, gates }, context: slug });
      });
    }
    if (loaded.species.length) {
      result.packs.push(loaded);
      result.species.push(...loaded.species);
    } else if (!result.errors.some((e) => e.startsWith(`${slug}:`)) && !result.errors.some((e) => e.startsWith(`${slug}/`))) {
      result.errors.push(`${slug}: no valid species`);
    }
  }

  // Cross-reference evolution rules once all ids (built-in + packs) are known.
  const known = new Set<string>([
    ...Object.keys(SPECIES),
    ...result.species.map((s) => s.id),
  ]);
  for (const { rule, context } of pendingRules) {
    if (!known.has(rule.from) || !known.has(rule.to)) {
      result.errors.push(`${context}: evolution ${rule.from}->${rule.to} references an unknown species`);
      continue;
    }
    result.rules.push(rule);
  }
  return result;
}

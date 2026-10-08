// Local pet-pack loader — the tuipet model (docs/pet-packs.md): the agentMon
// repo ships ORIGINAL art and this loader only. Users who want other sprites
// (e.g. extracted from their own DVPet copy, as tuipet documents) drop a
// pack.json under <pi agent dir>/agentmon/pets/<slug>/ on THEIR machine.
// Bandai-derived data never enters this repository.
//
// Loading is strictly validated and fail-soft: a broken pack is skipped with
// an error message, never a crash in the host agent (the tamagotchi lesson,
// audit C6). Format (pet-pack format spirit after AgentPet's pet.json):

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { basename, join } from "node:path";
import type { Bitmap } from "../packages/renderer/src/halfblock";
import { POSE_NAMES, SPECIES, type PoseName, type SpeciesDef } from "./registry";
import type { EvolutionGates, EvolutionRule, TraitAxis } from "../packages/core/evolution";
import { slugify, tuipetRecordsToPack, type TuipetSpriteRecord } from "./convert";

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

function validMonoPose(pose: unknown, size = 16): boolean {
  return (
    Array.isArray(pose) &&
    pose.length === size &&
    pose.every((row) => typeof row === "string" && row.length === size && /^[01#.]*$/.test(row)) &&
    pose.some((row) => /[1#]/.test(row))
  );
}

function validColorPose(pose: unknown, paletteKeys: ReadonlySet<string>, size = 16): boolean {
  return (
    Array.isArray(pose) &&
    pose.length === size &&
    pose.every(
      (row) =>
        typeof row === "string" && row.length === size && [...row].every((c) => c === "." || paletteKeys.has(c)),
    ) &&
    pose.some((row) => [...row].some((c) => c !== "."))
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
  let ink: string | undefined;
  if (s.ink !== undefined) {
    if (typeof s.ink !== "string" || !/^#[0-9a-fA-F]{6}$/.test(s.ink)) {
      errors.push(`${context}/${id}: ink must be a #rrggbb hex colour`);
      return null;
    }
    ink = s.ink.toLowerCase();
  }
  let palette: Record<string, string> | undefined;
  if (s.palette !== undefined) {
    if (typeof s.palette !== "object" || s.palette === null || Array.isArray(s.palette)) {
      errors.push(`${context}/${id}: palette must be an object of char -> #rrggbb`);
      return null;
    }
    palette = {};
    for (const [key, value] of Object.entries(s.palette as Record<string, unknown>)) {
      if (key.length !== 1 || key === "." || typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
        errors.push(`${context}/${id}: palette entry ${JSON.stringify(key)} must be one char -> #rrggbb`);
        return null;
      }
      palette[key] = (value as string).toLowerCase();
    }
    if (Object.keys(palette).length > 64) {
      errors.push(`${context}/${id}: palette may hold at most 64 colours`);
      return null;
    }
  }
  const paletteKeys = new Set(palette ? Object.keys(palette) : []);
  const poses: Record<string, Bitmap> = {};
  if (typeof s.poses !== "object" || s.poses === null) {
    errors.push(`${context}/${id}: missing poses`);
    return null;
  }
  for (const [poseName, pose] of Object.entries(s.poses as Record<string, unknown>)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(poseName)) {
      errors.push(`${context}/${id}: bad pose name "${poseName}" (letters/digits/dashes, max 32)`);
      return null;
    }
    const ok = palette ? validColorPose(pose, paletteKeys) : validMonoPose(pose);
    if (!ok) {
      errors.push(
        `${context}/${id}: pose ${poseName} must be 16 rows of 16 chars${palette ? " of palette chars/'.'" : " of 1/0/#/. with ink"}`,
      );
      return null;
    }
    poses[poseName] = pose as Bitmap;
  }
  if (!Object.keys(poses).length) {
    errors.push(`${context}/${id}: no poses`);
    return null;
  }
  let roles: Record<string, string[]>;
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
        !posesList.every((p) => typeof p === "string" && poses[p as string])
      ) {
        errors.push(
          `${context}/${id}: roles.${activity} must be a non-empty list of pose names that exist in poses`,
        );
        return null;
      }
      roles[activity] = posesList as string[];
    }
    if (!roles.idle) {
      errors.push(`${context}/${id}: roles must include "idle" (the renderer's fallback)`);
      return null;
    }
  } else {
    // no roles declared: the default coding table needs the canonical 11
    for (const poseName of POSE_NAMES) {
      if (!poses[poseName]) {
        errors.push(`${context}/${id}: missing pose ${poseName} (or provide roles covering "idle")`);
        return null;
      }
    }
    roles = DEFAULT_ROLES;
  }
  // optional hi-res layers: {"32": {poseName: N x N rows}, ...} — same pose
  // names as the base, square rows of palette chars (mono packs: ink chars)
  let hiPoses: Record<string, Record<string, string[]>> | undefined;
  if (s.hiPoses !== undefined) {
    if (typeof s.hiPoses !== "object" || s.hiPoses === null || Array.isArray(s.hiPoses)) {
      errors.push(`${context}/${id}: hiPoses must be an object of layer-size -> poses`);
      return null;
    }
    hiPoses = {};
    for (const [layerKey, layerRaw] of Object.entries(s.hiPoses as Record<string, unknown>)) {
      const n = Number(layerKey);
      if (!Number.isInteger(n) || n <= 16 || n > 128) {
        errors.push(`${context}/${id}: hiPoses layer "${layerKey}" must be an integer size 17..128`);
        return null;
      }
      if (typeof layerRaw !== "object" || layerRaw === null) {
        errors.push(`${context}/${id}: hiPoses layer "${layerKey}" must be an object of poses`);
        return null;
      }
      const layer: Record<string, string[]> = {};
      for (const [poseName, pose] of Object.entries(layerRaw as Record<string, unknown>)) {
        if (!poses[poseName]) {
          errors.push(`${context}/${id}: hiPoses layer "${layerKey}" pose "${poseName}" has no 16x16 base pose`);
          return null;
        }
        const ok = palette ? validColorPose(pose, paletteKeys, n) : validMonoPose(pose, n);
        if (!ok) {
          errors.push(
            `${context}/${id}: hiPoses layer "${layerKey}" pose ${poseName} must be ${n} rows of ${n} chars${palette ? " of palette chars/'.'" : " of 1/0/#/."}`,
          );
          return null;
        }
        layer[poseName] = pose as string[];
      }
      if (Object.keys(layer).length) hiPoses[layerKey] = layer;
    }
    if (!Object.keys(hiPoses).length) hiPoses = undefined;
  }
  return {
    id,
    name,
    stage,
    description: typeof s.description === "string" ? s.description : undefined,
    ink,
    palette,
    poses,
    roles,
    hiPoses,
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
    result.packs.find((p) => p.slug === context)?.rules.push(rule);
  }
  return result;
}

// --- /pets import — install a pack from any path, in one step ---------------

export interface ImportOptions {
  /** Creature names for a tuipet sprites.json(.gz) source (comma-split). */
  names?: readonly string[];
  /** Auto-chain evolutions (byte -> first -> second ...) for tuipet imports. */
  chain?: boolean;
}

export interface ImportResult {
  ok: boolean;
  /** Installed pack slug (also the folder name under petsDir). */
  slug?: string;
  /** Validated species/rules, ready for immediate registration. */
  species?: SpeciesDef[];
  rules?: EvolutionRule[];
  errors: string[];
}

function readMaybeGzip(path: string): Buffer {
  const raw = readFileSync(path);
  if (path.endsWith(".gz") || raw[0] === 0x1f) return gunzipSync(raw);
  return raw;
}

/**
 * Import a pet pack from `srcPath` — a pack.json file, a directory containing
 * one, or a tuipet sprites.json(.gz) extraction (which needs `names`). The
 * pack is installed under `petsDir/<slug>/pack.json`, validated with the real
 * loader, and rolled back if it does not load cleanly.
 */
export function importPetPack(srcPath: string, petsDir: string, opts: ImportOptions = {}): ImportResult {
  const fail = (errors: string[]): ImportResult => ({ ok: false, errors });
  let target = srcPath;
  try {
    const entries = readdirSync(srcPath, { withFileTypes: true }); // throws when not a directory
    if (!entries.some((e) => e.isFile() && e.name === "pack.json")) {
      return fail([`${srcPath}: directory has no pack.json`]);
    }
    target = join(srcPath, "pack.json");
  } catch {
    // not a directory — treat srcPath itself as the pack file
  }
  if (!existsSync(target)) return fail([`${srcPath}: file not found`]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(readMaybeGzip(target).toString("utf8"));
  } catch (e) {
    return fail([`${basename(target)}: not valid JSON (${(e as Error).message})`]);
  }

  let pack: Record<string, unknown>;
  if (Array.isArray(parsed)) {
    // tuipet sprite records — conversion required
    if (!opts.names?.length) {
      return fail([
        `${basename(target)}: tuipet sprite extraction — add creature names: /pets import <file> Name1,Name2`,
      ]);
    }
    const converted = tuipetRecordsToPack(parsed as TuipetSpriteRecord[], opts.names, {
      chain: opts.chain,
    });
    if (converted.missing.length) {
      return fail([`not found in file: ${converted.missing.join(", ")}`]);
    }
    pack = converted.pack as Record<string, unknown>;
  } else if (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { species?: unknown }).species)) {
    pack = parsed as Record<string, unknown>;
  } else {
    return fail([`${basename(target)}: neither a pack ({"species": [...]}) nor a tuipet sprite array`]);
  }

  const slug = slugify(
    typeof pack.name === "string" && pack.name.trim() ? pack.name : basename(target, ".json"),
  );
  const packDir = join(petsDir, slug);
  const file = join(packDir, "pack.json");
  mkdirSync(packDir, { recursive: true });
  writeFileSync(file, JSON.stringify(pack, null, 2), "utf8");

  // Validate with the real loader; roll back if THIS pack has problems.
  const check = loadPetPacks(petsDir);
  const ours = check.errors.filter((e) => e.startsWith(`${slug}:`) || e.startsWith(`${slug}/`));
  if (ours.length) {
    rmSync(packDir, { recursive: true, force: true });
    return fail(ours);
  }
  const installed = check.packs.find((p) => p.slug === slug);
  return {
    ok: true,
    slug,
    species: installed?.species ?? [],
    rules: installed?.rules ?? [],
    errors: check.errors.filter((e) => !(e.startsWith(`${slug}:`) || e.startsWith(`${slug}/`))),
  };
}

// tuipet/DVPet sprite extraction -> agentMon pet-pack converter.
//
// The TOOL is original agentMon code; the DATA it reads is yours. tuipet's
// sprites.json(.gz) contains frames extracted from DVPet/Digimon (© Bandai)
// — keep such files and their output on your own machine (docs/pet-packs.md).
//
// tuipet record shape (from its parsing code): { num, name, stage, w, h,
// frames: [11 × 16 rows of '0'/'1'] } — frame roles per tuipet's ROLES table:
// 0 idle-A · 1 idle-B · 2/3 sleep · 4 refuse · 5 cheer · 6 attack
// 7 chew · 8 eat · 9 weary · 10 collapse. We best-fit them onto agentMon's
// coding poses; override any slot with a "pose=frame" map.

import type { PoseName } from "./registry";
import { POSE_NAMES } from "./registry";

export interface TuipetSpriteRecord {
  num?: number;
  name: string;
  stage?: string;
  w?: number;
  h?: number;
  frames?: (string[] | null)[] | null;
}

/** Best-fit frame index for each agentMon pose (override per import). */
export const DEFAULT_TUIPET_POSE_MAP: Record<PoseName, number> = {
  idleA: 0, // idle/walk-A
  idleB: 1, // idle/walk-B
  think: 4, // refuse (head down)
  search: 6, // attack/jeer (active, scanning)
  codeA: 7, // chew
  codeB: 8, // eat
  testA: 6, // attack
  testB: 0, // back to stance
  happy: 5, // cheer
  sad: 9, // weary/dejected
  sleep: 2, // sleep-A
};

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "pet";
}

/** Parse a "idleA=0,think=3,codeA=7" override string onto the default map. */
export function parsePoseMapArg(arg?: string): { map: Record<PoseName, number>; errors: string[] } {
  const map: Record<PoseName, number> = { ...DEFAULT_TUIPET_POSE_MAP };
  const errors: string[] = [];
  if (!arg) return { map, errors };
  for (const pair of arg.split(",")) {
    const [pose, idx] = pair.split("=").map((s) => s.trim());
    if (!pose || !idx || !(POSE_NAMES as readonly string[]).includes(pose) || !/^\d+$/.test(idx)) {
      errors.push(`bad map entry "${pair}" (want pose=frameIndex)`);
      continue;
    }
    map[pose as PoseName] = Number(idx);
  }
  return { map, errors };
}

function normalizeFrame(rows: readonly string[] | null | undefined, fallback: readonly string[]): string[] {
  const src = rows && rows.length ? rows : fallback;
  const out: string[] = [];
  for (let y = 0; y < 16; y++) {
    const row = src[y] ?? "";
    out.push(row.padEnd(16, "0").slice(0, 16));
  }
  return out;
}

export interface TuipetImportOptions {
  map: Record<PoseName, number>;
  packName?: string;
  /** Auto-chain byte -> name1 -> name2 ... with gentle default gates. */
  chain?: boolean;
}

export interface TuipetImportResult {
  pack: {
    name: string;
    species: Array<Record<string, unknown>>;
    evolutions?: Array<Record<string, unknown>>;
  };
  warnings: string[];
  missing: string[];
}

/**
 * Build a pack object from tuipet sprite records, selecting creatures by
 * exact name (case-insensitive). Returns the pack plus warnings and any
 * requested names that could not be found.
 */
export function tuipetRecordsToPack(
  records: readonly TuipetSpriteRecord[],
  names: readonly string[],
  opts: TuipetImportOptions,
): TuipetImportResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  const byName = new Map(records.map((r) => [r.name.toLowerCase(), r]));

  const species: Array<Record<string, unknown>> = [];
  const chainIds: string[] = [];
  for (const wanted of names) {
    const record = byName.get(wanted.trim().toLowerCase());
    if (!record) {
      missing.push(wanted);
      continue;
    }
    const frames = record.frames ?? [];
    if (!frames.length || !frames[0]) {
      warnings.push(`${record.name}: no frames in record, skipped`);
      continue;
    }
    const base = normalizeFrame(frames[0], []);
    const poses: Record<string, string[]> = {};
    for (const pose of POSE_NAMES) {
      const idx = opts.map[pose];
      const chosen = frames[idx] ?? frames[0];
      if (!chosen) {
        poses[pose] = base;
        continue;
      }
      poses[pose] = normalizeFrame(chosen, base);
    }
    const id = slugify(record.name);
    chainIds.push(id);
    species.push({
      id,
      name: record.name,
      stage: "branch",
      description: `imported from a tuipet/DVPet extraction (stage ${record.stage ?? "?"}) — local use only`,
      poses,
    });
  }

  const pack: TuipetImportResult["pack"] = {
    name: opts.packName ?? "Imported pets",
    species,
  };

  if (opts.chain && chainIds.length) {
    const gentle = {
      minLevel: 2,
      axis: "research",
      minTraitShare: 0.4,
      minTasks: 3,
      maxCareMistakes: 3,
    };
    const hops = ["byte", ...chainIds].slice(0, -1).map((from, i) => ({
      from,
      to: chainIds[i],
      gates: { ...gentle },
    }));
    // vary the axis along the chain so different behavior grows different pets
    const axes = ["research", "implementation", "validation"] as const;
    hops.forEach((hop, i) => {
      hop.gates.axis = axes[i % axes.length];
    });
    pack.evolutions = hops;
  }

  return { pack, warnings, missing };
}

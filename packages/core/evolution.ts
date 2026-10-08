// Behavioral evolution (plan.md §16): long-term coding behavior decides what
// ByteBaby becomes. The evaluator's SHAPE is ported from tuipet's
// evolution.py (MIT, (c) 2026 Joel Taylor) — declared multi-condition gates,
// all-must-pass, best-candidate selection — while every rule and species
// below is agentMon's own. Gates use the plan §16 inputs: level, trait
// profile, task success, care mistakes, validation discipline.

import type { PetState } from "./pet";
import { levelFromXp } from "./xp";
import type { TraitScores } from "./traits";

export type TraitAxis = keyof TraitScores;

export interface EvolutionGates {
  minLevel: number;
  /** The branch's dominant trait must hold at least this share of the total. */
  axis: TraitAxis;
  minTraitShare: number;
  /** Completed tasks (task success). */
  minTasks: number;
  /** Lifetime care mistakes at or below this. */
  maxCareMistakes: number;
  /** Validated-task ratio (validation discipline; Guardian's bar). */
  minValidatedRatio?: number;
}

export interface EvolutionRule {
  from: string;
  to: string;
  gates: EvolutionGates;
}

/** The three Stage-5 branches from the baby form (plan.md §16). */
export const EVOLUTION_RULES: readonly EvolutionRule[] = [
  {
    from: "byte",
    to: "scout",
    gates: { minLevel: 3, axis: "research", minTraitShare: 0.45, minTasks: 5, maxCareMistakes: 3 },
  },
  {
    from: "byte",
    to: "builder",
    gates: { minLevel: 3, axis: "implementation", minTraitShare: 0.45, minTasks: 5, maxCareMistakes: 3 },
  },
  {
    from: "byte",
    to: "guardian",
    gates: {
      minLevel: 3,
      axis: "validation",
      minTraitShare: 0.45,
      minTasks: 5,
      maxCareMistakes: 2,
      minValidatedRatio: 0.6,
    },
  },
];

// --- runtime (pet-pack) rules — see docs/pet-packs.md -----------------------

const customRules: EvolutionRule[] = [];

/** Register pack-provided evolution rules (appended after the built-ins). */
export function registerEvolutionRules(rules: EvolutionRule[]): void {
  customRules.push(...rules);
}

export function resetCustomEvolutionRules(): void {
  customRules.length = 0;
}

export function allEvolutionRules(): readonly EvolutionRule[] {
  return [...EVOLUTION_RULES, ...customRules];
}

/** Each axis's share of the total trait points. */
export function traitShares(traits: TraitScores): Record<TraitAxis, number> {
  const total = traits.research + traits.implementation + traits.validation;
  if (total === 0) return { research: 0, implementation: 0, validation: 0 };
  return {
    research: traits.research / total,
    implementation: traits.implementation / total,
    validation: traits.validation / total,
  };
}

function gatesPass(pet: PetState, gates: EvolutionGates, shares: Record<TraitAxis, number>): boolean {
  if (levelFromXp(pet.counters.xp) < gates.minLevel) return false;
  if (shares[gates.axis] < gates.minTraitShare) return false;
  if (pet.counters.tasksCompleted < gates.minTasks) return false;
  if (pet.careMistakes > gates.maxCareMistakes) return false;
  if (gates.minValidatedRatio !== undefined) {
    const ratio = pet.counters.tasksCompleted > 0 ? pet.validatedTasks / pet.counters.tasksCompleted : 0;
    if (ratio < gates.minValidatedRatio) return false;
  }
  return true;
}

/**
 * The species the pet evolves into next, or null. Candidates are rules whose
 * `from` matches and whose gates all pass; the winner is the one whose axis
 * holds the highest share (ties resolve in rule order).
 */
export function evolutionTarget(pet: PetState): string | null {
  const shares = traitShares(pet.traits);
  let best: { to: string; share: number; index: number } | null = null;
  allEvolutionRules().forEach((rule, index) => {
    if (rule.from !== pet.species) return;
    if (!gatesPass(pet, rule.gates, shares)) return;
    const share = shares[rule.gates.axis];
    if (!best || share > best.share || (share === best.share && index < best.index)) {
      best = { to: rule.to, share, index };
    }
  });
  return best ? (best as { to: string }).to : null;
}

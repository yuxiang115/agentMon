// Pet/game state, shaped after tama96's tama-core (docs/reference-audit.md §2.3):
// one plain serializable state object, pure functions in reducer.ts, wall-clock
// timestamps carried IN the state so elapsed time can be replayed on load.
//
// The state layer is deliberately daemonless (Stage 2): every mutation funnels
// through PetStore.update (load -> catch-up -> mutate -> atomic save), so a
// later lockfile or socket owner (Stage 7) is a wrapper change, not a core
// change. Roaming position is presentation state and lives with the renderer,
// not here.

import { randomUUID } from "node:crypto";
import type { BehaviorKind, BehaviorMode, TraitScores } from "./traits";

/** Activity vocabulary — the renderer's role table uses the same keys. */
export type Activity =
  | "idle"
  | "walk"
  | "think"
  | "search"
  | "code"
  | "test"
  | "happy"
  | "sad"
  | "sleep";

/**
 * One agent task (plan.md §19 "task boundaries"): opened lazily by the first
 * work event of a run, closed by TASK_COMPLETE (or abandoned at SESSION_END).
 * Feeds the XP bonuses and the care-mistake charges.
 */
export interface TaskWindow {
  openedAt: number;
  /** CODE_WRITE count inside the task. */
  writes: number;
  /** Test/build RUNS (starts) inside the task — ran validation at all. */
  validations: number;
  /** At least one test/build PASS inside the task. */
  validated: boolean;
  /** Any failure or user correction ever happened in the task. */
  failedEver: boolean;
  /** A failure with no pass after it yet. */
  unresolvedFail: boolean;
  /** Passes that actually earned XP (dirty-gated). */
  rewardedPasses: number;
}

/**
 * Lifetime tallies. Stage 2 only counts; the rules that turn tallies into XP,
 * traits and care mistakes are Stage 4 (outcome-based, never per-tool-call).
 */
export interface Counters {
  sessions: number;
  reads: number;
  searches: number;
  thinks: number;
  writes: number;
  commands: number;
  testsStarted: number;
  testsPassed: number;
  testsFailed: number;
  buildsStarted: number;
  buildsPassed: number;
  buildsFailed: number;
  tasksCompleted: number;
  tasksFailed: number;
  userCorrections: number;
  /** Awarded by Stage 4's XP rules; stays 0 until then. */
  xp: number;
}

export interface PetState {
  id: string;
  name: string;
  /** Species id, e.g. "byte" — resolved against pets/sprites at render time. */
  species: string;
  createdAt: number;
  /** Last time this pet was ticked; catch-up replays from here. */
  lastTickAt: number;
  /** Total alive milliseconds (accumulated by tick). */
  ageMs: number;
  activity: Activity;
  /** When the current activity began (drives focus timeout + animation resets). */
  activitySince: number;
  /** Transient emotions (happy/sad) revert to idle at this time; else null. */
  emotionUntil: number | null;
  counters: Counters;
  /** The open task window, if the agent is mid-task. */
  task: TaskWindow | null;
  /** Code was written since the last rewarded pass (XP dirty gate). */
  dirty: boolean;
  /** Lifetime care mistakes (plan.md §21 Care Quality). */
  careMistakes: number;
  /** Lifetime trait accumulation (plan.md §21 Behavior Profile). */
  traits: TraitScores;
  /** Rolling behavior samples (bounded, serializable). */
  behaviorWindow: BehaviorKind[];
  /** The window's current classification. */
  behaviorMode: BehaviorMode;
  /** Completed tasks that were validated (for the validation-discipline gate). */
  validatedTasks: number;
  /** Evolution history: [{from, to, at}]. */
  evolutions: Array<{ from: string; to: string; at: number }>;
}

export interface GameState {
  version: 1;
  /** The pet receiving events (project overrides arrive Stage 6). */
  activePetId: string | null;
  pets: Record<string, PetState>;
  /** Last mutation time; persistence stamps it on save. */
  savedAt: number;
  /**
   * Display settings — extension-managed (e.g. `/pet size`), ignored by the
   * core reducer; survives saves because every mutation spreads the state.
   */
  ui?: { petSize?: number };
}

export interface CreatePetOptions {
  name: string;
  species?: string;
  id?: string;
  now: number;
}

export function createPet(opts: CreatePetOptions): PetState {
  const now = opts.now;
  return {
    id: opts.id ?? randomUUID(),
    name: opts.name,
    species: opts.species ?? "byte",
    createdAt: now,
    lastTickAt: now,
    ageMs: 0,
    activity: "idle",
    activitySince: now,
    emotionUntil: null,
    counters: {
      sessions: 0,
      reads: 0,
      searches: 0,
      thinks: 0,
      writes: 0,
      commands: 0,
      testsStarted: 0,
      testsPassed: 0,
      testsFailed: 0,
      buildsStarted: 0,
      buildsPassed: 0,
      buildsFailed: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      userCorrections: 0,
      xp: 0,
    },
    task: null,
    dirty: false,
    careMistakes: 0,
    traits: { research: 0, implementation: 0, validation: 0 },
    behaviorWindow: [],
    behaviorMode: "STEADY",
    validatedTasks: 0,
    evolutions: [],
  };
}

export function freshState(now: number): GameState {
  return { version: 1, activePetId: null, pets: {}, savedAt: now };
}

export function addPet(state: GameState, pet: PetState): GameState {
  const first = Object.keys(state.pets).length === 0;
  return {
    ...state,
    pets: { ...state.pets, [pet.id]: pet },
    activePetId: first ? pet.id : state.activePetId,
    savedAt: Math.max(state.savedAt, pet.createdAt),
  };
}

export function setActivePet(state: GameState, id: string): GameState {
  if (!state.pets[id] || state.activePetId === id) return state;
  return { ...state, activePetId: id };
}

export function activePet(state: GameState): PetState | undefined {
  return state.activePetId ? state.pets[state.activePetId] : undefined;
}

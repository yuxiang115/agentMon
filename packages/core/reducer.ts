// The pure game core: nextState = reduceEvent(currentState, event), plus a
// time-advancing tick(state, now) — plan.md §14. Both take the clock as data,
// never read Date.now(), and never mutate their inputs.
//
// Stage 4 adds the coding progression (the project's original layer):
//  - task windows open lazily on work events and close on TASK_COMPLETE
//    (or are abandoned at SESSION_END);
//  - XP is outcome-based (xp.ts): passes pay only when fresh code precedes
//    them (dirty gate), task completion pays base + validated + first-pass;
//  - traits accumulate on three axes (traits.ts) and a bounded behavior
//    window classifies how the agent is working right now;
//  - care mistakes charge at task close (care.ts) plus USER_CORRECTION.
//
// Activity interrupts follow plan.md §13's priority order
// (SUCCESS > FAILURE > TEST > CODE > SEARCH > THINK > IDLE): a transient
// emotion (happy/sad) plays out its TTL and resists lower-precedence events,
// while steady activities (code/search/...) always yield — the agent moved on.

import type { CodingEvent, EventType } from "../events/types";
import type { Activity, Counters, GameState, PetState } from "./pet";
import { XP_AWARDS } from "./xp";
import { evolutionTarget } from "./evolution";
import {
  BEHAVIOR_WINDOW,
  classifyBehavior,
  sampleFor,
  traitDelta,
} from "./traits";
import { mistakesAtTaskClose } from "./care";

/** plan.md §13 interrupt priorities (lower number = higher precedence). */
export const ACTIVITY_PRIORITY: Record<Activity, number> = {
  happy: 1, // SUCCESS
  sad: 2, // FAILURE
  test: 3,
  code: 4,
  search: 5,
  think: 6,
  idle: 7,
  walk: 7,
  sleep: 8,
};

/** Transient emotions revert to idle after this long (tuipet's anim_ttl). */
export const EMOTION_TTL_MS = 3_000;
/** Steady focus activities fall back to idle after this long without events. */
export const FOCUS_TIMEOUT_MS = 5 * 60_000;

/** Events that count as agent work and therefore open a task window. */
const WORK_EVENTS: ReadonlySet<EventType> = new Set<EventType>([
  "READ",
  "SEARCH",
  "THINK_START",
  "THINK_END",
  "CODE_WRITE",
  "COMMAND_RUN",
  "TEST_START",
  "TEST_PASS",
  "TEST_FAIL",
  "BUILD_START",
  "BUILD_PASS",
  "BUILD_FAIL",
  "USER_CORRECTION",
]);

/** Event -> the activity the pet performs while it happens. */
export const EVENT_ACTIVITY: Partial<Record<EventType, Activity>> = {
  READ: "search",
  SEARCH: "search",
  THINK_START: "think",
  THINK_END: "idle",
  CODE_WRITE: "code",
  COMMAND_RUN: "code",
  TEST_START: "test",
  BUILD_START: "test",
  TEST_PASS: "happy",
  BUILD_PASS: "happy",
  TASK_COMPLETE: "happy",
  TEST_FAIL: "sad",
  BUILD_FAIL: "sad",
  TASK_FAILED: "sad",
  USER_CORRECTION: "sad",
  SESSION_START: "idle",
  IDLE: "idle",
  SESSION_END: "sleep",
};

/** Event -> lifetime counter it increments. */
export const COUNTER_KEY: Partial<Record<EventType, keyof Counters>> = {
  SESSION_START: "sessions",
  READ: "reads",
  SEARCH: "searches",
  THINK_START: "thinks",
  THINK_END: "thinks",
  CODE_WRITE: "writes",
  COMMAND_RUN: "commands",
  TEST_START: "testsStarted",
  TEST_PASS: "testsPassed",
  TEST_FAIL: "testsFailed",
  BUILD_START: "buildsStarted",
  BUILD_PASS: "buildsPassed",
  BUILD_FAIL: "buildsFailed",
  TASK_COMPLETE: "tasksCompleted",
  TASK_FAILED: "tasksFailed",
  USER_CORRECTION: "userCorrections",
};

/**
 * Fill defaults for fields added after v0.1 saves (Stage 4), so state files
 * written by earlier stages load without migration.
 */
export function normalizePet(pet: PetState): PetState {
  return {
    ...pet,
    task: pet.task ?? null,
    dirty: pet.dirty ?? false,
    careMistakes: pet.careMistakes ?? 0,
    traits: {
      research: pet.traits?.research ?? 0,
      implementation: pet.traits?.implementation ?? 0,
      validation: pet.traits?.validation ?? 0,
    },
    behaviorWindow: pet.behaviorWindow ?? [],
    behaviorMode: pet.behaviorMode ?? "STEADY",
    validatedTasks: pet.validatedTasks ?? 0,
    evolutions: pet.evolutions ?? [],
  };
}

/** Lifecycle boundaries always apply, even mid-celebration. */
const FORCE_ACTIVITY: ReadonlySet<EventType> = new Set(["SESSION_START", "SESSION_END"]);

function applyActivity(pet: PetState, target: Activity, ts: number, force = false): PetState {
  const transient = pet.emotionUntil !== null;
  const curPrio = ACTIVITY_PRIORITY[pet.activity];
  const newPrio = ACTIVITY_PRIORITY[target];
  // Switch when the agent has genuinely moved on (no live transient), when
  // the new event outranks the transient currently playing out, or when a
  // lifecycle boundary (SESSION_START/END) forces the change.
  if (!force && transient && newPrio > curPrio) return pet;
  return {
    ...pet,
    activity: target,
    activitySince: ts,
    emotionUntil: target === "happy" || target === "sad" ? ts + EMOTION_TTL_MS : null,
  };
}

/**
 * Fold one normalized coding event into the state (applies to the active pet;
 * project->pet routing arrives in Stage 6). Pure: returns a new state.
 */
export function reduceEvent(state: GameState, event: CodingEvent): GameState {
  const raw = state.activePetId ? state.pets[state.activePetId] : undefined;
  if (!raw) return state;

  // A transient emotion whose TTL already elapsed (checked against the
  // event's own clock — ticks may not have run) is normalized to idle first,
  // so a stale happy/sad can never block a lower-precedence event.
  const normalized = normalizePet(raw);
  const stale = normalized.emotionUntil !== null && event.ts >= normalized.emotionUntil;
  let next: PetState = {
    ...normalized,
    activity: stale ? "idle" : normalized.activity,
    emotionUntil: stale ? null : normalized.emotionUntil,
    counters: { ...normalized.counters },
    task: normalized.task ? { ...normalized.task } : null,
    traits: { ...normalized.traits },
    behaviorWindow: [...normalized.behaviorWindow],
  };

  const counter = COUNTER_KEY[event.type];
  if (counter) next.counters[counter] = next.counters[counter] + 1;
  const target = EVENT_ACTIVITY[event.type];
  if (target) next = applyActivity(next, target, event.ts, FORCE_ACTIVITY.has(event.type));

  // --- progression (plan.md §15/§21) ---
  const type = event.type;
  if (WORK_EVENTS.has(type) && !next.task) {
    next.task = {
      openedAt: event.ts,
      writes: 0,
      validations: 0,
      validated: false,
      failedEver: false,
      unresolvedFail: false,
      rewardedPasses: 0,
    };
  }

  const delta = traitDelta(type);
  if (delta) {
    for (const [axis, amount] of Object.entries(delta)) {
      next.traits[axis as keyof typeof next.traits] += amount as number;
    }
  }

  const kind = sampleFor(type);
  if (kind) {
    next.behaviorWindow.push(kind);
    if (next.behaviorWindow.length > BEHAVIOR_WINDOW) next.behaviorWindow.shift();
    next.behaviorMode = classifyBehavior(next.behaviorWindow);
  }

  const task = next.task;
  switch (type) {
    case "CODE_WRITE":
      next.dirty = true;
      if (task) task.writes++;
      break;
    case "TEST_START":
    case "BUILD_START":
      if (task) task.validations++;
      break;
    case "TEST_FAIL":
    case "BUILD_FAIL":
      if (task) {
        task.failedEver = true;
        task.unresolvedFail = true;
      }
      break;
    case "TEST_PASS":
    case "BUILD_PASS": {
      const award = type === "TEST_PASS" ? XP_AWARDS.TEST_PASS : XP_AWARDS.BUILD_PASS;
      if (task) {
        task.validated = true;
        task.unresolvedFail = false;
      }
      if (next.dirty) {
        next.counters.xp += award;
        next.dirty = false;
        if (task) task.rewardedPasses++;
      }
      break;
    }
    case "USER_CORRECTION":
      next.careMistakes++;
      if (task) task.failedEver = true;
      break;
    case "TASK_COMPLETE": {
      if (task) {
        let award = XP_AWARDS.TASK_COMPLETE;
        if (task.validated) award += XP_AWARDS.VALIDATED_TASK_BONUS;
        // first-pass = validated AND nothing ever failed along the way
        if (task.validated && !task.failedEver) award += XP_AWARDS.FIRST_PASS_BONUS;
        next.counters.xp += award;
        if (task.validated) next.validatedTasks++;
        next.careMistakes += mistakesAtTaskClose(task).length;
        next.task = null;
        next.dirty = false;
        // Evolution check at task close (plan.md §16 multi-gate).
        const target = evolutionTarget(next);
        if (target) {
          next.evolutions = [...next.evolutions, { from: next.species, to: target, at: event.ts }];
          next.species = target;
          // EVOLUTION outranks everything (plan.md §13): a forced, longer
          // celebration while the new form takes over the screen.
          next = applyActivity(next, "happy", event.ts, true);
          next.emotionUntil = event.ts + 3 * EMOTION_TTL_MS;
        }
      }
      break;
    }
    case "SESSION_END":
      // task abandoned mid-flight: no completion XP, no close charges
      next.task = null;
      next.dirty = false;
      break;
  }

  return {
    ...state,
    pets: { ...state.pets, [next.id]: next },
    savedAt: Math.max(state.savedAt, event.ts),
  };
}

function tickPet(pet0: PetState, now: number): PetState {
  const pet = normalizePet(pet0);
  const elapsed = Math.max(0, now - pet.lastTickAt); // clock-skew safe (tama96)
  const emotionExpired = pet.emotionUntil !== null && now >= pet.emotionUntil;
  const focusExpired =
    !emotionExpired &&
    (pet.activity === "code" ||
      pet.activity === "search" ||
      pet.activity === "think" ||
      pet.activity === "test") &&
    now - pet.activitySince >= FOCUS_TIMEOUT_MS;
  if (elapsed === 0 && !emotionExpired && !focusExpired && pet0 === pet) return pet0;
  if (elapsed === 0 && !emotionExpired && !focusExpired) return pet;
  return {
    ...pet,
    ageMs: pet.ageMs + elapsed,
    lastTickAt: Math.max(pet.lastTickAt, now),
    activity: emotionExpired || focusExpired ? "idle" : pet.activity,
    emotionUntil: emotionExpired ? null : pet.emotionUntil,
  };
}

/**
 * Advance time-based state to `now` in ONE closed-form step (the audit's
 * "batched catch-up": no per-second replay loop, unlike tama96). Convergence
 * is a tested invariant: tick(tick(s, t1), t2) === tick(s, t2) for t1 <= t2.
 */
export function tick(state: GameState, now: number): GameState {
  const pets: Record<string, PetState> = {};
  let changed = false;
  for (const [id, pet] of Object.entries(state.pets)) {
    const next = tickPet(pet, now);
    if (next !== pet) changed = true;
    pets[id] = next;
  }
  if (!changed) return state;
  return { ...state, pets, savedAt: Math.max(state.savedAt, now) };
}

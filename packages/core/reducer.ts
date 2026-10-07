// The pure game core: nextState = reduceEvent(currentState, event), plus a
// time-advancing tick(state, now) — plan.md §14. Both take the clock as data,
// never read Date.now(), and never mutate their inputs.
//
// Activity interrupts follow plan.md §13's priority order
// (SUCCESS > FAILURE > TEST > CODE > SEARCH > THINK > IDLE): a transient
// emotion (happy/sad) plays out its TTL and resists lower-precedence events,
// while steady activities (code/search/...) always yield — the agent moved on.

import type { CodingEvent, EventType } from "../events/types";
import type { Activity, Counters, GameState, PetState } from "./pet";

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

/** Event -> the activity the pet performs while it happens. */
export const EVENT_ACTIVITY: Partial<Record<EventType, Activity>> = {
  READ: "search",
  SEARCH: "search",
  THINK_START: "think",
  THINK_END: "think",
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

function applyActivity(pet: PetState, target: Activity, ts: number): PetState {
  const transient = pet.emotionUntil !== null;
  const curPrio = ACTIVITY_PRIORITY[pet.activity];
  const newPrio = ACTIVITY_PRIORITY[target];
  // Switch when the agent has genuinely moved on (no live transient), or when
  // the new event outranks the transient currently playing out.
  if (transient && newPrio > curPrio) return pet;
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
  const pet = state.activePetId ? state.pets[state.activePetId] : undefined;
  if (!pet) return state;

  // A transient emotion whose TTL already elapsed (checked against the
  // event's own clock — ticks may not have run) is normalized to idle first,
  // so a stale happy/sad can never block a lower-precedence event.
  const base: PetState =
    pet.emotionUntil !== null && event.ts >= pet.emotionUntil
      ? { ...pet, activity: "idle", emotionUntil: null }
      : pet;

  let next: PetState = { ...base, counters: { ...base.counters } };
  const counter = COUNTER_KEY[event.type];
  if (counter) next.counters[counter] = next.counters[counter] + 1;
  const target = EVENT_ACTIVITY[event.type];
  if (target) next = applyActivity(next, target, event.ts);

  return {
    ...state,
    pets: { ...state.pets, [pet.id]: next },
    savedAt: Math.max(state.savedAt, event.ts),
  };
}

function tickPet(pet: PetState, now: number): PetState {
  const elapsed = Math.max(0, now - pet.lastTickAt); // clock-skew safe (tama96)
  const emotionExpired = pet.emotionUntil !== null && now >= pet.emotionUntil;
  const focusExpired =
    !emotionExpired &&
    (pet.activity === "code" ||
      pet.activity === "search" ||
      pet.activity === "think" ||
      pet.activity === "test") &&
    now - pet.activitySince >= FOCUS_TIMEOUT_MS;
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

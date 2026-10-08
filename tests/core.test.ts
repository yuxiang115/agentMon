import { describe, expect, it } from "vitest";
import { addPet, createPet, freshState, setActivePet, type GameState, type PetState } from "../packages/core/pet";
import {
  EMOTION_TTL_MS,
  FOCUS_TIMEOUT_MS,
  IDLE_SLEEP_MS,
  reduceEvent,
  tick,
} from "../packages/core/reducer";
import { mulberry32 } from "../packages/renderer/src/animation";
import type { CodingEvent, EventType } from "../packages/events/types";

const T0 = 1_700_000_000_000;

function makeState(now = T0): GameState {
  return addPet(freshState(now), createPet({ name: "Byte", now }));
}

function ev(type: EventType, ts: number): CodingEvent {
  return { type, ts, sessionId: "s1", project: "/repo" };
}

function petOf(state: GameState): PetState {
  return state.pets[state.activePetId!];
}

describe("reduceEvent — activity mapping (plan.md §12/§22)", () => {
  it.each([
    ["READ", "search"],
    ["SEARCH", "search"],
    ["THINK_START", "think"],
    ["CODE_WRITE", "code"],
    ["COMMAND_RUN", "code"],
    ["TEST_START", "test"],
    ["TEST_PASS", "happy"],
    ["TASK_COMPLETE", "happy"],
    ["TEST_FAIL", "sad"],
    ["USER_CORRECTION", "sad"],
    ["SESSION_END", "sleep"],
    ["SESSION_START", "idle"],
  ] as const)("%s -> %s", (type, activity) => {
    const next = reduceEvent(makeState(), ev(type, T0 + 100));
    expect(petOf(next).activity).toBe(activity);
  });

  it("counts every event into its lifetime counter", () => {
    let s = makeState();
    for (const type of ["READ", "READ", "SEARCH", "CODE_WRITE", "CODE_WRITE", "CODE_WRITE"] as EventType[]) {
      s = reduceEvent(s, ev(type, T0 + 1));
    }
    const c = petOf(s).counters;
    expect(c.reads).toBe(2);
    expect(c.searches).toBe(1);
    expect(c.writes).toBe(3);
    expect(c.xp).toBe(0); // XP rules arrive in Stage 4
  });

  it("never mutates the input state", () => {
    const original = makeState();
    const before = structuredClone(original);
    reduceEvent(before, ev("CODE_WRITE", T0 + 5));
    expect(before).toEqual(original);
  });
});

describe("reduceEvent — interrupt priorities (plan.md §13)", () => {
  it("a transient emotion resists lower-precedence events", () => {
    let s = reduceEvent(makeState(), ev("TEST_PASS", T0)); // happy, prio 1
    s = reduceEvent(s, ev("READ", T0 + 100)); // search, prio 5 — must wait
    expect(petOf(s).activity).toBe("happy");
    s = reduceEvent(s, ev("TEST_FAIL", T0 + 200)); // sad, prio 2 — also waits
    expect(petOf(s).activity).toBe("happy");
    // counters still record even while the animation is pinned
    expect(petOf(s).counters.reads).toBe(1);
    expect(petOf(s).counters.testsFailed).toBe(1);
  });

  it("steady activities always yield — the agent moved on", () => {
    let s = reduceEvent(makeState(), ev("CODE_WRITE", T0)); // code, prio 4
    s = reduceEvent(s, ev("READ", T0 + 100)); // search, prio 5
    expect(petOf(s).activity).toBe("search");
  });

  it("TEST_START outranks CODE_WRITE", () => {
    let s = reduceEvent(makeState(), ev("CODE_WRITE", T0));
    s = reduceEvent(s, ev("TEST_START", T0 + 100));
    expect(petOf(s).activity).toBe("test");
  });

  it("emotions expire via tick, then normal service resumes", () => {
    let s = reduceEvent(makeState(), ev("TEST_PASS", T0)); // happy for EMOTION_TTL_MS
    s = tick(s, T0 + EMOTION_TTL_MS - 1);
    expect(petOf(s).activity).toBe("happy");
    s = tick(s, T0 + EMOTION_TTL_MS);
    expect(petOf(s).activity).toBe("idle");
    s = reduceEvent(s, ev("READ", T0 + EMOTION_TTL_MS + 50));
    expect(petOf(s).activity).toBe("search");
  });

  it("a stale expired emotion no longer blocks later events", () => {
    let s = reduceEvent(makeState(T0), ev("TEST_PASS", T0)); // happy until T0+TTL
    s = reduceEvent(s, ev("SESSION_END", T0 + EMOTION_TTL_MS + 7_000)); // long stale
    expect(petOf(s).activity).toBe("sleep");
  });

  it("sleep persists until the next session wakes the pet", () => {
    let s = reduceEvent(makeState(), ev("SESSION_END", T0));
    s = tick(s, T0 + 3_600_000); // an hour later
    expect(petOf(s).activity).toBe("sleep");
    s = reduceEvent(s, ev("SESSION_START", T0 + 3_600_001));
    expect(petOf(s).activity).toBe("idle");
  });
});

describe("reduceEvent — routing", () => {
  it("events apply only to the active pet", () => {
    let s = makeState(T0);
    const second = createPet({ name: "Scout", species: "byte", now: T0 + 1 });
    s = addPet(s, second); // active stays Byte (first pet)
    s = reduceEvent(s, ev("CODE_WRITE", T0 + 10));
    expect(s.pets[second.id].counters.writes).toBe(0);
    expect(petOf(s).counters.writes).toBe(1);
    s = setActivePet(s, second.id);
    s = reduceEvent(s, ev("CODE_WRITE", T0 + 20));
    expect(s.pets[second.id].counters.writes).toBe(1);
  });

  it("no active pet -> state unchanged", () => {
    const empty = freshState(T0);
    expect(reduceEvent(empty, ev("READ", T0))).toBe(empty);
  });
});

describe("tick — injected clock, batched catch-up", () => {
  it("accumulates age and stamps lastTickAt", () => {
    const s0 = makeState(T0);
    const snapshot = structuredClone(s0);
    const s1 = tick(s0, T0 + 10_000);
    expect(petOf(s1).ageMs).toBe(10_000);
    expect(petOf(s1).lastTickAt).toBe(T0 + 10_000);
    expect(s0).toEqual(snapshot); // input untouched
  });

  it("clamps clock skew (now before lastTickAt is a no-op)", () => {
    const s = tick(makeState(T0), T0 - 5_000);
    expect(petOf(s).ageMs).toBe(0);
  });

  it("focus activities fall back to idle after FOCUS_TIMEOUT_MS", () => {
    let s = reduceEvent(makeState(T0), ev("CODE_WRITE", T0 + 1_000));
    s = tick(s, T0 + 1_000 + FOCUS_TIMEOUT_MS - 1);
    expect(petOf(s).activity).toBe("code");
    s = tick(s, T0 + 1_000 + FOCUS_TIMEOUT_MS);
    expect(petOf(s).activity).toBe("idle");
  });

  it("convergence: one big tick equals many small ticks (audit §2.3 property)", () => {
    const rng = mulberry32(0xC0FFEE);
    const activities = ["idle", "code", "search", "think", "test", "happy", "sad", "sleep"] as const;
    for (let i = 0; i < 300; i++) {
      const pet = createPet({ name: "P", now: T0 });
      pet.activity = activities[Math.floor(rng() * activities.length)];
      pet.activitySince = T0 - Math.floor(rng() * FOCUS_TIMEOUT_MS * 2);
      pet.emotionUntil = rng() < 0.5 ? T0 + Math.floor(rng() * 20_000) : null;
      const state = addPet(freshState(T0), pet);
      const t1 = T0 + Math.floor(rng() * 50_000) + 1;
      const t2 = t1 + Math.floor(rng() * 200_000) + 1;
      const stepped = tick(tick(structuredClone(state), t1), t2);
      const direct = tick(structuredClone(state), t2);
      expect(stepped).toEqual(direct);
    }
  });
});

describe("idle doze — an unattended pet naps (V-Pet behaviour)", () => {
  it("an idle pet falls asleep after IDLE_SLEEP_MS and stays asleep", () => {
    let s = addPet(freshState(T0), createPet({ name: "P", now: T0 }));
    s = { ...s, activePetId: Object.keys(s.pets)[0]! };
    const id = s.activePetId!;
    const before = tick(s, T0 + IDLE_SLEEP_MS - 1);
    expect(before.pets[id]!.activity).toBe("idle"); // just under the doze
    const after = tick(s, T0 + IDLE_SLEEP_MS);
    expect(after.pets[id]!.activity).toBe("sleep");
    expect(after.pets[id]!.activitySince).toBe(T0 + IDLE_SLEEP_MS); // stamped at the crossing
    expect(tick(after, T0 + IDLE_SLEEP_MS + 60_000).pets[id]!.activity).toBe("sleep");
  });

  it("any work event wakes the sleeper (sleep is the lowest interrupt)", () => {
    let s = addPet(freshState(T0), createPet({ name: "P", now: T0 }));
    s = { ...s, activePetId: Object.keys(s.pets)[0]! };
    const id = s.activePetId!;
    const asleep = tick(s, T0 + IDLE_SLEEP_MS);
    expect(asleep.pets[id]!.activity).toBe("sleep");
    const woken = reduceEvent(asleep, { type: "READ", ts: T0 + IDLE_SLEEP_MS + 100 });
    expect(woken.pets[id]!.activity).toBe("search");
  });
});

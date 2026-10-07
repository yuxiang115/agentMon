import { describe, expect, it } from "vitest";
import { addPet, createPet, freshState, type GameState, type PetState } from "../packages/core/pet";
import { reduceEvent, tick } from "../packages/core/reducer";
import { levelFromXp, xpProgress, xpToReach, XP_AWARDS } from "../packages/core/xp";
import { classifyBehavior, traitDelta } from "../packages/core/traits";
import { mistakesAtTaskClose } from "../packages/core/care";
import type { CodingEvent, EventType } from "../packages/events/types";

const T0 = 1_700_000_000_000;

function makeState(now = T0): GameState {
  return addPet(freshState(now), createPet({ name: "Byte", now }));
}

function run(state: GameState, ...types: EventType[]): GameState {
  let t = T0;
  let s = state;
  for (const type of types) {
    t += 100;
    s = reduceEvent(s, { type, ts: t } as CodingEvent);
  }
  return s;
}

const petOf = (s: GameState): PetState => s.pets[s.activePetId!];

describe("level curve", () => {
  it("level 1 is free, then 100/300/600...", () => {
    expect(xpToReach(1)).toBe(0);
    expect(xpToReach(2)).toBe(100);
    expect(xpToReach(3)).toBe(300);
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(99)).toBe(1);
    expect(levelFromXp(100)).toBe(2);
    expect(levelFromXp(299)).toBe(2);
    expect(levelFromXp(300)).toBe(3);
  });

  it("xpProgress reports position inside the level", () => {
    expect(xpProgress(0)).toEqual({ level: 1, into: 0, span: 100 });
    expect(xpProgress(130)).toEqual({ level: 2, into: 30, span: 200 });
  });
});

describe("XP — outcome-based with the dirty-gate dedup (plan.md §15)", () => {
  it("a pass with fresh code pays; re-running the same tests pays nothing", () => {
    let s = run(makeState(), "CODE_WRITE", "TEST_START", "TEST_PASS");
    expect(petOf(s).counters.xp).toBe(XP_AWARDS.TEST_PASS); // 3
    s = run(s, "TEST_START", "TEST_PASS", "TEST_START", "TEST_PASS");
    expect(petOf(s).counters.xp).toBe(XP_AWARDS.TEST_PASS); // still 3 — farming blocked
    s = run(s, "CODE_WRITE", "TEST_PASS");
    expect(petOf(s).counters.xp).toBe(XP_AWARDS.TEST_PASS * 2); // fresh code reopens the gate
  });

  it("raw tool calls never award XP", () => {
    const s = run(makeState(), "READ", "READ", "READ", "SEARCH", "COMMAND_RUN", "THINK_START");
    expect(petOf(s).counters.xp).toBe(0);
  });

  it("task complete pays base + validated + first-pass bonuses", () => {
    const clean = run(makeState(), "CODE_WRITE", "TEST_START", "TEST_PASS", "TASK_COMPLETE");
    expect(petOf(clean).counters.xp).toBe(
      XP_AWARDS.TEST_PASS + XP_AWARDS.TASK_COMPLETE + XP_AWARDS.VALIDATED_TASK_BONUS + XP_AWARDS.FIRST_PASS_BONUS,
    );

    const failedThenFixed = run(makeState(), "CODE_WRITE", "TEST_FAIL", "TEST_PASS", "TASK_COMPLETE");
    expect(petOf(failedThenFixed).counters.xp).toBe(
      XP_AWARDS.TEST_PASS + XP_AWARDS.TASK_COMPLETE + XP_AWARDS.VALIDATED_TASK_BONUS, // no first-pass
    );

    const unvalidated = run(makeState(), "CODE_WRITE", "COMMAND_RUN", "TASK_COMPLETE");
    expect(petOf(unvalidated).counters.xp).toBe(XP_AWARDS.TASK_COMPLETE); // neither bonus
  });

  it("TASK_COMPLETE without an open task pays nothing (idle chat turn)", () => {
    const s = run(makeState(), "TASK_COMPLETE");
    expect(petOf(s).counters.xp).toBe(0);
  });

  it("SESSION_END abandons the open task — no completion XP, no close charges", () => {
    const s = run(makeState(), "CODE_WRITE", "TEST_FAIL", "SESSION_END", "TASK_COMPLETE");
    expect(petOf(s).counters.xp).toBe(0);
    expect(petOf(s).careMistakes).toBe(0);
  });
});

describe("care mistakes (plan.md §21 Care Quality)", () => {
  it("failed-at-close: a failure with no pass after it charges at close", () => {
    const s = run(makeState(), "CODE_WRITE", "TEST_START", "TEST_FAIL", "TASK_COMPLETE");
    expect(petOf(s).careMistakes).toBeGreaterThanOrEqual(1);
  });

  it("a resolved failure charges nothing", () => {
    const s = run(makeState(), "CODE_WRITE", "TEST_FAIL", "TEST_PASS", "TASK_COMPLETE");
    expect(petOf(s).careMistakes).toBe(0);
  });

  it("unvalidated-close: wrote code, never ran validation", () => {
    const s = run(makeState(), "CODE_WRITE", "CODE_WRITE", "COMMAND_RUN", "TASK_COMPLETE");
    expect(petOf(s).careMistakes).toBe(1);
    // running tests (even failing) counts as validation attempted
    const tried = run(makeState(), "CODE_WRITE", "TEST_START", "TEST_FAIL", "TEST_PASS", "TASK_COMPLETE");
    expect(petOf(tried).careMistakes).toBe(0);
  });

  it("user corrections charge directly and spoil first-pass", () => {
    const s = run(makeState(), "CODE_WRITE", "USER_CORRECTION", "CODE_WRITE", "TEST_PASS", "TASK_COMPLETE");
    expect(petOf(s).careMistakes).toBe(1);
    expect(petOf(s).counters.xp).toBe(
      XP_AWARDS.TEST_PASS + XP_AWARDS.TASK_COMPLETE + XP_AWARDS.VALIDATED_TASK_BONUS,
    );
  });

  it("mistakesAtTaskClose exposes the canonical charge list", () => {
    expect(
      mistakesAtTaskClose({ openedAt: 0, writes: 3, validations: 0, validated: false, failedEver: true, unresolvedFail: true, rewardedPasses: 0 }),
    ).toEqual(["failed-at-close", "unvalidated-close"]);
  });
});

describe("traits (plan.md §21 Behavior Profile)", () => {
  it("accumulate on three axes from events", () => {
    const s = run(makeState(), "READ", "SEARCH", "CODE_WRITE", "CODE_WRITE", "TEST_PASS");
    expect(petOf(s).traits).toEqual({ research: 2, implementation: 2, validation: 2 });
  });

  it("traitDelta is null for non-scoring events", () => {
    expect(traitDelta("SESSION_START")).toBeNull();
    expect(traitDelta("THINK_END")).toBeNull();
  });
});

describe("behavior window (tamagotchi AgentBehaviorClassifier port)", () => {
  it("BLOCKED on repeated failures", () => {
    expect(classifyBehavior(["read", "write", "fail", "fail", "fail", "read"])).toBe("BLOCKED");
  });

  it("LOOPING on a long same-kind tail run", () => {
    expect(classifyBehavior(["write", "read", "read", "read", "read", "read", "read"])).toBe("LOOPING");
  });

  it("EXPLORING when all reads and no writes", () => {
    expect(classifyBehavior(["read", "read", "read", "read", "read", "read", "read", "read", "command"])).toBe("EXPLORING");
  });

  it("VALIDATING when the window is validation-heavy", () => {
    expect(classifyBehavior(["validate", "validate", "validate", "validate", "validate", "validate", "read"])).toBe("VALIDATING");
  });

  it("BUILDING when writes outpace reads", () => {
    expect(classifyBehavior(["write", "write", "write", "read", "command"])).toBe("BUILDING");
  });

  it("STEADY otherwise", () => {
    expect(classifyBehavior([])).toBe("STEADY");
    expect(classifyBehavior(["read", "write", "read", "write"])).toBe("STEADY");
  });

  it("the reducer keeps a bounded window and classifies live", () => {
    // READ and SEARCH are the same behavior kind ("read") — a long same-kind
    // tail is LOOPING by the classifier's design (tamagotchi semantics)
    const reads: EventType[] = [];
    for (let i = 0; i < 30; i++) reads.push("READ", "SEARCH");
    const looping = run(makeState(), ...reads);
    expect(petOf(looping).behaviorWindow.length).toBeLessThanOrEqual(20);
    expect(petOf(looping).behaviorMode).toBe("LOOPING");

    // mixed reads + commands (different kinds) reads as EXPLORING
    const mixed: EventType[] = [];
    for (let i = 0; i < 12; i++) mixed.push("READ", "COMMAND_RUN");
    const exploring = run(makeState(), ...mixed);
    expect(petOf(exploring).behaviorMode).toBe("EXPLORING");
  });
});

describe("old saves (pre-Stage-4 fields) load without migration", () => {
  it("a pet JSON missing task/traits/behavior still reduces and tick()s", () => {
    const state = makeState();
    const id = state.activePetId!;
    const legacy = state.pets[id] as unknown as Record<string, unknown>;
    delete legacy.task;
    delete legacy.dirty;
    delete legacy.careMistakes;
    delete legacy.traits;
    delete legacy.behaviorWindow;
    delete legacy.behaviorMode;
    let s: GameState = { ...state, pets: { ...state.pets, [id]: legacy as unknown as PetState } };
    s = run(s, "CODE_WRITE", "TEST_PASS", "TASK_COMPLETE");
    expect(petOf(s).counters.xp).toBeGreaterThan(0);
    expect(petOf(s).traits.validation).toBeGreaterThan(0);
    const t = tick(s, T0 + 60_000);
    // behavior mode is event-driven and persists across ticks (last classified)
    expect(petOf(t).behaviorMode).toBe("BUILDING");
  });
});

describe("full session integration", () => {
  it("a realistic session levels the pet and reports its shape", () => {
    const s = run(
      makeState(),
      "SESSION_START", "READ", "SEARCH", "THINK_START", "CODE_WRITE", "CODE_WRITE",
      "TEST_START", "TEST_FAIL", "CODE_WRITE", "TEST_PASS", "TASK_COMPLETE", "SESSION_END",
    );
    const pet = petOf(s);
    expect(pet.counters.xp).toBe(
      XP_AWARDS.TEST_PASS + XP_AWARDS.TASK_COMPLETE + XP_AWARDS.VALIDATED_TASK_BONUS,
    );
    expect(levelFromXp(pet.counters.xp)).toBe(1); // 18 xp — a strong start, not a level yet
    expect(pet.careMistakes).toBe(0); // failure was resolved before close
    expect(pet.traits.research).toBe(2);
    expect(pet.activity).toBe("sleep");
  });
});

import { describe, expect, it } from "vitest";
import { addPet, createPet, freshState, type GameState, type PetState } from "../packages/core/pet";
import { reduceEvent } from "../packages/core/reducer";
import { EVOLUTION_RULES, evolutionTarget, traitShares } from "../packages/core/evolution";
import { levelFromXp } from "../packages/core/xp";
import { SPECIES } from "../pets/registry";

const T0 = 1_700_000_000_000;

function petWith(overrides: Partial<PetState>): PetState {
  const pet = createPet({ name: "Byte", now: T0 });
  return { ...pet, ...overrides, counters: { ...pet.counters, ...(overrides.counters ?? {}) } };
}

describe("traitShares", () => {
  it("computes axis shares of the total", () => {
    const shares = traitShares({ research: 20, implementation: 5, validation: 5 });
    expect(shares.research).toBeCloseTo(0.667, 2);
    expect(shares.implementation).toBeCloseTo(0.167, 2);
    expect(shares.validation).toBeCloseTo(0.167, 2);
  });

  it("handles the zero-trait pet", () => {
    expect(traitShares({ research: 0, implementation: 0, validation: 0 })).toEqual({
      research: 0,
      implementation: 0,
      validation: 0,
    });
  });
});

describe("evolutionTarget — plan.md §16 multi-gate evaluation", () => {
  const researchPet = petWith({
    counters: { xp: 300, tasksCompleted: 5 } as PetState["counters"], // xp 300 = level 3
    traits: { research: 20, implementation: 5, validation: 5 }, // 67% research
  });

  it("a research-dominant level-3 pet with 5 tasks evolves into Scout", () => {
    expect(evolutionTarget(researchPet)).toBe("scout");
  });

  it("level gate blocks evolution", () => {
    expect(evolutionTarget({ ...researchPet, counters: { ...researchPet.counters, xp: 299 } })).toBeNull();
  });

  it("task-success gate blocks evolution", () => {
    expect(
      evolutionTarget({ ...researchPet, counters: { ...researchPet.counters, tasksCompleted: 4 } }),
    ).toBeNull();
  });

  it("trait-share gate blocks the wrong profile", () => {
    // same stats flipped to validation-dominant — now it's Guardian material
    expect(
      evolutionTarget({
        ...researchPet,
        traits: { research: 5, implementation: 5, validation: 20 },
        validatedTasks: 5,
      }),
    ).toBe("guardian");
    // an even profile satisfies nobody's 45% bar
    expect(evolutionTarget({ ...researchPet, traits: { research: 9, implementation: 9, validation: 9 } })).toBeNull();
  });

  it("care-mistake gate: Guardian's bar is at-or-below 2", () => {
    const guardianPet = {
      ...researchPet,
      traits: { research: 5, implementation: 5, validation: 20 },
      validatedTasks: 5,
      careMistakes: 0,
    };
    expect(evolutionTarget(guardianPet)).toBe("guardian");
    expect(evolutionTarget({ ...guardianPet, careMistakes: 2 })).toBe("guardian"); // at the bar passes
    expect(evolutionTarget({ ...guardianPet, careMistakes: 3 })).toBeNull(); // over the bar
  });

  it("Guardian requires validation discipline (>= 60% validated tasks)", () => {
    const base = {
      ...researchPet,
      traits: { research: 5, implementation: 5, validation: 20 },
      careMistakes: 0,
    };
    expect(evolutionTarget({ ...base, validatedTasks: 2 })).toBeNull(); // 2/5 = 40%
    expect(evolutionTarget({ ...base, validatedTasks: 3 })).toBe("guardian"); // exactly 60%
    expect(evolutionTarget({ ...base, validatedTasks: 4 })).toBe("guardian");
  });

  it("branch species never evolve again (Stage 5 scope)", () => {
    expect(evolutionTarget({ ...researchPet, species: "scout" })).toBeNull();
    expect(EVOLUTION_RULES.every((r) => r.from === "byte")).toBe(true);
  });

  it("a tie between axes resolves in rule order (scout first)", () => {
    expect(
      evolutionTarget({
        ...researchPet,
        traits: { research: 9, implementation: 9, validation: 2 }, // 45%/45%/10%
      }),
    ).toBe("scout");
  });
});

describe("evolution through the reducer", () => {
  function stateWithEvolutionReadyPet(): GameState {
    const pet = petWith({
      counters: { xp: 300, tasksCompleted: 4 } as PetState["counters"],
      traits: { research: 20, implementation: 5, validation: 5 },
      validatedTasks: 4,
    });
    return addPet(freshState(T0), pet);
  }

  it("the qualifying task close triggers the evolution and a forced celebration", () => {
    let s = stateWithEvolutionReadyPet();
    s = reduceEvent(s, { type: "CODE_WRITE", ts: T0 + 100 });
    s = reduceEvent(s, { type: "TEST_START", ts: T0 + 200 });
    s = reduceEvent(s, { type: "TEST_PASS", ts: T0 + 300 });
    s = reduceEvent(s, { type: "TASK_COMPLETE", ts: T0 + 400 }); // 5th task -> gates pass

    const pet = s.pets[s.activePetId!];
    expect(pet.species).toBe("scout");
    expect(pet.evolutions).toEqual([{ from: "byte", to: "scout", at: T0 + 400 }]);
    expect(pet.activity).toBe("happy");
    expect(pet.emotionUntil).toBe(T0 + 400 + 3 * 3000); // the longer evolution celebration
    expect(pet.validatedTasks).toBe(5);
    expect(levelFromXp(pet.counters.xp)).toBeGreaterThanOrEqual(3);
  });

  it("a non-qualifying close leaves the species alone", () => {
    // even trait profile: no branch reaches its 45% dominance bar
    const even = petWith({
      counters: { xp: 300, tasksCompleted: 4 } as PetState["counters"],
      traits: { research: 9, implementation: 9, validation: 9 },
      validatedTasks: 4,
    });
    let s = addPet(freshState(T0), even);
    s = reduceEvent(s, { type: "CODE_WRITE", ts: T0 + 100 });
    s = reduceEvent(s, { type: "TASK_COMPLETE", ts: T0 + 200 }); // 5th task, no branch dominant
    expect(s.pets[s.activePetId!].species).toBe("byte");
    expect(s.pets[s.activePetId!].evolutions).toEqual([]);
  });
});

describe("registry sanity", () => {
  it("every evolution target exists in the registry with art", () => {
    for (const rule of EVOLUTION_RULES) {
      const species = SPECIES[rule.to];
      expect(species, rule.to).toBeTruthy();
      expect(species.poses.idleA.length).toBe(16);
    }
  });
});

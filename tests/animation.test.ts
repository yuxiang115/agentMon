import { describe, expect, it } from "vitest";
import {
  HOLD,
  Roamer,
  STEP_PX,
  WALL_PAUSE,
  WALK_BEAT,
  idleHold,
  mulberry32,
  pickFrame,
} from "../packages/renderer/src/animation";

describe("pickFrame", () => {
  it("holds each pose `hold` ticks, then loops", () => {
    const f = ["a", "b"] as const;
    expect(pickFrame(f, 0)).toBe("a");
    expect(pickFrame(f, 2)).toBe("a");
    expect(pickFrame(f, 3)).toBe("b");
    expect(pickFrame(f, 5)).toBe("b");
    expect(pickFrame(f, 6)).toBe("a");
  });

  it("single-frame loops never index out of range", () => {
    expect(pickFrame(["x"] as const, 12345)).toBe("x");
  });

  it("sleep uses its own slower hold", () => {
    expect(pickFrame(["a", "b"] as const, 9, 10)).toBe("a");
    expect(pickFrame(["a", "b"] as const, 10, 10)).toBe("b");
    expect(pickFrame(["a", "b"] as const, 20, 10)).toBe("a");
  });
});

describe("idleHold (tuipet cadence)", () => {
  it("5 restless / 6 normal / 7 calm", () => {
    expect(idleHold(1)).toBe(5);
    expect(idleHold(0)).toBe(6);
    expect(idleHold(-1)).toBe(7);
  });
});

describe("Roamer", () => {
  it("same seed -> identical trajectory (deterministic tests)", () => {
    const run = () => {
      const r = new Roamer(8, 32, 16, mulberry32(42));
      const trace: number[] = [];
      for (let i = 0; i < 300; i++) {
        r.step(0, 16);
        if (r.stepped) trace.push(r.x);
      }
      return trace;
    };
    expect(run()).toEqual(run());
    expect(run().length).toBeGreaterThan(0);
  });

  it("moves at most STEP_PX per movement beat and stays inside bounds", () => {
    const r = new Roamer(8, 32, 16, mulberry32(7));
    let lastX = 8;
    let fullSteps = 0;
    for (let i = 0; i < 2000; i++) {
      r.step(0, 16);
      if (r.stepped) {
        // exactly STEP_PX on free beats; a wall beat clamps to the bound, so
        // the step may be shorter — never longer
        expect(Math.abs(r.x - lastX)).toBeLessThanOrEqual(STEP_PX);
        if (Math.abs(r.x - lastX) === STEP_PX) fullSteps++;
        lastX = r.x;
      }
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x).toBeLessThanOrEqual(16);
    }
    expect(fullSteps).toBeGreaterThan(10);
  });

  it("pauses WALL_PAUSE beats at a wall, then departs the other way", () => {
    const neverTurn = () => 0.9; // above TURN_CHANCE, always pose 1
    const r = new Roamer(16, 32, 16, neverTurn, 1); // starts AT the right wall
    const beats = (n: number) => {
      for (let i = 0; i < n * WALK_BEAT; i++) r.step(0, 16);
    };
    beats(1); // steps into the wall -> stopped
    expect(r.pause).toBe(WALL_PAUSE);
    beats(WALL_PAUSE); // turn-pose beats elapse -> departure
    expect(r.pause).toBe(0);
    expect(r.face).toBe(-1);
    expect(r.x).toBe(16 - STEP_PX);
  });

  it("flags stepped only on movement beats (WALK_BEAT cadence)", () => {
    const r = new Roamer(8, 32, 16, mulberry32(1));
    const stepped: boolean[] = [];
    for (let i = 0; i < WALK_BEAT * 3; i++) {
      r.step(0, 16);
      stepped.push(r.stepped);
    }
    expect(stepped.filter(Boolean)).toHaveLength(3);
    for (let i = 1; i < stepped.length; i++) if (stepped[i]) expect(i % WALK_BEAT).toBe(4);
  });
});

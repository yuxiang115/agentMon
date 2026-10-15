import { describe, expect, it, vi } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { activePet, addPet, createPet, evolutionTarget, freshState, reduceEvent } from "../packages/core";
import type { EventType } from "../packages/events/types";
import { PetOverlay } from "../packages/pi-extension/widget";
import { evolutionLines, footerGoal } from "../packages/pi-extension/growth";
import { PiAdapter } from "../packages/adapters/pi/map";

function game() {
  return addPet(freshState(0), createPet({ name: "黑球兽", species: "botamon", now: 0 }));
}
function run(state: ReturnType<typeof game>, ...types: EventType[]) {
  return types.reduce((s, type, i) => reduceEvent(s, { type, ts: s.savedAt + i + 1 }), state);
}

describe("coding Digivice journey", () => {
  it("earns the Koromon evolution through real task events, then keeps leveling", () => {
    let s = game();
    for (let i = 0; i < 4; i++) s = run(s, "CODE_WRITE", "TEST_START", "TEST_PASS", "TASK_COMPLETE");
    expect(activePet(s)?.species).toBe("botamon"); // 92 XP
    s = run(s, "CODE_WRITE", "TEST_START", "TEST_PASS", "TASK_COMPLETE");
    expect(activePet(s)?.species).toBe("koromon"); // 115 XP
    for (let i = 0; i < 9; i++) s = run(s, "CODE_WRITE", "TEST_START", "TEST_PASS", "TASK_COMPLETE");
    const pet = activePet(s)!;
    expect(pet.species).toBe("koromon"); // 322 XP — the built-in route's end
    expect(pet.evolutions.map((e) => e.to)).toEqual(["koromon"]);
    expect(pet.rewards).toHaveLength(20);
    expect(evolutionLines(pet)[0]).toContain("complete");
  });

  it("Koromon is the route's end, and removed-species saves settle back into it", () => {
    const pet = activePet(game())!;
    pet.species = "koromon";
    pet.counters.xp = 1000;
    pet.counters.tasksCompleted = 20;
    pet.validatedTasks = 20;
    expect(evolutionTarget(pet)).toBeNull(); // nothing beyond Koromon
    // a pre-removal save that reached Agumon migrates on first contact
    const base = game();
    const legacy = activePet(base)!;
    legacy.species = "agumon";
    legacy.counters.xp = 500;
    const migrated = reduceEvent(base, { type: "READ", ts: 1 });
    const back = activePet(migrated)!;
    expect(back.species).toBe("koromon");
    expect(back.counters.xp).toBe(500); // XP, level and history survive
  });

  it("does not count or reward repeated settlement or late THINK_END", () => {
    const s = run(game(), "READ", "TASK_COMPLETE");
    const again = run(s, "TASK_COMPLETE", "THINK_END", "TASK_COMPLETE");
    expect(activePet(again)?.counters.tasksCompleted).toBe(1);
    expect(activePet(again)?.counters.xp).toBe(10);
    expect(activePet(again)?.rewards).toHaveLength(1);
  });

  it("does not award validation or first-pass bonuses for edits after a pass", () => {
    const pet = activePet(run(game(), "CODE_WRITE", "TEST_PASS", "CODE_WRITE", "TASK_COMPLETE"))!;
    expect(pet.counters.xp).toBe(13);
    expect(pet.validatedTasks).toBe(0);
    expect(pet.rewards?.at(-1)).toMatchObject({ source: "task", xp: 10, validated: false });
  });

  it("invalidates an earlier pass when the final validation fails", () => {
    const pet = activePet(run(game(), "CODE_WRITE", "TEST_PASS", "TEST_FAIL", "TASK_COMPLETE"))!;
    expect(pet.counters.xp).toBe(13);
    expect(pet.validatedTasks).toBe(0);
  });

  it("closes aborted tasks with no completion reward or later farming", () => {
    const a = new PiAdapter();
    let s = run(game(), "CODE_WRITE");
    s = a.onAgentSettled(5, {}, true).reduce(reduceEvent, s);
    s = run(s, "TASK_COMPLETE");
    expect(activePet(s)?.task).toBeNull();
    expect(activePet(s)?.counters).toMatchObject({ tasksCompleted: 0, tasksFailed: 1, xp: 0 });
  });

  it("drops pending shell results at a session boundary", () => {
    const a = new PiAdapter();
    a.onToolCall({ toolCallId: "old", toolName: "bash", input: { command: "npm test" } }, 0, {});
    a.onSessionStart(1, {});
    expect(a.onToolResult({ toolCallId: "old", toolName: "bash", isError: false }, 2, {})).toEqual([]);
  });
});

describe("device feedback", () => {
  it("keeps the device compact — journey numbers live in the footer, not the panel", () => {
    vi.useFakeTimers();
    let state = game();
    const overlay = new PetOverlay({ requestRender() {}, showOverlay: vi.fn() }, () => state, 100, () => 0.5, 16, "half");
    try {
      expect(footerGoal(activePet(state)!)).toBe("Koromon · Lv.1/2");
      state = run(state, "CODE_WRITE");
      const panel = overlay.render(36).join("\n");
      expect(panel).not.toContain("Next:");
      expect(panel).not.toContain("Status:");
      expect(panel).not.toContain("Quest");
      expect(panel).not.toContain("XP [");
      state = run(state, "TEST_PASS", "TASK_COMPLETE");
      overlay.startReward("+23 XP · LEVEL UP 2!");
      expect(overlay.render(36).join("\n")).toContain("LEVEL UP 2");
      overlay.startEvolve("botamon");
      expect(overlay.render(36).join("\n")).toContain("CHARGE");
      vi.advanceTimersByTime(1200);
      expect(overlay.render(36).join("\n")).toContain("BURST");
      vi.advanceTimersByTime(400);
      expect(overlay.render(36).join("\n")).toContain("REVEAL");
      vi.advanceTimersByTime(800);
      expect(overlay.render(36).join("\n")).not.toContain("evolving");
    } finally { overlay.dispose(); vi.useRealTimers(); }
  });

  it("repaints only when the visible frame can change (a sleeping pet rests)", () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const state = run(game(), "SESSION_END"); // the pet dozes off
    const overlay = new PetOverlay({ requestRender, showOverlay: vi.fn() }, () => state, 100, () => 0.5);
    try {
      vi.advanceTimersByTime(6000); // 60 ticks
      const calls = requestRender.mock.calls.length;
      expect(calls).toBeGreaterThan(0); // it still animates (pose + zzz rise)
      expect(calls).toBeLessThan(30); // ...but nowhere near the ungated 60
    } finally { overlay.dispose(); vi.useRealTimers(); }
  });

  it("renders the default quadrant LCD at half the half-block width", () => {
    const state = game();
    const overlay = new PetOverlay({ requestRender() {}, showOverlay: vi.fn() }, () => state, 100000, () => 0.5);
    try {
      const quad = overlay.render(60).map((l) => l.replace(/\u001b\[[0-9;]*m/g, ""));
      expect(visibleWidth(quad[0]!)).toBe(20); // ceil((16 sprite + 16 roam) / 2) + 4 chrome
      expect(quad.join("\n")).toMatch(/[▘▝▖▗▚▞▌▐▙▛▜▟█▄▀]/); // quadrant glyphs on the LCD
    } finally { overlay.dispose(); }
  });

  it("fits narrow terminals and Chinese names by display columns", () => {
    const state = game();
    const overlay = new PetOverlay({ requestRender() {}, showOverlay: vi.fn() }, () => state, 100000, () => 0.5);
    try {
      for (const width of [0, 3, 5, 10, 20, 36, 80]) {
        for (const line of overlay.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
      overlay.setHidden(true);
      overlay.startEvolve("botamon");
      expect(overlay.render(36)).toEqual([]);
    } finally { overlay.dispose(); }
  });
});

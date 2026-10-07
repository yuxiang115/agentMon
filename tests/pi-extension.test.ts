// The audit's C6 smoke test (docs/reference-audit.md §0.6): tamagotchi's
// agent reactivity was never wired up — so agentMon proves, with the REAL
// extension entry and a mock Pi, that events actually reach the pet on disk.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import agentmon from "../packages/pi-extension";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function readStateFile(d: string): string {
  return readFileSync(join(d, "state.json"), "utf8");
}

const T0 = 1_700_000_000_000;
const FOREVER_MS = 1_000_000_000; // frozen animation loop for tests

class MockPi {
  handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  commands = new Map<string, { description: string; handler: (args: string, ctx: unknown) => Promise<void> }>();
  on(event: string, handler: (event: never, ctx: never) => unknown): () => void {
    this.handlers.set(event, handler as (event: unknown, ctx: unknown) => unknown);
    return () => this.handlers.delete(event);
  }
  registerCommand(name: string, opts: { description: string; handler: (args: string, ctx: unknown) => Promise<void> }) {
    this.commands.set(name, opts);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockCtx(overrides: Record<string, unknown> = {}): any {
  return {
    mode: "tui",
    hasUI: true,
    cwd: "/repo",
    sessionManager: { getSessionFile: () => "/sessions/s1.jsonl" },
    ui: {
      setWidget: vi.fn(),
      notify: vi.fn(),
      custom: vi.fn(),
    },
    ...overrides,
  };
}

let dir: string;
let clock = T0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentmon-ext-"));
  clock = T0;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function boot(): MockPi {
  const pi = new MockPi();
  agentmon(pi as unknown as ExtensionAPI, { stateDir: dir, now: () => clock, tickMs: FOREVER_MS });
  return pi;
}

const fire = (pi: MockPi, event: string, payload: unknown, ctx = mockCtx()) =>
  pi.handlers.get(event)!(payload, ctx);

describe("agentMon extension entry (C6: events really reach the pet)", () => {
  it("session_start creates the first pet, records the session, installs the widget", () => {
    const pi = boot();
    fire(pi, "session_start", { reason: "startup" });
    const state = JSON.parse(readStateFile(dir));
    expect(state.pets).toBeTruthy();
    expect(Object.keys(state.pets)).toHaveLength(1);
    expect(state.pets[state.activePetId].counters.sessions).toBe(1);
    const ui = mockCtx().ui;
    expect(ui.setWidget).not.toHaveBeenCalled(); // sanity: fresh ctx each fire
  });

  it("a read -> vitest run -> green result flows into the pet on disk", () => {
    const pi = boot();
    fire(pi, "session_start", {});
    fire(pi, "tool_call", { type: "tool_call", toolCallId: "a", toolName: "read", input: { path: "x.ts" } });
    fire(pi, "tool_execution_end", { type: "tool_execution_end", toolCallId: "a", toolName: "read", isError: false });
    fire(pi, "tool_call", { type: "tool_call", toolCallId: "b", toolName: "bash", input: { command: "npx vitest run" } });
    fire(pi, "tool_execution_end", { type: "tool_execution_end", toolCallId: "b", toolName: "bash", isError: false });
    fire(pi, "agent_settled", {});

    const state = JSON.parse(readStateFile(dir));
    const pet = state.pets[state.activePetId];
    expect(pet.counters).toMatchObject({
      reads: 1,
      testsStarted: 1,
      testsPassed: 1,
      tasksCompleted: 1,
    });
    expect(pet.activity).toBe("happy"); // TEST_PASS emotion, TASK_COMPLETE renews it
  });

  it("a failing test shows up as TEST_FAIL and a sad pet", () => {
    const pi = boot();
    fire(pi, "session_start", {});
    fire(pi, "tool_call", { toolCallId: "x", toolName: "bash", input: { command: "pytest -q" } });
    fire(pi, "tool_execution_end", { toolCallId: "x", toolName: "bash", isError: true });
    const state = JSON.parse(readStateFile(dir));
    expect(state.pets[state.activePetId].counters.testsFailed).toBe(1);
    expect(state.pets[state.activePetId].activity).toBe("sad");
  });

  it("session_shutdown tucks the pet in (SESSION_END -> sleep)", () => {
    const pi = boot();
    fire(pi, "session_start", {});
    fire(pi, "session_shutdown", { reason: "quit" });
    const state = JSON.parse(readStateFile(dir));
    expect(state.pets[state.activePetId].activity).toBe("sleep");
    expect(state.pets[state.activePetId].counters.sessions).toBe(1);
  });

  it("/pet renders the full view and closes on q", async () => {
    const pi = boot();
    fire(pi, "session_start", {});
    const ctx = mockCtx();
    let screen: { render(w: number): string[]; handleInput(d: string): void; dispose(): void } | undefined;
    let closed = false;
    ctx.ui.custom = async (factory: (...args: never[]) => never) => {
      screen = factory(
        { requestRender: () => {} } as never,
        {} as never,
        {} as never,
        (() => {
          closed = true;
        }) as never,
      );
      return undefined;
    };
    await pi.commands.get("pet")!.handler("", ctx);
    expect(screen).toBeTruthy();
    const lines = screen!.render(80);
    expect(lines.length).toBeGreaterThan(8);
    expect(lines.join("\n")).toContain("Byte");
    screen!.handleInput("q");
    expect(closed).toBe(true);
    screen!.dispose(); // idempotent after done()
  });

  it("warns instead of crashing in non-TUI modes", async () => {
    const pi = boot();
    fire(pi, "session_start", {});
    const ctx = mockCtx({ mode: "rpc", hasUI: false });
    await pi.commands.get("pet")!.handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("TUI"), "warning");
  });

  it("state survives across extension restarts (reload)", () => {
    const pi1 = boot();
    fire(pi1, "session_start", {});
    fire(pi1, "tool_call", { toolCallId: "r", toolName: "read", input: {} });
    fire(pi1, "tool_execution_end", { toolCallId: "r", toolName: "read", isError: false });

    const pi2 = boot(); // fresh extension instance, same stateDir
    fire(pi2, "session_start", {});
    const state = JSON.parse(readStateFile(dir));
    expect(Object.keys(state.pets)).toHaveLength(1); // still ONE Byte, not a second
    expect(state.pets[state.activePetId].counters.reads).toBe(1);
  });
});



// The audit's C6 smoke test (docs/reference-audit.md §0.6): tamagotchi's
// agent reactivity was never wired up — so agentMon proves, with the REAL
// extension entry and a mock Pi, that events actually reach the pet on disk.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import agentmon from "../packages/pi-extension";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PNG } from "pngjs";
import { PetOverlay } from "../packages/pi-extension/widget";
import { addPet, createPet } from "../packages/core/pet";
import { PetStore } from "../packages/storage/store";

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
      setStatus: vi.fn(),
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

  it("installs a non-capturing top-right overlay through the bridge widget", () => {
    const pi = boot();
    const ctx = mockCtx();
    fire(pi, "session_start", {}, ctx);
    expect(ctx.ui.setWidget).toHaveBeenCalledTimes(1);
    const [key, factory] = ctx.ui.setWidget.mock.calls[0] as [string, (tui: unknown, theme: unknown) => unknown];
    expect(key).toBe("agentmon-bridge");

    const overlayHandle = { hide: vi.fn(), setHidden: vi.fn(), isHidden: () => false };
    const showOverlay = vi.fn((..._args: unknown[]) => overlayHandle);
    const bridge = (factory as (tui: unknown, theme: unknown) => { render(w: number): string[] })(
      { requestRender: () => {}, showOverlay },
      {},
    );
    expect(showOverlay).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ nonCapturing: true, anchor: "top-right", width: 36 }),
    );
    expect(bridge.render(80)).toEqual([]); // the bridge renders nothing

    const overlay = showOverlay.mock.calls[0]?.[0] as unknown as {
      render(w: number): string[];
      setSize(n: number): void;
      dispose(): void;
    };
    const lines = overlay.render(36);
    expect(lines).toHaveLength(10); // border + 8 LCD rows + border
    expect(lines[0]).toMatch(/^┌/);
    expect(lines[0]).toContain("Byte");
    expect(lines[9]).toMatch(/┘$/);
    overlay.dispose();
  });

  it("/pet size resizes the sprite (16-60), persists, and re-anchors the overlay", async () => {
    const pi = boot();
    const ctx = mockCtx();
    fire(pi, "session_start", {}, ctx);
    const [, factory] = ctx.ui.setWidget.mock.calls[0] as [string, (tui: unknown, theme: unknown) => unknown];
    const overlayHandle = { hide: vi.fn(), setHidden: vi.fn(), isHidden: () => false };
    const showOverlay = vi.fn((..._args: unknown[]) => overlayHandle);
    (factory as (tui: unknown, theme: unknown) => unknown)({ requestRender: () => {}, showOverlay }, {});

    await pi.commands.get("pet")!.handler("size 48", ctx);
    expect(showOverlay).toHaveBeenCalledTimes(2); // re-anchored at the new width
    expect(showOverlay.mock.calls[1]?.[1]).toMatchObject({ width: 48 + 16 + 4 });
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("48"), "info");
    expect(JSON.parse(readStateFile(dir)).ui).toEqual({ petSize: 48 });

    // the panel itself renders 48px of sprite = 24 terminal rows + borders
    const overlay = showOverlay.mock.calls[0]?.[0] as unknown as { render(w: number): string[] };
    const lines = overlay.render(100);
    expect(lines).toHaveLength(24 + 2);
    expect(lines[0]!.length).toBe(68); // 48 sprite + 16 roam + 4 chrome (no ANSI in the title)

    // out-of-range clamps instead of erroring
    await pi.commands.get("pet")!.handler("size 500", ctx);
    expect(JSON.parse(readStateFile(dir)).ui).toEqual({ petSize: 60 });
    await pi.commands.get("pet")!.handler("size abc", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("16-60"), "warning");
  });

  it("the footer status follows events", () => {
    const pi = boot();
    const ctx = mockCtx();
    fire(pi, "session_start", {}, ctx);
    fire(pi, "tool_call", { toolCallId: "a", toolName: "read", input: {} }, ctx);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agentmon", expect.stringMatching(/Byte Lv\.1 · search/));
  });

  it("/pet ui toggles the overlay, /pet rename renames the pet", async () => {
    const pi = boot();
    const ctx = mockCtx();
    fire(pi, "session_start", {}, ctx);
    const [, factory] = ctx.ui.setWidget.mock.calls[0] as [
      string,
      (tui: unknown, theme: unknown) => unknown,
    ];
    const overlayHandle = { hide: vi.fn(), setHidden: vi.fn(), isHidden: () => false };
    (factory as (tui: unknown, theme: unknown) => unknown)(
      { requestRender: () => {}, showOverlay: () => overlayHandle },
      {},
    );

    await pi.commands.get("pet")!.handler("ui", ctx);
    expect(overlayHandle.setHidden).toHaveBeenCalledWith(true);
    await pi.commands.get("pet")!.handler("rename Byte Jr", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Byte Jr"), "info");
    const state = JSON.parse(readStateFile(dir));
    expect(state.pets[state.activePetId].name).toBe("Byte Jr");
  });

  it("thinking links to the agent lifecycle: agent_start thinks, agent_end rests", () => {
    const pi = boot();
    fire(pi, "session_start", {});
    fire(pi, "agent_start", {});
    expect(JSON.parse(readStateFile(dir)).pets[JSON.parse(readStateFile(dir)).activePetId].activity).toBe("think");
    fire(pi, "tool_call", { toolCallId: "a", toolName: "read", input: {} });
    expect(JSON.parse(readStateFile(dir)).pets[JSON.parse(readStateFile(dir)).activePetId].activity).toBe("search");
    fire(pi, "agent_end", {});
    expect(JSON.parse(readStateFile(dir)).pets[JSON.parse(readStateFile(dir)).activePetId].activity).toBe("idle");
  });

  it("/pets debug shows the event trace", async () => {
    const pi = boot();
    fire(pi, "session_start", {});
    fire(pi, "agent_start", {});
    fire(pi, "tool_call", { toolCallId: "a", toolName: "bash", input: { command: "npm test" } });

    const ctx = mockCtx();
    let screen: { render(w: number): string[] } | undefined;
    ctx.ui.custom = async (factory: (...args: never[]) => never) => {
      screen = factory({ requestRender: () => {} } as never, {} as never, {} as never, (() => {}) as never);
      return undefined;
    };
    await pi.commands.get("pet")!.handler("debug", ctx);
    expect(screen).toBeTruthy();
    const text = screen!.render(100).join("\n");
    expect(text).toContain("agent_start");
    expect(text).toContain("tool_call:bash");
    expect(text).toContain("TEST_START");
    expect(text).toContain("Byte");
  });

  it("/pet import of an image folder installs, converts, and ACTIVATES the species", async () => {
    const pi = boot();
    const ctx = mockCtx();
    fire(pi, "session_start", {}, ctx);

    // a tiny pose folder (idle only) -> colour pipeline -> installed + active
    const imgDir = join(dir, "imgs");
    mkdirSync(imgDir);
    const png = new PNG({ width: 32, height: 32 });
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const i = (32 * y + x) << 2;
        const inside = x >= 8 && x < 24 && y >= 8 && y < 24;
        png.data[i] = png.data[i + 1] = png.data[i + 2] = inside ? 200 : 255;
        png.data[i + 3] = 255;
      }
    }
    writeFileSync(join(imgDir, "idle1.png"), PNG.sync.write(png));

    await pi.commands.get("pet")!.handler(`import ${imgDir} Instant`, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("activated"), "info");
    const state = JSON.parse(readStateFile(dir));
    expect(state.pets[state.activePetId].species).toBe("instant");
    expect(state.pets[state.activePetId].activity).toBe("happy");
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



describe("growth notices + evolution fx", () => {
  const CYCLE = (pi: MockPi, ctx: unknown = mockCtx()) => {
    fire(pi, "tool_call", { toolCallId: "r", toolName: "read", input: {} });
    fire(pi, "tool_execution_end", { toolCallId: "r", toolName: "read", isError: false });
    fire(pi, "tool_call", { toolCallId: "t", toolName: "bash", input: { command: "npx vitest run" } });
    fire(pi, "tool_execution_end", { toolCallId: "t", toolName: "bash", isError: false });
    fire(pi, "agent_settled", {});
  };

  it("a level-up surfaces as a toast", async () => {
    const pi = boot();
    const ctx = mockCtx();
    fire(pi, "session_start", {}, ctx);
    for (let i = 0; i < 6; i++) CYCLE(pi, ctx); // ~20 xp/cycle -> past the 100 for Lv.2
    await pi.commands.get("pet")!.handler("list", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringMatching(/Byte leveled up — Lv\.2/),
      "info",
    );
  });

  it("evolving fires a toast and plays the overlay transform", async () => {
    const dir2 = mkdtempSync(join(tmpdir(), "agentmon-evo-"));
    try {
      // a pack chaining byte -> testmon with gentle gates
      const packsDir = join(dir2, "pets");
      mkdirSync(join(packsDir, "tm-pack"), { recursive: true });
      writeFileSync(
        join(packsDir, "tm-pack", "pack.json"),
        JSON.stringify({
          name: "Testmon pack",
          species: [
            {
              id: "testmon",
              name: "Testmon",
              stage: "branch",
              palette: { a: "#00aa00" },
              poses: { idle1: Array.from({ length: 16 }, (_, y) => (y === 8 ? "a".repeat(16) : ".".repeat(16))) },
              roles: { idle: ["idle1"] },
            },
          ],
          evolutions: [
            { from: "byte", to: "testmon", gates: { minLevel: 2, axis: "research", minTraitShare: 0.2, minTasks: 3, maxCareMistakes: 3 } },
          ],
        }),
        "utf8",
      );
      const pi = new MockPi();
      agentmon(pi as unknown as ExtensionAPI, { stateDir: dir2, packsDir, now: () => clock, tickMs: FOREVER_MS });
      const ctx = mockCtx();
      fire(pi, "session_start", {}, ctx);
      // install the bridge so startEvolve has an overlay to drive
      const [, factory] = ctx.ui.setWidget.mock.calls[0] as [string, (tui: unknown, theme: unknown) => unknown];
      const requestRender = vi.fn();
      (factory as (tui: unknown, theme: unknown) => unknown)(
        { requestRender, showOverlay: () => ({ hide: vi.fn(), setHidden: vi.fn(), isHidden: () => false }) },
        {},
      );
      for (let i = 0; i < 6; i++) CYCLE(pi, ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringMatching(/evolved into Testmon/), "info");
      const state = JSON.parse(readFileSync(join(dir2, "state.json"), "utf8"));
      expect(state.pets[state.activePetId].species).toBe("testmon");

      // the overlay plays the fx: mid-charge it renders washed-out old-form pixels
      const store = new PetStore(join(dir2, "state.json"));
      const overlay = new PetOverlay(
        { requestRender: () => {}, showOverlay: () => ({ hide: () => {}, setHidden: () => {}, isHidden: () => false }) } as never,
        () => store.read(clock),
        100,
        () => 0.5,
      );
      overlay.startEvolve("byte");
      const charged = (overlay as unknown as { tick(min: number, max: number): void }).tick;
      void charged;
      const lines = overlay.render(60);
      const text = lines.join(String.fromCharCode(10));
      expect(text).toContain("evolving");
      // coloured pixels in whichever mode the entry detected for this terminal
      const E = String.fromCharCode(27);
      expect(text.includes(E + "[38;2;") || text.includes(E + "[38;5;")).toBe(true);
      overlay.dispose();
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("a hidden panel stops rendering and ticking", () => {
    const store = new PetStore(join(dir, "state.json"));
    store.update((s) => addPet(s, createPet({ name: "Byte", now: clock })), clock);
    const requestRender = vi.fn();
    const overlay = new PetOverlay(
      { requestRender, showOverlay: () => ({ hide: () => {}, setHidden: () => {}, isHidden: () => false }) } as never,
      () => store.read(clock),
      FOREVER_MS,
      () => 0.5,
    );
    const tickOnce = () => (overlay as unknown as { tick(min: number, max: number): void }).tick(0, 16);
    overlay.setHidden(true);
    requestRender.mockClear();
    tickOnce();
    expect(requestRender).not.toHaveBeenCalled(); // paused, no idle burn
    expect(overlay.render(60)).toEqual([]); // hidden renders nothing
    overlay.setHidden(false);
    tickOnce();
    expect(requestRender).toHaveBeenCalled();
    expect(overlay.render(60).length).toBeGreaterThan(0);
    overlay.dispose();
  });
});

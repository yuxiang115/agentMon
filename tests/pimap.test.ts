import { describe, expect, it } from "vitest";
import { classifyCommand, PiAdapter } from "../packages/adapters/pi/map";
import { activePet, addPet, createPet, freshState, reduceEvent, tick } from "../packages/core";

const T0 = 1_700_000_000_000;
const CTX = { sessionId: "/sessions/s1.jsonl", project: "/repo" };

describe("classifyCommand", () => {
  it.each([
    ["npx vitest run", "test"],
    ["npm test", "test"],
    ["npm run test:unit", "test"],
    ["python -m pytest -x", "test"],
    ["cargo test --all", "test"],
    ["go test ./...", "test"],
    ["yarn vitest --watch=false", "test"],
    ["npm run build", "build"],
    ["npx tsc --noEmit", "build"],
    ["cargo build --release", "build"],
    ["make", "build"],
    ["git status", "command"],
    ["ls -la", "command"],
    ["rm -rf node_modules && npm install", "command"],
  ])("%s -> %s", (command, kind) => {
    expect(classifyCommand(command)).toBe(kind);
  });

  it("tests outrank builds when a command chain contains both", () => {
    expect(classifyCommand("npm run build && npm test")).toBe("test");
  });
});

describe("PiAdapter", () => {
  it("maps exploration tools", () => {
    const a = new PiAdapter();
    expect(a.onToolCall({ toolCallId: "1", toolName: "read", input: { path: "a.ts" } }, T0, CTX)).toMatchObject([
      { type: "READ", project: "/repo" },
    ]);
    expect(a.onToolCall({ toolCallId: "2", toolName: "grep", input: { pattern: "x" } }, T0, CTX)).toMatchObject([
      { type: "SEARCH" },
    ]);
  });

  it("maps writes to CODE_WRITE", () => {
    const a = new PiAdapter();
    const evs = a.onToolCall({ toolCallId: "3", toolName: "edit", input: { path: "a.ts" } }, T0, CTX);
    expect(evs).toMatchObject([{ type: "CODE_WRITE" }]);
  });

  it("pairs a test command with its result into TEST_PASS/TEST_FAIL", () => {
    const a = new PiAdapter();
    a.onToolCall({ toolCallId: "t1", toolName: "bash", input: { command: "npx vitest run" } }, T0, CTX);
    expect(a.onToolResult({ toolCallId: "t1", toolName: "bash", isError: false }, T0 + 500, CTX)).toMatchObject([
      { type: "TEST_PASS" },
    ]);

    const b = new PiAdapter();
    b.onToolCall({ toolCallId: "t2", toolName: "bash", input: { command: "pytest -q" } }, T0, CTX);
    expect(b.onToolResult({ toolCallId: "t2", toolName: "bash", isError: true }, T0 + 500, CTX)).toMatchObject([
      { type: "TEST_FAIL" },
    ]);
  });

  it("builds pair the same way; plain commands do not", () => {
    const a = new PiAdapter();
    a.onToolCall({ toolCallId: "b1", toolName: "bash", input: { command: "npm run build" } }, T0, CTX);
    expect(a.onToolResult({ toolCallId: "b1", toolName: "bash", isError: true }, T0, CTX)).toMatchObject([
      { type: "BUILD_FAIL" },
    ]);
    a.onToolCall({ toolCallId: "c1", toolName: "bash", input: { command: "git status" } }, T0, CTX);
    expect(a.onToolResult({ toolCallId: "c1", toolName: "bash", isError: false }, T0, CTX)).toEqual([]);
    // unknown id (e.g. result for a pre-load call) is ignored
    expect(a.onToolResult({ toolCallId: "nope", toolName: "bash", isError: true }, T0, CTX)).toEqual([]);
  });

  it("powershell counts as a shell tool too", () => {
    const a = new PiAdapter();
    const evs = a.onToolCall({ toolCallId: "p1", toolName: "powershell", input: { command: "go test ./..." } }, T0, CTX);
    expect(evs).toMatchObject([{ type: "TEST_START" }]);
  });

  it("feeds the real reducer end-to-end (activity follows the events)", () => {
    let state = addPet(freshState(T0), createPet({ name: "Byte", now: T0 }));
    const a = new PiAdapter();
    const fold = (evs: ReturnType<PiAdapter["onToolCall"]>) => {
      state = evs.reduce(reduceEvent, state);
    };
    fold(a.onSessionStart(T0, CTX));
    fold(a.onToolCall({ toolCallId: "1", toolName: "read", input: {} }, T0 + 100, CTX));
    expect(activePet(state)!.activity).toBe("search");
    fold(a.onToolCall({ toolCallId: "2", toolName: "bash", input: { command: "npx vitest run" } }, T0 + 200, CTX));
    fold(a.onToolResult({ toolCallId: "2", toolName: "bash", isError: false }, T0 + 900, CTX));
    state = tick(state, T0 + 5_000);
    expect(activePet(state)!.activity).toBe("idle"); // celebration played out
    expect(activePet(state)!.counters).toMatchObject({ testsStarted: 1, testsPassed: 1, reads: 1, sessions: 1 });
  });
});

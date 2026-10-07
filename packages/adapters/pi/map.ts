// Pi tool events -> agentMon's normalized CodingEvents (plan.md §12).
//
// Pure and Pi-free by design: the shapes below are the minimal structural
// subset of @earendil-works/pi-coding-agent's ToolCallEvent/ToolExecutionEnd
// that pi-extension/index.ts extracts, so this mapping is unit-testable
// without Pi, and the core never sees a Pi tool name (audit §3.1).

import type { CodingEvent, EventType } from "../../events/types";

export interface ToolCallShape {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolResultShape {
  toolCallId: string;
  toolName: string;
  isError: boolean;
}

export interface EventContext {
  sessionId?: string;
  project?: string;
}

/** Tools that read code. */
const READ_TOOLS = new Set(["read", "ls"]);
/** Tools that search code. */
const SEARCH_TOOLS = new Set(["grep", "find"]);
/** Tools that write code. */
const WRITE_TOOLS = new Set(["write", "edit"]);
/** Shell tools — classified by the command line. */
const SHELL_TOOLS = new Set(["bash", "powershell"]);

const TEST_PATTERNS: RegExp[] = [
  /\b(pytest|vitest|jest|mocha|rspec)\b/i,
  /\b(npm|yarn|pnpm|bun|deno)\s+(run\s+)?test/i,
  /\bcargo\s+test\b/i,
  /\bgo\s+test\b/i,
  /\bdotnet\s+test\b/i,
  /\bgradle\s+test\b/i,
  /\bmix\s+test\b/i,
  /\bmake\s+(test|check)\b/i,
  /\brun_tests?\b/i,
];

const BUILD_PATTERNS: RegExp[] = [
  /\b(npm|yarn|pnpm|bun|deno)\s+(run\s+)?build\b/i,
  /\b(next|vite|webpack|esbuild|rollup|turbo|nx|rspack)\s+build\b/i,
  /\bcargo\s+build\b/i,
  /\bgo\s+build\b/i,
  /\bdotnet\s+build\b/i,
  /\bgradle\s+build\b/i,
  /\bmix\s+compile\b/i,
  /(^|\s)make\b/i,
  /\btsc\b/i,
];

export type CommandKind = "test" | "build" | "command";

/** Classify a shell command line: tests outrank builds when both match. */
export function classifyCommand(command: string): CommandKind {
  if (TEST_PATTERNS.some((re) => re.test(command))) return "test";
  if (BUILD_PATTERNS.some((re) => re.test(command))) return "build";
  return "command";
}

function ev(type: EventType, ts: number, ctx: EventContext, detail?: string): CodingEvent {
  return { type, ts, sessionId: ctx.sessionId, project: ctx.project, detail };
}

/** Pending shell calls awaiting a PASS/FAIL result, by toolCallId. */
type PendingKind = "test" | "build";

/**
 * Stateful translator for one Pi session: turns tool calls/results and
 * lifecycle hooks into normalized events, pairing shell results with their
 * classified calls (TEST_START ... TEST_PASS/TEST_FAIL).
 */
export class PiAdapter {
  private pending = new Map<string, PendingKind>();

  onToolCall(call: ToolCallShape, ts: number, ctx: EventContext): CodingEvent[] {
    if (READ_TOOLS.has(call.toolName)) return [ev("READ", ts, ctx)];
    if (SEARCH_TOOLS.has(call.toolName)) return [ev("SEARCH", ts, ctx)];
    if (WRITE_TOOLS.has(call.toolName)) return [ev("CODE_WRITE", ts, ctx)];
    if (SHELL_TOOLS.has(call.toolName)) {
      const command = typeof call.input.command === "string" ? call.input.command : "";
      const kind = classifyCommand(command);
      if (kind !== "command") {
        if (this.pending.size > 512) this.pending.clear(); // defensive: leaked ids
        this.pending.set(call.toolCallId, kind);
        return [ev(kind === "test" ? "TEST_START" : "BUILD_START", ts, ctx, command)];
      }
      return [ev("COMMAND_RUN", ts, ctx, command)];
    }
    return []; // unknown/custom tools are not gameplay yet
  }

  onToolResult(result: ToolResultShape, ts: number, ctx: EventContext): CodingEvent[] {
    const kind = this.pending.get(result.toolCallId);
    if (!kind) return [];
    this.pending.delete(result.toolCallId);
    if (kind === "test") {
      return [ev(result.isError ? "TEST_FAIL" : "TEST_PASS", ts, ctx)];
    }
    return [ev(result.isError ? "BUILD_FAIL" : "BUILD_PASS", ts, ctx)];
  }

  onSessionStart(ts: number, ctx: EventContext): CodingEvent[] {
    return [ev("SESSION_START", ts, ctx)];
  }

  onSessionShutdown(ts: number, ctx: EventContext): CodingEvent[] {
    return [ev("SESSION_END", ts, ctx)];
  }

  /** The agent finished responding to the user's request. */
  onAgentSettled(ts: number, ctx: EventContext): CodingEvent[] {
    return [ev("TASK_COMPLETE", ts, ctx)];
  }
}

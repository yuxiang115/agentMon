// agentMon's normalized Code Agent Event Protocol (plan.md §12).
// The Pi adapter (Stage 3) translates raw Pi tool events into these; the core
// never sees a Pi tool name. ts is epoch milliseconds.

export const EVENT_TYPES = [
  "SESSION_START",
  "SESSION_END",
  "THINK_START",
  "THINK_END",
  "READ",
  "SEARCH",
  "CODE_WRITE",
  "COMMAND_RUN",
  "TEST_START",
  "TEST_PASS",
  "TEST_FAIL",
  "BUILD_START",
  "BUILD_PASS",
  "BUILD_FAIL",
  "TASK_COMPLETE",
  "TASK_FAILED",
  "USER_CORRECTION",
  "IDLE",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface CodingEvent {
  type: EventType;
  /** Epoch ms. The reducer is a pure function of (state, event) — the clock
   * arrives inside the event, never from Date.now(). */
  ts: number;
  sessionId?: string;
  /** Project working directory, when known (per-project pets arrive Stage 6). */
  project?: string;
  /** Free-form context, e.g. the bash command line behind a TEST_START. */
  detail?: string;
}

export function isEventType(s: string): s is EventType {
  return (EVENT_TYPES as readonly string[]).includes(s);
}

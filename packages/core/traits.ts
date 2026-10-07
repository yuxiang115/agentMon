// The Behavior Profile (plan.md §21): how the agent works -> traits.
//
// The rolling-window classifier is a PORT of tamagotchi's
// AgentBehaviorClassifier (src/tamagotchi/plugins/base.py — MIT, (c) 2026
// Yusik Kim), retargeted from raw tool names to agentMon's normalized events
// and extended with a VALIDATING mode. The tamagotchi lesson (audit §2.5) is
// the shape: a small bounded window of recent activity, cheap counters, and
// classification by thresholds — never a frozen read of stale meters.

import type { EventType } from "../events/types";

export type BehaviorKind = "read" | "write" | "validate" | "command" | "fail";

export type BehaviorMode =
  | "STEADY"
  | "EXPLORING"
  | "BUILDING"
  | "VALIDATING"
  | "LOOPING"
  | "BLOCKED";

/** Lifetime trait axes — they feed Stage 5's Scout/Builder/Guardian branches. */
export interface TraitScores {
  research: number;
  implementation: number;
  validation: number;
}

export const BEHAVIOR_WINDOW = 20;

const SAMPLES: Partial<Record<EventType, BehaviorKind>> = {
  READ: "read",
  SEARCH: "read",
  CODE_WRITE: "write",
  TEST_START: "validate",
  TEST_PASS: "validate",
  TEST_FAIL: "fail",
  BUILD_START: "validate",
  BUILD_PASS: "validate",
  BUILD_FAIL: "fail",
  COMMAND_RUN: "command",
};

export function sampleFor(type: EventType): BehaviorKind | null {
  return SAMPLES[type] ?? null;
}

const TRAIT_DELTAS: Partial<Record<EventType, Partial<TraitScores>>> = {
  READ: { research: 1 },
  SEARCH: { research: 1 },
  CODE_WRITE: { implementation: 1 },
  TEST_PASS: { validation: 2 },
  TEST_FAIL: { validation: 1 }, // validating and catching it still counts
  BUILD_PASS: { validation: 1 },
  BUILD_FAIL: { validation: 1 },
};

export function traitDelta(type: EventType): Partial<TraitScores> | null {
  return TRAIT_DELTAS[type] ?? null;
}

/**
 * Classify the current window. Precedence (tamagotchi's, plus VALIDATING):
 * BLOCKED (repeated failures) > LOOPING (a long same-kind run at the tail) >
 * EXPLORING (all reads, no writes) > VALIDATING (validation-heavy) >
 * BUILDING (writes outpace reads) > STEADY.
 */
export function classifyBehavior(window: readonly BehaviorKind[]): BehaviorMode {
  if (window.length === 0) return "STEADY";
  const count = (k: BehaviorKind) => window.reduce((n, x) => (x === k ? n + 1 : n), 0);

  if (count("fail") >= 3) return "BLOCKED";

  let run = 1;
  for (let i = window.length - 2; i >= 0 && window[i] === window[window.length - 1]; i--) run++;
  if (run >= 6) return "LOOPING";

  const reads = count("read");
  const writes = count("write");
  const validates = count("validate");
  if (reads >= 8 && writes === 0) return "EXPLORING";
  if (validates >= 6) return "VALIDATING";
  if (writes > reads) return "BUILDING";
  return "STEADY";
}

// Scripted coding session — a Stage 2 vertical slice without Pi (Stage 3 adds
// the real adapter): replay one normalized session through the core reducer
// and watch Byte's activity follow the agent's work, then render snapshots.
//
//   npm run session [-- --plain]

import { addPet, createPet, freshState, reduceEvent, tick } from "../packages/core";
import type { CodingEvent, EventType } from "../packages/events/types";
import { BYTE } from "../pets/sprites/byte";
import { renderScreen } from "../packages/renderer/src/framebuffer";
import { pickFrame, HOLD, SLEEP_BEAT } from "../packages/renderer/src/animation";
import { COLS, CHAR_ROWS } from "../packages/renderer/src/lcd";
import { stripAnsi } from "../packages/renderer/src/halfblock";

const plain = process.argv.includes("--plain");
const paint = plain ? { plain: true } : {};
const T0 = 1_700_000_000_000;

const script: Array<{ label: string; type: EventType; afterMs: number }> = [
  { label: "session opens", type: "SESSION_START", afterMs: 0 },
  { label: "agent reads source", type: "READ", afterMs: 400 },
  { label: "agent greps the codebase", type: "SEARCH", afterMs: 900 },
  { label: "agent thinks", type: "THINK_START", afterMs: 600 },
  { label: "agent edits", type: "CODE_WRITE", afterMs: 1_200 },
  { label: "agent edits again", type: "CODE_WRITE", afterMs: 800 },
  { label: "agent runs vitest", type: "TEST_START", afterMs: 700 },
  { label: "a test fails", type: "TEST_FAIL", afterMs: 3_000 },
  { label: "agent fixes it, reruns", type: "TEST_PASS", afterMs: 8_000 },
  { label: "task complete", type: "TASK_COMPLETE", afterMs: 1_500 },
  { label: "session ends", type: "SESSION_END", afterMs: 4_000 },
];

let state = addPet(freshState(T0), createPet({ name: "Byte", now: T0 }));
let t = T0;
const snapshots: Array<{ label: string; activity: string; ts: number }> = [];

console.log(`agentMon Stage 2 — scripted session (Byte, species=${"byte"})`);
console.log("time      event            -> pet activity   (priority rule applied)");
console.log("---------------------------------------------------------------");

for (const step of script) {
  t += step.afterMs;
  const event: CodingEvent = { type: step.type, ts: t, sessionId: "demo", project: "/repo" };
  state = reduceEvent(state, event);
  const pet = state.pets[state.activePetId!];
  console.log(
    `+${((t - T0) / 1000).toFixed(1)}s`.padEnd(9),
    step.type.padEnd(16),
    "->",
    pet.activity.padEnd(8),
    ` ${step.label}`,
  );
  if (step.type === "TEST_PASS" || step.type === "SESSION_END") {
    snapshots.push({ label: step.type === "TEST_PASS" ? "celebrates (TEST_PASS)" : "naps (SESSION_END)", activity: pet.activity, ts: t });
  }
}

state = tick(state, t + 1_000);
const pet = state.pets[state.activePetId!];
const c = pet.counters;
console.log("\nlifetime tallies after one session:");
console.log(
 `  reads=${c.reads} searches=${c.searches} thinks=${c.thinks} writes=${c.writes}` +
 ` commands=${c.commands} tests=${c.testsStarted} (${c.testsPassed}pass/${c.testsFailed}fail)` +
 ` tasks=${c.tasksCompleted}  xp=${c.xp} (Stage 4 awards it)`,
);
console.log(`  age=${(pet.ageMs / 1000).toFixed(0)}s`);

function lcd(activity: string, ts: number): string[] {
  const poses = (BYTE.roles[activity] ?? BYTE.roles.idle).map((p) => BYTE.poses[p]);
  const hold = activity === "sleep" ? SLEEP_BEAT : HOLD;
  const frame = pickFrame(poses, Math.floor(ts / 100), hold);
  const lines = renderScreen(frame, COLS, CHAR_ROWS, paint);
  return plain ? lines : lines;
}

console.log();
let first = true;
for (const snap of snapshots) {
  if (!first) console.log();
  first = false;
  console.log(`${snap.label}:`);
  for (const line of lcd(snap.activity, snap.ts)) console.log(plain ? line : line);
}
console.log();
console.log("(Stage 3 replaces this script with live Pi events.)");

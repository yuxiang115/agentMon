// Coding care mistakes (plan.md §21 "Care Quality"): agent mistakes the pet
// pays for. tuipet's discipline (audit §2.2) is the model — a small fixed set
// of canonical charges, applied at well-defined moments with no farming
// vector (mistakes only ever cost). The V-Pet "left hungry too long" window
// becomes "a failure was never resolved before the task closed".

import type { TaskWindow } from "./pet";

export const CARE_MISTAKES = [
  "failed-at-close",
  "unvalidated-close",
  "user-correction",
] as const;

export type CareMistake = (typeof CARE_MISTAKES)[number];

/**
 * Charges applied when a task completes:
 *  - failed-at-close:   a test/build failed and nothing passed after it
 *  - unvalidated-close: code was written but validation never ran at all
 *                       (a pass anywhere proves it did)
 * (user-correction is charged directly by the reducer when it happens.)
 */
export function mistakesAtTaskClose(task: TaskWindow): CareMistake[] {
  const out: CareMistake[] = [];
  if (task.unresolvedFail) out.push("failed-at-close");
  if (task.writes > 0 && task.validations === 0 && !task.validated) {
    out.push("unvalidated-close");
  }
  return out;
}

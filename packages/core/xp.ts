// The Coding Outcome Engine (plan.md §15) — agentMon's ORIGINAL progression
// rules. AgentPet's token-based XP is deliberately NOT copied (audit §2.1.10:
// rewarding tokens rewards inefficiency). XP here rewards outcomes:
//
//  - a TEST_PASS/BUILD_PASS pays only when fresh code was written since the
//    last rewarded pass (the "dirty gate") — re-running `npm test` in a loop
//    farms nothing (plan §15's dedup requirement);
//  - TASK_COMPLETE pays base + a validated bonus (the task actually ran and
//    passed validation) + a first-pass bonus (no failures/corrections).

export const XP_AWARDS = {
  TEST_PASS: 3,
  BUILD_PASS: 2,
  TASK_COMPLETE: 10,
  VALIDATED_TASK_BONUS: 5,
  FIRST_PASS_BONUS: 5,
} as const;

/** Cumulative XP required to REACH a level (level 1 costs 0, 2 costs 100, 3 costs 300...). */
export function xpToReach(level: number): number {
  return 50 * level * (level - 1);
}

export function levelFromXp(xp: number): number {
  let level = 1;
  while (xpToReach(level + 1) <= xp) level++;
  return level;
}

/** Where the pet stands inside its current level, for progress bars. */
export function xpProgress(xp: number): { level: number; into: number; span: number } {
  const level = levelFromXp(xp);
  const base = xpToReach(level);
  const next = xpToReach(level + 1);
  return { level, into: xp - base, span: next - base };
}

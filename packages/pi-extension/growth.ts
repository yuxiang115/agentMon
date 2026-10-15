// Shared presentation data for the compact device and the full journal.
import { allEvolutionRules, levelFromXp, traitShares, xpProgress, type PetState } from "../core";
import { speciesFor } from "../../pets/registry";

export function progressBar(value: number, total: number, cells = 10): string {
  const filled = Math.round(Math.max(0, Math.min(1, total > 0 ? value / total : 0)) * cells);
  return "[" + "■".repeat(filled) + "·".repeat(cells - filled) + "]";
}

export function xpLine(pet: PetState, xp = pet.counters.xp): string {
  const p = xpProgress(Math.floor(xp));
  return `XP ${progressBar(p.into, p.span)} ${p.into}/${p.span}`;
}

export function evolutionLines(pet: PetState): string[] {
  const rules = allEvolutionRules().filter((r) => r.from === pet.species);
  if (!rules.length) return ["Current route complete!", "Keep training your partner."];
  const shares = traitShares(pet.traits);
  return rules.flatMap(({ to, gates: g }) => {
    const checks: Array<[string, boolean]> = [
      [`Lv.${levelFromXp(pet.counters.xp)}/${g.minLevel}`, levelFromXp(pet.counters.xp) >= g.minLevel],
      [`Tasks ${pet.counters.tasksCompleted}/${g.minTasks}`, pet.counters.tasksCompleted >= g.minTasks],
    ];
    if (g.minValidatedTasks) checks.push([`Validated ${pet.validatedTasks}/${g.minValidatedTasks}`, pet.validatedTasks >= g.minValidatedTasks]);
    if (g.minTraitShare > 0) checks.push([`${g.axis} ${Math.round(shares[g.axis] * 100)}/${Math.round(g.minTraitShare * 100)}%`, shares[g.axis] >= g.minTraitShare]);
    if (g.maxCareMistakes < Number.MAX_SAFE_INTEGER) checks.push([`Mistakes ${pet.careMistakes}/${g.maxCareMistakes} max`, pet.careMistakes <= g.maxCareMistakes]);
    if (g.minValidatedRatio) {
      const ratio = pet.counters.tasksCompleted ? pet.validatedTasks / pet.counters.tasksCompleted : 0;
      checks.push([`Validation ${Math.round(ratio * 100)}/${Math.round(g.minValidatedRatio * 100)}%`, ratio >= g.minValidatedRatio]);
    }
    return [`Next: ${speciesFor(to).name}`, ...checks.map(([label, met]) => `${met ? "✓" : "·"} ${label}`)];
  });
}

export function taskLine(pet: PetState): string {
  if (!pet.task) return "Ready for your next quest";
  if (pet.task.unresolvedFail) return "Quest: fix & retry";
  if (pet.task.validated) return "Quest: validated ✓";
  if (pet.dirty) return "Quest: code changed → validate";
  return "Quest: exploring / planning";
}

/**
 * The footer's one-line journey summary: next evolution target plus its
 * FIRST unmet gate ("Koromon · Lv.2", "Agumon · Tasks 5/8", "… · ready!").
 */
export function footerGoal(pet: PetState): string {
  const lines = evolutionLines(pet);
  if (!lines[0].startsWith("Next: ")) return lines[0]; // route complete
  const target = lines[0].slice(6);
  const unmet = lines.slice(1).find((line) => line.startsWith("·"));
  return unmet ? `${target} · ${unmet.slice(2)}` : `${target} · ready!`;
}

export function journalLines(pet: PetState): string[] {
  const rewards = (pet.rewards ?? []).slice(-4).reverse();
  return rewards.length ? rewards.map((r) =>
    `+${r.xp} XP · ${r.source}${r.source === "task" ? r.firstPass ? " · first pass" : r.validated ? " · validated" : " · complete" : " · passed"}`,
  ) : ["No rewards yet — complete a task to begin."];
}

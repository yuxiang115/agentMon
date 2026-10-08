// /pet — the full-screen V-Pet view (ctx.ui.custom with keyboard focus, the
// snake.ts game-loop pattern: setInterval ticks, q/ESC closes). Type-only Pi
// imports; runs in vitest with a mock TUI.

import type { Component, TUI } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { activePet, levelFromXp, xpProgress, type GameState } from "../core";
import { speciesFor } from "../../pets/registry";
import { renderScreen } from "../renderer/src/framebuffer";
import { COLS, CHAR_ROWS } from "../renderer/src/lcd";
import { pickFrame, HOLD, SLEEP_BEAT, TICK_MS } from "../renderer/src/animation";
import { truncateVisible } from "./widget";

export interface PetViewOptions {
  tickMs?: number;
}

export async function openPetView(
  ctx: ExtensionContext,
  readState: () => GameState,
  opts: PetViewOptions = {},
): Promise<undefined> {
  await ctx.ui.custom<undefined>((tui: TUI, _theme, _keybindings, done) => {
    return new PetScreen(tui, done, readState, opts.tickMs ?? TICK_MS);
  });
}

class PetScreen implements Component {
  private timer: ReturnType<typeof setInterval> | undefined;
  private tickN = 0;

  constructor(
    private tui: Pick<TUI, "requestRender">,
    private done: (result: undefined) => void,
    private readState: () => GameState,
    tickMs: number,
  ) {
    this.timer = setInterval(() => {
      this.tickN++;
      this.tui.requestRender();
    }, tickMs);
  }

  render(width: number): string[] {
    const pet = activePet(this.readState());
    if (!pet) return ["agentMon: no pet yet — start a session first."];
    const species = speciesFor(pet.species);
    const poses = (species.roles[pet.activity] ?? species.roles.idle).map((p) => species.poses[p]);
    const hold = pet.activity === "sleep" ? SLEEP_BEAT : HOLD;
    const frame = pickFrame(poses, this.tickN, hold);
    const lcd = renderScreen(frame, COLS, CHAR_ROWS, { on: species.ink ?? "#2b2e31" });
    const c = pet.counters;
    const ageH = (pet.ageMs / 3_600_000).toFixed(1);
    const prog = xpProgress(c.xp);
    const evolved = pet.evolutions.length
      ? ` · evolved ${pet.evolutions.map((e) => `${e.from}→${e.to}`).join(", ")}`
      : "";
    return [
      ` ${pet.name} the ${species.name} (${species.stage}) Lv.${levelFromXp(c.xp)} — ${pet.activity} · ${pet.behaviorMode.toLowerCase()}${evolved}`,
      "",
      ...lcd.map((l) => " " + l),
      "",
      ` xp ${prog.into}/${prog.span} (total ${c.xp}) · care mistakes ${pet.careMistakes}`,
      ` traits — research ${pet.traits.research} · implementation ${pet.traits.implementation} · validation ${pet.traits.validation}`,
      ` reads ${c.reads} · searches ${c.searches} · writes ${c.writes} · commands ${c.commands}`,
      ` tests ${c.testsPassed} pass / ${c.testsFailed} fail · builds ${c.buildsPassed}/${c.buildsFailed}`,
      ` tasks ${c.tasksCompleted} · corrections ${c.userCorrections} · age ${ageH}h`,
      "",
      " q / ESC — close · /pets list · /pets use <species>",
    ].map((l) => truncateVisible(l, width));
  }

  handleInput(data: string): void {
    if (data === "q" || data === "Q" || data === "\x1b") {
      this.dispose();
      this.done(undefined);
    }
  }

  invalidate(): void {
    // no theme-cached state to drop
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

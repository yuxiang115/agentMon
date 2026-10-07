// /pet — the full-screen V-Pet view (ctx.ui.custom with keyboard focus, the
// snake.ts game-loop pattern: setInterval ticks, q/ESC closes). Type-only Pi
// imports; runs in vitest with a mock TUI.

import type { Component, TUI } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { activePet, type GameState } from "../core";
import { BYTE } from "../../pets/sprites/byte";
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
    const poses = (BYTE.roles[pet.activity] ?? BYTE.roles.idle).map((p) => BYTE.poses[p]);
    const hold = pet.activity === "sleep" ? SLEEP_BEAT : HOLD;
    const frame = pickFrame(poses, this.tickN, hold);
    const lcd = renderScreen(frame, COLS, CHAR_ROWS);
    const c = pet.counters;
    const ageH = (pet.ageMs / 3_600_000).toFixed(1);
    return [
      ` ${pet.name} (${pet.species}) — ${pet.activity}`,
      "",
      ...lcd.map((l) => " " + l),
      "",
      ` reads ${c.reads} · searches ${c.searches} · writes ${c.writes} · commands ${c.commands}`,
      ` tests ${c.testsPassed} pass / ${c.testsFailed} fail · builds ${c.buildsPassed}/${c.buildsFailed}`,
      ` tasks ${c.tasksCompleted} · corrections ${c.userCorrections} · age ${ageH}h · xp ${c.xp}`,
      "",
      " q / ESC — close",
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

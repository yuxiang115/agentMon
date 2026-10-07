// The always-on pet LCD widget, installed via ctx.ui.setWidget's live
// component-factory form (the snake.ts pattern — setInterval + requestRender).
// Only type imports come from Pi; all runtime code is agentMon's own, so the
// widget runs in vitest with a mock TUI.

import type { Component, TUI } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { activePet, levelFromXp, type GameState } from "../core";
import { BYTE } from "../../pets/sprites/byte";
import { renderScene } from "../renderer/src/framebuffer";
import { COLS, CHAR_ROWS, roamBounds } from "../renderer/src/lcd";
import { pickFrame, Roamer, HOLD, SLEEP_BEAT, TICK_MS, type Rng } from "../renderer/src/animation";
import { stripAnsi } from "../renderer/src/halfblock";

export interface WidgetOptions {
  tickMs?: number;
  rng: Rng;
}

/** Truncate to a visible column count, preserving ANSI escapes (width 0). */
export function truncateVisible(line: string, width: number): string {
  if (stripAnsi(line).length <= width) return line;
  let out = "";
  let w = 0;
  for (let i = 0; i < line.length && w < width - 1; i++) {
    const m = /^\x1b\[[0-9;]*m/.exec(line.slice(i));
    if (m) {
      out += m[0];
      i += m[0].length - 1;
      continue;
    }
    out += line[i];
    w++;
  }
  return out + "…";
}

/** The LCD component itself; owns the animation clock and the roamer. */
export class PetWidget implements Component {
  private roamer: Roamer;
  private timer: ReturnType<typeof setInterval> | undefined;
  private tickN = 0;

  constructor(
    private tui: Pick<TUI, "requestRender">,
    private getState: () => GameState,
    tickMs: number,
    rng: Rng,
  ) {
    this.roamer = new Roamer(8, COLS, 16, rng);
    const [minX, maxX] = roamBounds();
    this.timer = setInterval(() => this.tick(minX, maxX), tickMs);
  }

  private tick(minX: number, maxX: number): void {
    this.tickN++;
    const pet = activePet(this.getState());
    if (pet && (pet.activity === "idle" || pet.activity === "walk")) {
      this.roamer.step(minX, maxX);
    }
    this.tui.requestRender();
  }

  /** Bump from outside (a coding event arrived). */
  requestRender(): void {
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const pet = activePet(this.getState());
    if (!pet) return [];
    const poses = (BYTE.roles[pet.activity] ?? BYTE.roles.idle).map((p) => BYTE.poses[p]);
    const hold = pet.activity === "sleep" ? SLEEP_BEAT : HOLD;
    const frame = pickFrame(poses, this.tickN, hold);
    const roaming = pet.activity === "idle" || pet.activity === "walk";
    const lcd = renderScene(
      [{ frame, xLeft: roaming ? this.roamer.x : 8, mirror: roaming ? this.roamer.mirror : false }],
      COLS,
      CHAR_ROWS,
    );
    return [`${pet.name} Lv.${levelFromXp(pet.counters.xp)} · ${pet.activity}`, ...lcd].map((l) =>
      truncateVisible(l, width),
    );
  }

  invalidate(): void {
    // no theme-cached state to drop
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

/**
 * Install the widget; returns a handle valid even though Pi instantiates the
 * factory lazily when the TUI mounts. `refresh` forwards new state snapshots.
 */
export interface PetWidgetHandle {
  refresh(state: GameState): void;
  dispose(): void;
}

export function installWidget(
  ctx: ExtensionContext,
  readState: () => GameState,
  opts: WidgetOptions,
): PetWidgetHandle {
  let widget: PetWidget | undefined;
  let latest: GameState | undefined;
  ctx.ui.setWidget(
    "agentmon",
    (tui: TUI, _theme: unknown) => {
      widget = new PetWidget(tui, () => latest ?? readState(), opts.tickMs ?? TICK_MS, opts.rng);
      return widget;
    },
    { placement: "belowEditor" },
  );
  return {
    refresh(state: GameState) {
      latest = state;
      widget?.requestRender();
    },
    dispose() {
      widget?.dispose();
      widget = undefined;
      ctx.ui.setWidget("agentmon", undefined);
    },
  };
}

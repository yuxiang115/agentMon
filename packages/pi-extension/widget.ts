// The pet display: a NON-CAPTURING overlay pinned to the terminal's top-right
// corner. Same bridge trick pi-pets uses: ctx.ui.setWidget's factory hands us
// the TUI, we show the overlay from inside the factory, and the bridge widget
// itself renders nothing — so the panel floats top-right while the editor
// keeps full keyboard focus underneath.

import type { Component, TUI } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { activePet, levelFromXp, type GameState } from "../core";
import { speciesFor } from "../../pets/registry";
import { poseToColorGrid, renderColorScene } from "../renderer/src/colorframe";
import { renderScene } from "../renderer/src/framebuffer";
import { COLS, CHAR_ROWS, roamBounds } from "../renderer/src/lcd";
import { pickFrame, Roamer, HOLD, SLEEP_BEAT, TICK_MS, type Rng } from "../renderer/src/animation";
import { stripAnsi } from "../renderer/src/halfblock";

export interface DisplayOptions {
  tickMs?: number;
  rng: Rng;
}

// Minimal structural types for the overlay API (verified against pi-tui's
// tui.ts: showOverlay(component, options) -> OverlayHandle with hide/setHidden).
interface OverlayHandleLike {
  hide(): void;
  setHidden(hidden: boolean): void;
  isHidden(): boolean;
}

interface OverlayTuiLike {
  requestRender(): void;
  showOverlay(
    component: Component,
    options?: { nonCapturing?: boolean; anchor?: string; width?: number; margin?: { top?: number; right?: number } | number },
  ): OverlayHandleLike;
}

/** border + padding + 32-col LCD + padding + border */
export const OVERLAY_WIDTH = 36;

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

function padVisible(line: string, width: number): string {
  const len = stripAnsi(line).length;
  if (len >= width) return truncateVisible(line, width);
  return line + " ".repeat(width - len);
}

/** The bordered LCD panel component. NO handleInput — it never captures keys. */
export class PetOverlay implements Component {
  private roamer: Roamer;
  private timer: ReturnType<typeof setInterval> | undefined;
  private tickN = 0;

  constructor(
    private tui: OverlayTuiLike,
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
    const species = speciesFor(pet.species);
    const poses = (species.roles[pet.activity] ?? species.roles.idle).map((p) => species.poses[p]);
    const hold = pet.activity === "sleep" ? SLEEP_BEAT : HOLD;
    const frame = pickFrame(poses, this.tickN, hold);
    const roaming = pet.activity === "idle" || pet.activity === "walk";
    const x = roaming ? this.roamer.x : 8;
    const mirror = roaming ? this.roamer.mirror : false;
    const lcd = species.palette
      ? renderColorScene(
          [{ grid: poseToColorGrid(frame, species.palette), xLeft: x, mirror }],
          COLS,
          CHAR_ROWS,
        )
      : renderScene([{ frame, xLeft: x, mirror }], COLS, CHAR_ROWS, { on: species.ink ?? "#2b2e31" });

    const w = Math.min(width, OVERLAY_WIDTH);
    const inner = w - 2;
    const title = ` ${pet.name} Lv.${levelFromXp(pet.counters.xp)} · ${pet.activity} `;
    const fill = Math.max(1, inner - stripAnsi(title).length - 1);
    return [
      "┌─" + title + "─".repeat(fill) + "┐",
      ...lcd.map((l) => "│ " + padVisible(l, inner - 2) + " │"),
      "└" + "─".repeat(inner) + "┘",
    ];
  }

  invalidate(): void {
    // no theme-cached state to drop
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

export interface PetDisplayHandle {
  refresh(state: GameState): void;
  /** Show/hide the panel; returns the new visibility. */
  toggle(): boolean;
  dispose(): void;
}

/**
 * Install the top-right pet panel. The bridge widget is created immediately
 * (giving us the TUI when Pi mounts it); the overlay itself is shown from
 * inside the factory, exactly like pi-pets' non-capturing overlay.
 */
export function installPetDisplay(
  ctx: ExtensionContext,
  readState: () => GameState,
  opts: DisplayOptions,
): PetDisplayHandle {
  let overlay: PetOverlay | undefined;
  let handle: OverlayHandleLike | undefined;

  ctx.ui.setWidget("agentmon-bridge", (tui: TUI, _theme) => {
    const overlayTui = tui as unknown as OverlayTuiLike;
    overlay = new PetOverlay(overlayTui, readState, opts.tickMs ?? TICK_MS, opts.rng);
    handle = overlayTui.showOverlay(overlay, {
      nonCapturing: true,
      anchor: "top-right",
      width: OVERLAY_WIDTH,
      margin: { top: 1, right: 1 },
    });
    // the bridge itself renders nothing — the overlay is what users see
    return { render: () => [], invalidate: () => {} };
  });

  return {
    refresh(state: GameState) {
      overlay?.requestRender();
    },
    toggle() {
      if (!handle) return false;
      handle.setHidden(!handle.isHidden());
      return !handle.isHidden();
    },
    dispose() {
      overlay?.dispose();
      overlay = undefined;
      handle?.hide();
      handle = undefined;
      ctx.ui.setWidget("agentmon-bridge", undefined);
    },
  };
}

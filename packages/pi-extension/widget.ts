// The pet display: a NON-CAPTURING overlay pinned to the terminal's top-right
// corner. Same bridge trick pi-pets uses: ctx.ui.setWidget's factory hands us
// the TUI, we show the overlay from inside the factory, and the bridge widget
// itself renders nothing — so the panel floats top-right while the editor
// keeps full keyboard focus underneath.
//
// Pet size: poses are authored 16x16 and rendered at `size` pixels
// (16..60, `/pet size`); the sprite keeps 16px of walking room beside it,
// so the default (16) is exactly the classic 32x16 LCD.

import type { Component, TUI } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { activePet, levelFromXp, type GameState } from "../core";
import { poseRowsFor, speciesFor } from "../../pets/registry";
import { poseToColorGrid, renderColorScene } from "../renderer/src/colorframe";
import { renderScene } from "../renderer/src/framebuffer";
import { roamBounds } from "../renderer/src/lcd";
import { scaleRows } from "../renderer/src/scale";
import { pickFrame, Roamer, HOLD, SLEEP_BEAT, TICK_MS, type Rng } from "../renderer/src/animation";
import { stripAnsi } from "../renderer/src/halfblock";

export interface DisplayOptions {
  tickMs?: number;
  rng: Rng;
  /** Sprite pixel edge (clamped to 16..60). Default 16. */
  size?: number;
}

/** Pet sprite size range, `/pet size` (pixels = terminal columns). */
export const PET_SIZE_MIN = 16;
export const PET_SIZE_MAX = 60;
export const PET_SIZE_DEFAULT = 16;

export function clampPetSize(n: number): number {
  if (!Number.isFinite(n)) return PET_SIZE_DEFAULT;
  return Math.min(PET_SIZE_MAX, Math.max(PET_SIZE_MIN, Math.round(n)));
}

/** The pet's play area: the sprite plus 16px of walking room (32-wide at 16). */
export function petAreaWidth(size: number): number {
  return size + 16;
}

/** Terminal rows the play area occupies (two pixels per row). */
export function petCharRows(size: number): number {
  return Math.ceil(size / 2);
}

/** border + padding + play area + padding + border */
export function overlayWidthFor(size: number): number {
  return petAreaWidth(size) + 4;
}

/** The active pet size from persisted display settings. */
export function petSizeOf(state: GameState): number {
  return clampPetSize(state.ui?.petSize ?? PET_SIZE_DEFAULT);
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

/** The bordered pet panel component. NO handleInput — it never captures keys. */
export class PetOverlay implements Component {
  private roamer: Roamer;
  private timer: ReturnType<typeof setInterval> | undefined;
  private tickN = 0;
  private size: number;
  private readonly rng: Rng;

  constructor(
    private tui: OverlayTuiLike,
    private getState: () => GameState,
    tickMs: number,
    rng: Rng,
    size = PET_SIZE_DEFAULT,
  ) {
    this.size = clampPetSize(size);
    this.rng = rng;
    this.roamer = this.makeRoamer();
    const [minX, maxX] = this.bounds();
    this.timer = setInterval(() => this.tick(minX, maxX), tickMs);
  }

  private makeRoamer(): Roamer {
    // start centred; the sprite is `size` wide in a size+16 play area
    return new Roamer(8, petAreaWidth(this.size), this.size, this.rng);
  }

  private bounds(): [number, number] {
    return roamBounds(this.size, petAreaWidth(this.size));
  }

  /** Live-resize the sprite (16..60). Caller re-anchors the overlay. */
  setSize(n: number): void {
    this.size = clampPetSize(n);
    this.roamer = this.makeRoamer(); // restart centred
    this.tui.requestRender();
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
    const poseNames = species.roles[pet.activity] ?? species.roles.idle;
    const hold = pet.activity === "sleep" ? SLEEP_BEAT : HOLD;
    const frame = pickFrame(poseNames.map((p) => poseRowsFor(species, p, this.size)), this.tickN, hold);
    const scaled = scaleRows(frame, this.size);
    const areaW = petAreaWidth(this.size);
    const rows = petCharRows(this.size);
    const roaming = pet.activity === "idle" || pet.activity === "walk";
    const x = roaming ? this.roamer.x : Math.round((areaW - this.size) / 2);
    const mirror = roaming ? this.roamer.mirror : false;
    const lcd = species.palette
      ? renderColorScene(
          [{ grid: poseToColorGrid(scaled, species.palette, this.size), xLeft: x, mirror }],
          areaW,
          rows,
        )
      : renderScene([{ frame: scaled, xLeft: x, mirror }], areaW, rows, { on: species.ink ?? "#2b2e31" });

    const w = Math.min(width, overlayWidthFor(this.size));
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
  /** Live-resize the sprite (16..60), re-anchoring the overlay width. */
  setSize(n: number): void;
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
  let overlayTui: OverlayTuiLike | undefined;
  let hidden = false;

  function show(tui: OverlayTuiLike, size: number): void {
    handle = tui.showOverlay(overlay!, {
      nonCapturing: true,
      anchor: "top-right",
      width: overlayWidthFor(size),
      margin: { top: 1, right: 1 },
    });
    handle.setHidden(hidden); // preserve a user toggle across resizes
  }

  ctx.ui.setWidget("agentmon-bridge", (tui: TUI, _theme) => {
    overlayTui = tui as unknown as OverlayTuiLike;
    const size = clampPetSize(opts.size ?? PET_SIZE_DEFAULT);
    overlay = new PetOverlay(overlayTui, readState, opts.tickMs ?? TICK_MS, opts.rng, size);
    show(overlayTui, size);
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
      hidden = handle.isHidden();
      return !hidden;
    },
    setSize(n: number) {
      if (!overlay || !overlayTui) return;
      overlay.setSize(n);
      // pi-tui reads options.width only at show time — re-anchor the same
      // component at the new width (public API: hide + showOverlay again)
      handle?.hide();
      handle = undefined;
      show(overlayTui, n);
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

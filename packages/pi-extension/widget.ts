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
import { poseRowsFor, speciesFor, type SpeciesDef } from "../../pets/registry";
import { poseToColorGrid, renderColorScene, type ColorGrid } from "../renderer/src/colorframe";
import { renderScene } from "../renderer/src/framebuffer";
import { roamBounds } from "../renderer/src/lcd";
import { scaleRows } from "../renderer/src/scale";
import { pickFrame, Roamer, HOLD, SLEEP_BEAT, TICK_MS, type Rng } from "../renderer/src/animation";
import { evolvePlan, silhouetteGrid, whitenGrid, type EvoPlan } from "../renderer/src/evofx";
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

/**
 * Pose rows -> a COLOUR grid whatever the species: palette pets map through
 * their palette; mono pets become single-colour grids (their ink) so the
 * evolution fx can wash/silhouette every species the same way.
 */
export function speciesPoseGrid(species: SpeciesDef, rows: string[], size: number): ColorGrid {
  if (species.palette) return poseToColorGrid(rows, species.palette, size);
  const inkColor = species.ink ?? "#2b2e31";
  return rows.map((r) => [...r].map((c) => (c === "." ? null : inkColor)));
}

/** The species' most-used colour in a frame (burst-silhouette colour). */
export function dominantColorOf(species: SpeciesDef, rows: string[]): string {
  if (species.palette) {
    const counts = new Map<string, number>();
    for (const row of rows) for (const ch of row) if (ch !== ".") counts.set(ch, (counts.get(ch) ?? 0) + 1);
    let best = "";
    let bestN = -1;
    for (const [ch, n] of counts) if (n > bestN) { bestN = n; best = ch; }
    if (best) return species.palette[best] ?? "#ffffff";
  }
  // mono default matches the render ink — must differ from the white flash
  return species.ink ?? "#2b2e31";
}

/**
 * The evolution-fx frame for the current tick: which species' pose to draw
 * (old/new per the plan), colour-processed (whiten/silhouette). Returns null
 * when the plan is done.
 */
export function evoPoseGrid(
  plan: EvoPlan,
  fromSpecies: SpeciesDef,
  toSpecies: SpeciesDef,
  activity: string,
  tickN: number,
  size: number,
): ColorGrid | null {
  if (plan.stage === "done") return null;
  const src = plan.form === "old" ? fromSpecies : toSpecies;
  const poseNames = src.roles[activity] ?? src.roles.idle;
  const hold = plan.flicker ? 2 : activity === "sleep" ? SLEEP_BEAT : HOLD;
  const frame = pickFrame(poseNames.map((p) => poseRowsFor(src, p, size)), tickN, hold);
  const grid = speciesPoseGrid(src, scaleRows(frame, size), size);
  if (plan.silhouette) {
    return silhouetteGrid(grid, plan.flashWhite ? "#ffffff" : dominantColorOf(src, frame));
  }
  return whitenGrid(grid, plan.whiteness);
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
  private readonly tickMs: number;
  /** Set while the panel is toggled away — pauses ticking AND rendering. */
  private hidden = false;
  /** Evolution fx state (species the pet transformed FROM). */
  private evolve?: { from: string; startTick: number };

  constructor(
    private tui: OverlayTuiLike,
    private getState: () => GameState,
    tickMs: number,
    rng: Rng,
    size = PET_SIZE_DEFAULT,
  ) {
    this.size = clampPetSize(size);
    this.rng = rng;
    this.tickMs = tickMs;
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

  /** Hidden panels stop ticking — no idle animation burn while invisible. */
  setHidden(v: boolean): void {
    this.hidden = v;
    if (!v) this.tui.requestRender();
  }

  /** Start the evolution transform (from the species the pet used to be). */
  startEvolve(fromId: string): void {
    this.evolve = { from: fromId, startTick: this.tickN };
    this.hidden = false;
    this.tui.requestRender();
  }

  private tick(minX: number, maxX: number): void {
    if (this.hidden) return;
    this.tickN++;
    const pet = activePet(this.getState());
    if (pet && (pet.activity === "idle" || pet.activity === "walk")) {
      this.roamer.step(minX, maxX);
    }
    this.tui.requestRender();
  }

  /** Bump from outside (a coding event arrived). */
  requestRender(): void {
    if (!this.hidden) this.tui.requestRender();
  }

  private panel(lcd: string[], title: string, width: number): string[] {
    const w = Math.min(width, overlayWidthFor(this.size));
    const inner = w - 2;
    const fill = Math.max(1, inner - stripAnsi(title).length - 1);
    return [
      "┌─" + title + "─".repeat(fill) + "┐",
      ...lcd.map((l) => "│ " + padVisible(l, inner - 2) + " │"),
      "└" + "─".repeat(inner) + "┘",
    ];
  }

  render(width: number): string[] {
    if (this.hidden) return [];
    const pet = activePet(this.getState());
    if (!pet) return [];
    const species = speciesFor(pet.species);
    const areaW = petAreaWidth(this.size);
    const rows = petCharRows(this.size);
    const centreX = Math.round((areaW - this.size) / 2);
    const title = ` ${pet.name} Lv.${levelFromXp(pet.counters.xp)} · ${pet.activity} `;

    // evolution fx overrides the normal frame until it completes
    if (this.evolve) {
      const elapsed = (this.tickN - this.evolve.startTick) * this.tickMs;
      const plan = evolvePlan(elapsed);
      const grid = evoPoseGrid(plan, speciesFor(this.evolve.from), species, pet.activity, this.tickN, this.size);
      if (grid) {
        return this.panel(
          renderColorScene([{ grid, xLeft: centreX }], areaW, rows),
          ` ${pet.name} Lv.${levelFromXp(pet.counters.xp)} · evolving `,
          width,
        );
      }
      this.evolve = undefined; // done — fall through to normal
    }

    const poseNames = species.roles[pet.activity] ?? species.roles.idle;
    const hold = pet.activity === "sleep" ? SLEEP_BEAT : HOLD;
    const frame = pickFrame(poseNames.map((p) => poseRowsFor(species, p, this.size)), this.tickN, hold);
    const scaled = scaleRows(frame, this.size);
    const roaming = pet.activity === "idle" || pet.activity === "walk";
    const x = roaming ? this.roamer.x : centreX;
    const mirror = roaming ? this.roamer.mirror : false;
    const lcd = species.palette
      ? renderColorScene(
          [{ grid: poseToColorGrid(scaled, species.palette, this.size), xLeft: x, mirror }],
          areaW,
          rows,
        )
      : renderScene([{ frame: scaled, xLeft: x, mirror }], areaW, rows, { on: species.ink ?? "#2b2e31" });

    return this.panel(lcd, title, width);
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
  /** Play the evolution transform from the species the pet used to be. */
  startEvolve(fromId: string): void;
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
      overlay?.setHidden(hidden);
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
    startEvolve(fromId: string) {
      overlay?.startEvolve(fromId);
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

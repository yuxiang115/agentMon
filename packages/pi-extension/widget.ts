// The pet display: a NON-CAPTURING overlay pinned to the terminal's top-right
// corner. Same bridge trick pi-pets uses: ctx.ui.setWidget's factory hands us
// the TUI, we show the overlay from inside the factory, and the bridge widget
// itself renders nothing — so the panel floats top-right while the editor
// keeps full keyboard focus underneath.
//
// Pet size: poses are authored 16x16 and rendered at `size` pixels
// (16..60, `/pet size`), then cropped to the species' sprite box (the union
// of every pose's lit pixels — imported packs carry wide transparent
// margins). The sprite keeps 16px of walking room beside it.
//
// Renderer: quadrant blocks (default, 2x2 px per cell — the same pixel grid
// at half the terminal width) or the classic half-block LCD (`/pet renderer`).
// Palette (image-imported) pets always render half-block: a cell carries only
// one foreground and one background colour.

import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { activePet, type GameState, type PetState } from "../core";
import { poseRowsFor, speciesFor, type SpeciesDef } from "../../pets/registry";
import { poseToColorGrid, renderColorScene, type ColorGrid, type ColorPlacement } from "../renderer/src/colorframe";
import { renderScene, type ScenePlacement } from "../renderer/src/framebuffer";
import { renderQuadColorScene, renderQuadScene } from "../renderer/src/quadblock";
import { zzzColumn, zzzGlyphSize, zzzPhase } from "../renderer/src/zzz";
import { roamBounds } from "../renderer/src/lcd";
import { scaleRows } from "../renderer/src/scale";
import { pickActivityIndex, pickFrame, Roamer, HOLD, SLEEP_BEAT, TICK_MS, type Rng } from "../renderer/src/animation";
import { evolvePlan, silhouetteGrid, whitenGrid, type EvoPlan } from "../renderer/src/evofx";

export interface DisplayOptions {
  tickMs?: number;
  rng: Rng;
  /** Sprite pixel edge (clamped to 16..60). Default 16. */
  size?: number;
  /** LCD cell packing: quadrant blocks (default) or classic half-blocks. */
  renderer?: RendererMode;
}

/** Pet sprite size range, `/pet size` (pixels = terminal columns). */
export const PET_SIZE_MIN = 16;
export const PET_SIZE_MAX = 60;
export const PET_SIZE_DEFAULT = 16;

/** LCD cell packing: quad = 2x2 px quadrant glyphs (half the width),
 *  half = the classic ▀-per-cell LCD. Palette (image-imported) pets always
 *  render half-block — a cell carries only one fg + one bg colour. */
export type RendererMode = "half" | "quad";
export const RENDERER_DEFAULT: RendererMode = "quad";

export function rendererOf(state: GameState): RendererMode {
  return state.ui?.renderer === "half" ? "half" : "quad";
}

export function clampPetSize(n: number): number {
  if (!Number.isFinite(n)) return PET_SIZE_DEFAULT;
  return Math.min(PET_SIZE_MAX, Math.max(PET_SIZE_MIN, Math.round(n)));
}

/** The pet's play area: the sprite plus 16px of walking room (32-wide at 16). */
export function petAreaWidth(spriteW: number): number {
  return spriteW + 16;
}

/** Terminal rows the play area occupies (two pixels per row). */
export function petCharRows(spriteH: number): number {
  return Math.ceil(spriteH / 2);
}

/** border + padding + play area + padding + border; quad packs 2 px per col */
export function overlayWidthFor(spriteW: number, quad = false): number {
  const area = quad ? Math.ceil(petAreaWidth(spriteW) / 2) : petAreaWidth(spriteW);
  return area + 4;
}

/** The lit region of a species' poses at a render size, in scaled pixels. */
export interface SpriteBox {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

const boxCache = new WeakMap<SpeciesDef, Map<number, SpriteBox>>();

/**
 * Union bounding box of every pose's lit pixels at `size`. One box per
 * species (not per frame), so the panel never jumps between animation
 * frames; a species with no lit pixels keeps the full square.
 */
export function spriteBox(species: SpeciesDef, size: number): SpriteBox {
  let bySize = boxCache.get(species);
  if (!bySize) boxCache.set(species, (bySize = new Map()));
  const hit = bySize.get(size);
  if (hit) return hit;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const name of Object.keys(species.poses)) {
    scaleRows(poseRowsFor(species, name, size), size).forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === ".") continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    });
  }
  const box = x1 < 0 ? { x0: 0, y0: 0, w: size, h: size } : { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  bySize.set(size, box);
  return box;
}

/** The smallest box holding both (evolution fx draws either form). */
export function unionBox(a: SpriteBox, b: SpriteBox): SpriteBox {
  const x0 = Math.min(a.x0, b.x0);
  const y0 = Math.min(a.y0, b.y0);
  return {
    x0,
    y0,
    w: Math.max(a.x0 + a.w, b.x0 + b.w) - x0,
    h: Math.max(a.y0 + a.h, b.y0 + b.h) - y0,
  };
}

/** Cut a scaled frame (char rows or a colour grid) down to its sprite box. */
export function cropToBox<T extends string | readonly unknown[]>(rows: readonly T[], box: SpriteBox): T[] {
  return rows.slice(box.y0, box.y0 + box.h).map((r) => r.slice(box.x0, box.x0 + box.w) as T);
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
  if (width <= 0) return "";
  return truncateToWidth(line, width, "…");
}

function padVisible(line: string, width: number): string {
  const len = visibleWidth(line);
  if (len >= width) return truncateVisible(line, width);
  return line + " ".repeat(width - len);
}

/** The bordered pet panel component. NO handleInput — it never captures keys. */
export class PetOverlay implements Component {
  private roamer: Roamer;
  private timer: ReturnType<typeof setInterval> | undefined;
  private tickN = 0;
  private size: number;
  /** Lit region of the current species' poses — the play area's sprite. */
  private box: SpriteBox;
  private readonly rng: Rng;
  private readonly tickMs: number;
  private renderer: RendererMode;
  /** Last "what the screen can show" signature — gate for requestRender. */
  private lastSig = "";
  /** Set while the panel is toggled away — pauses ticking AND rendering. */
  private hidden = false;
  /** Evolution fx state (species the pet transformed FROM). */
  private evolve?: { from: string; startTick: number };
  private reward?: { message: string; startTick: number };
  private petId: string | null;
  /** Called when the sprite box's width changes — the panel must re-anchor. */
  onWidthChange?: () => void;

  constructor(
    private tui: OverlayTuiLike,
    private getState: () => GameState,
    tickMs: number,
    rng: Rng,
    size = PET_SIZE_DEFAULT,
    renderer: RendererMode = RENDERER_DEFAULT,
  ) {
    this.size = clampPetSize(size);
    this.renderer = renderer;
    this.rng = rng;
    this.tickMs = tickMs;
    this.petId = getState().activePetId;
    this.box = this.currentBox();
    this.roamer = this.makeRoamer();
    this.timer = setInterval(() => this.tick(), tickMs);
  }

  /** The sprite box of what's on screen: the active species, unioned with
   *  the old form while an evolution fx can still draw it. */
  private currentBox(): SpriteBox {
    const pet = activePet(this.getState());
    const fallback = { x0: 0, y0: 0, w: this.size, h: this.size };
    if (!pet) return fallback;
    const box = spriteBox(speciesFor(pet.species), this.size);
    return this.evolve ? unionBox(box, spriteBox(speciesFor(this.evolve.from), this.size)) : box;
  }

  /** Re-measure the box; a change (evolution, pet switch, resize) restarts
   *  the roamer, since its play area changed. */
  private syncBox(): void {
    const box = this.currentBox();
    if (box.w === this.box.w && box.h === this.box.h && box.x0 === this.box.x0 && box.y0 === this.box.y0) return;
    const widthChanged = box.w !== this.box.w;
    this.box = box;
    this.roamer = this.makeRoamer();
    if (widthChanged) this.onWidthChange?.();
  }

  /** Panel width for the current sprite box — the caller anchors with it. */
  overlayWidth(): number {
    return overlayWidthFor(this.currentBox().w, this.wantsQuad());
  }

  private makeRoamer(): Roamer {
    // start centred; the sprite is box.w wide in a box.w+16 play area
    return new Roamer(8, petAreaWidth(this.box.w), this.box.w, this.rng);
  }

  /** Everything the screen can show right now, hashed into one string. */
  private visualSignature(pet: PetState): string {
    const species = speciesFor(pet.species);
    const evo = this.evolve
      ? (() => {
          const plan = evolvePlan((this.tickN - this.evolve!.startTick) * this.tickMs);
          return `${plan.stage}:${plan.form}:${Math.round(plan.whiteness * 12)}:${plan.flashWhite ? 1 : 0}`;
        })()
      : "-";
    const toast = this.reward
      ? `${Math.floor(((this.tickN - this.reward.startTick) * this.tickMs) / 300)}:` +
        `${(this.tickN - this.reward.startTick) * this.tickMs < 4000 ? 1 : 0}`
      : "-";
    return [
      pet.id, pet.species, pet.activity, this.poseIndex(pet, species),
      this.roamer.x, this.roamer.mirror,
      pet.activity === "sleep" ? zzzPhase(this.tickN) : "-",
      this.size, toast, evo,
    ].join("|");
  }

  /** Pose loop state shared by render() and the repaint gate. */
  private poseIndex(pet: PetState, species: SpeciesDef): number {
    const names = species.roles[pet.activity] ?? species.roles.idle;
    const hold = pet.activity === "sleep" ? SLEEP_BEAT : HOLD;
    // two-frame idle/walk loops are [open, blink] — blink naturally, don't cycle
    const blink = (pet.activity === "idle" || pet.activity === "walk") && names.length === 2;
    return pickActivityIndex(Math.max(1, names.length), this.tickN, hold, blink);
  }

  /** The pet's LCD lines at the current tick: pose + zzz, quad/half/colour. */
  private sceneLines(
    pet: PetState,
    species: SpeciesDef,
    areaW: number,
    rows: number,
    centreX: number,
  ): string[] {
    const names = species.roles[pet.activity] ?? species.roles.idle;
    const index = this.poseIndex(pet, species);
    const scaled = cropToBox(scaleRows(poseRowsFor(species, names[index] ?? names[0]!, this.size), this.size), this.box);
    const roaming = pet.activity === "idle" || pet.activity === "walk";
    const x = roaming ? this.roamer.x : centreX;
    const mirror = roaming ? this.roamer.mirror : false;
    const ink = species.ink ?? "#2b2e31";
    const sleeping = pet.activity === "sleep";
    const z = sleeping ? zzzColumn(this.size, zzzPhase(this.tickN), rows * 2) : undefined;
    const zx = areaW - zzzGlyphSize(this.size) - 1;

    if (this.renderer === "quad") {
      if (species.palette) {
        const grids: ColorPlacement[] = [
          { grid: poseToColorGrid(scaled, species.palette, scaled.length), xLeft: x, mirror },
        ];
        if (z) grids.push({ grid: z.map((r) => [...r].map((c) => (c === "." ? null : "#8a8f94"))), xLeft: zx });
        return renderQuadColorScene(grids, Math.ceil(areaW / 2), rows);
      }
      const placements: ScenePlacement[] = [{ frame: scaled, xLeft: x, mirror }];
      if (z) placements.push({ frame: z, xLeft: zx });
      return renderQuadScene(placements, Math.ceil(areaW / 2), rows, { on: ink });
    }
    if (species.palette) {
      const grids: ColorPlacement[] = [
        { grid: poseToColorGrid(scaled, species.palette, scaled.length), xLeft: x, mirror },
      ];
      if (z) grids.push({ grid: z.map((r) => [...r].map((c) => (c === "." ? null : "#8a8f94"))), xLeft: zx });
      return renderColorScene(grids, areaW, rows);
    }
    const placements: ScenePlacement[] = [{ frame: scaled, xLeft: x, mirror }];
    if (z) placements.push({ frame: z, xLeft: zx });
    return renderScene(placements, areaW, rows, { on: ink });
  }

  /** Live-resize the sprite (16..60). Caller re-anchors the overlay. */
  setSize(n: number): void {
    this.size = clampPetSize(n);
    this.box = this.currentBox();
    this.roamer = this.makeRoamer(); // restart centred
    this.tui.requestRender();
  }

  /** Hidden panels stop ticking — no idle animation burn while invisible. */
  setHidden(v: boolean): void {
    this.hidden = v;
    if (!v) this.tui.requestRender();
  }

  /** True when the current pet renders through the quadrant LCD. */
  wantsQuad(): boolean {
    return this.renderer === "quad";
  }

  /** Switch LCD cell packing; caller re-anchors the overlay width. */
  setRenderer(mode: RendererMode): void {
    this.renderer = mode;
    this.lastSig = ""; // force a repaint at the new packing
    this.tui.requestRender();
  }

  /** Start the evolution transform (from the species the pet used to be). */
  startEvolve(fromId: string): void {
    this.evolve = { from: fromId, startTick: this.tickN };
    this.syncBox(); // the fx draws both forms — widen to hold either
    this.tui.requestRender();
  }

  startReward(message: string): void {
    this.reward = { message, startTick: this.tickN };
    this.requestRender();
  }

  private tick(): void {
    if (this.hidden) return;
    this.tickN++;
    if (this.evolve && evolvePlan((this.tickN - this.evolve.startTick) * this.tickMs).stage === "done") {
      this.evolve = undefined;
    }
    // box changes land here, never inside render(): re-anchoring hides and
    // re-shows the overlay
    this.syncBox();
    const pet = activePet(this.getState());
    if (pet && (pet.activity === "idle" || pet.activity === "walk")) {
      const [minX, maxX] = roamBounds(this.box.w, petAreaWidth(this.box.w));
      this.roamer.step(minX, maxX);
    }
    // Repaint only when the visible frame can change: pose switch, blink,
    // roam step, zzz rise, toast blink, or an evolution-fx bucket. A sleeping
    // pet drops from 10 repaints/s to ~1; the signature is derived from the
    // same picks render() uses, so the two can never disagree.
    const sig = pet ? this.visualSignature(pet) : "-";
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      this.tui.requestRender();
    }
  }

  /** Bump from outside (a coding event arrived). */
  requestRender(): void {
    if (!this.hidden) this.tui.requestRender();
  }

  refresh(state: GameState): void {
    if (this.petId !== state.activePetId) {
      this.petId = state.activePetId;
      this.reward = undefined;
      this.evolve = undefined;
      this.roamer = this.makeRoamer();
    }
    this.syncBox(); // a species change (same pet) can resize the sprite
    this.requestRender();
  }

  private panel(lcd: string[], title: string, width: number, quad = false): string[] {
    const w = Math.min(width, overlayWidthFor(this.box.w, quad));
    if (w < 5) return [];
    const inner = w - 2;
    const heading = truncateVisible(title, inner - 1);
    const fill = Math.max(0, inner - visibleWidth(heading) - 1);
    return [
      "┌─" + heading + "─".repeat(fill) + "┐",
      ...lcd.map((l) => "│ " + padVisible(l, inner - 2) + " │"),
      "└" + "─".repeat(inner) + "┘",
    ];
  }

  /**
   * The compact device: species line + LCD + (transiently) a reward toast
   * or an evolution stage. Journey numbers (XP bar, task state, evolution
   * goals) live in the TUI footer — the panel stays just the pet.
   */
  private device(lcd: string[], pet: PetState, effect?: string): string[] {
    const species = speciesFor(pet.species);
    const elapsed = this.reward ? (this.tickN - this.reward.startTick) * this.tickMs : Infinity;
    const toast = this.reward && elapsed < 4000
      // calmer than a per-tick strobe: swap ✦/✧ every 300 ms
      ? `${Math.floor(elapsed / 300) % 2 === 0 ? "✦" : "✧"} ${this.reward.message}` : undefined;
    const feedback = effect ?? toast;
    return [
      `${species.name} · ${species.lifeStage ?? species.stage}`,
      ...lcd,
      ...(feedback ? [feedback] : []),
    ];
  }

  render(width: number): string[] {
    if (this.hidden) return [];
    const pet = activePet(this.getState());
    if (!pet) return [];
    const species = speciesFor(pet.species);
    const quad = this.renderer === "quad";
    const areaW = petAreaWidth(this.box.w);
    const rows = petCharRows(this.box.h);
    const centreX = Math.round((areaW - this.box.w) / 2);
    const title = ` ${pet.name} `;

    // evolution fx overrides the normal frame until it completes
    if (this.evolve) {
      const elapsed = (this.tickN - this.evolve.startTick) * this.tickMs;
      const plan = evolvePlan(elapsed);
      const full = evoPoseGrid(plan, speciesFor(this.evolve.from), species, pet.activity, this.tickN, this.size);
      if (full) {
        const grid = cropToBox(full, this.box);
        // quad mode renders the fx through the colour quadrant LCD too —
        // mono grids are single-colour, so they pack losslessly
        let lcd: string[];
        if (quad) {
          lcd = renderQuadColorScene([{ grid, xLeft: centreX }], Math.ceil(areaW / 2), rows);
        } else {
          lcd = renderColorScene([{ grid, xLeft: centreX }], areaW, rows);
        }
        return this.panel(
          this.device(lcd, pet, `EVOLVE: ${plan.stage.toUpperCase()}`),
          " ✦ evolving ✦ ",
          width,
          quad,
        );
      }
      this.evolve = undefined; // done — fall through to normal
    }

    return this.panel(
      this.device(this.sceneLines(pet, species, areaW, rows, centreX), pet),
      title,
      width,
      quad,
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

export interface PetDisplayHandle {
  refresh(state: GameState): void;
  /** Show/hide the panel; returns the new visibility. */
  toggle(): boolean;
  /** Live-resize the sprite (16..60), re-anchoring the overlay width. */
  setSize(n: number): void;
  /** Switch LCD cell packing (quad/half), re-anchoring the overlay width. */
  setRenderer(mode: RendererMode): void;
  /** Play the evolution transform from the species the pet used to be. */
  startEvolve(fromId: string): void;
  startReward(message: string): void;
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
  let curSize = clampPetSize(opts.size ?? PET_SIZE_DEFAULT);
  let anchorWidth = 0;

  function show(tui: OverlayTuiLike): void {
    anchorWidth = overlay!.overlayWidth();
    handle = tui.showOverlay(overlay!, {
      nonCapturing: true,
      anchor: "top-right",
      width: anchorWidth,
      margin: { top: 1, right: 1 },
    });
    handle.setHidden(hidden); // preserve a user toggle across resizes
  }

  /** pi-tui reads options.width only at show time — re-anchor the same
   *  component (public API: hide + showOverlay again), e.g. after a size or
   *  renderer change, or when the sprite box changes (evolution, pet switch). */
  function reanchor(): void {
    if (!overlay || !overlayTui) return;
    handle?.hide();
    handle = undefined;
    show(overlayTui);
  }

  ctx.ui.setWidget("agentmon-bridge", (tui: TUI, _theme) => {
    overlayTui = tui as unknown as OverlayTuiLike;
    overlay = new PetOverlay(overlayTui, readState, opts.tickMs ?? TICK_MS, opts.rng, curSize, opts.renderer ?? RENDERER_DEFAULT);
    overlay.onWidthChange = () => {
      if (overlay && overlay.overlayWidth() !== anchorWidth) reanchor();
    };
    show(overlayTui);
    // the bridge itself renders nothing — the overlay is what users see
    return { render: () => [], invalidate: () => {} };
  });

  return {
    refresh(state: GameState) {
      overlay?.refresh(state);
      if (overlay && overlay.overlayWidth() !== anchorWidth) reanchor();
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
      curSize = n;
      reanchor();
    },
    setRenderer(mode: RendererMode) {
      if (!overlay) return;
      overlay.setRenderer(mode);
      reanchor();
    },
    startEvolve(fromId: string) {
      overlay?.startEvolve(fromId);
    },
    startReward(message: string) {
      overlay?.startReward(message);
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

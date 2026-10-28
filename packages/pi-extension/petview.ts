// /pet — the full-screen V-Pet view (ctx.ui.custom with keyboard focus, the
// snake.ts game-loop pattern: setInterval ticks, q/ESC closes). Type-only Pi
// imports; runs in vitest with a mock TUI.

import type { Component, TUI } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { activePet, levelFromXp, type GameState } from "../core";
import { speciesFor } from "../../pets/registry";
import { poseToColorGrid, renderColorScene } from "../renderer/src/colorframe";
import { renderScreen } from "../renderer/src/framebuffer";
import { pickActivityFrames, HOLD, SLEEP_BEAT, TICK_MS } from "../renderer/src/animation";
import { evolvePlan } from "../renderer/src/evofx";
import {
  cropToBox,
  evoPoseGrid,
  petAreaWidth,
  petCharRows,
  petSizeOf,
  poseFrame,
  spriteBox,
  truncateVisible,
  unionBox,
  type SpriteBox,
} from "./widget";
import { evolutionLines, journalLines, taskLine, xpLine } from "./growth";

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
  private readonly tickMs: number;
  /** Species drawn last render — a change while the view is open plays the
   *  evolution fx from the old form. */
  private lastSpecies: string | undefined;
  private evolve?: { from: string; startTick: number };

  constructor(
    private tui: Pick<TUI, "requestRender">,
    private done: (result: undefined) => void,
    private readState: () => GameState,
    tickMs: number,
  ) {
    this.tickMs = tickMs;
    this.timer = setInterval(() => {
      this.tickN++;
      this.tui.requestRender();
    }, tickMs);
  }

  render(width: number): string[] {
    const state = this.readState();
    const pet = activePet(state);
    if (!pet) return ["agentMon: no pet yet — start a session first."];
    const species = speciesFor(pet.species);
    if (this.lastSpecies !== undefined && this.lastSpecies !== pet.species) {
      this.evolve = { from: this.lastSpecies, startTick: this.tickN };
    }
    this.lastSpecies = pet.species;
    const size = Math.min(petSizeOf(state), Math.max(16, width - 4)); // fit the terminal
    const own = spriteBox(species, size);
    const box = this.evolve ? unionBox(own, spriteBox(speciesFor(this.evolve.from), size)) : own;
    const areaW = petAreaWidth(box.w);
    const rows = petCharRows(box.h);
    const centreX = Math.round((areaW - box.w) / 2);

    // evolution fx: the transform replaces the normal LCD until it ends
    let lcd: string[];
    if (this.evolve) {
      const elapsed = (this.tickN - this.evolve.startTick) * this.tickMs;
      const plan = evolvePlan(elapsed);
      const grid = evoPoseGrid(plan, speciesFor(this.evolve.from), species, pet.activity, this.tickN, size);
      if (grid) {
        lcd = renderColorScene([{ grid: cropToBox(grid, box), xLeft: centreX }], areaW, rows);
      } else {
        this.evolve = undefined;
        lcd = this.normalLcd(pet.activity, species, size, box, areaW, rows, centreX);
      }
    } else {
      lcd = this.normalLcd(pet.activity, species, size, box, areaW, rows, centreX);
    }
    const c = pet.counters;
    const ageH = (pet.ageMs / 3_600_000).toFixed(1);
    const evolved = pet.evolutions.length
      ? ` · evolved ${pet.evolutions.map((e) => `${e.from}→${e.to}`).join(", ")}`
      : "";
    return [
      ` ${pet.name} / ${species.name} (${species.lifeStage ?? species.stage}) Lv.${levelFromXp(c.xp)} — ${pet.activity} · ${pet.behaviorMode.toLowerCase()}${evolved}`,
      "",
      ...lcd.map((l) => " " + l),
      "",
      ` ${xpLine(pet)} · total ${c.xp}`,
      ` ${taskLine(pet)}`,
      ...evolutionLines(pet).map((line) => ` ${line}`),
      " Rewards (most recent first)",
      ...journalLines(pet).map((line) => ` ${line}`),
      ` Care mistakes ${pet.careMistakes}`,
      ` traits — research ${pet.traits.research} · implementation ${pet.traits.implementation} · validation ${pet.traits.validation}`,
      ` reads ${c.reads} · searches ${c.searches} · writes ${c.writes} · commands ${c.commands}`,
      ` tests ${c.testsPassed} pass / ${c.testsFailed} fail · builds ${c.buildsPassed}/${c.buildsFailed}`,
      ` tasks ${c.tasksCompleted} · corrections ${c.userCorrections} · age ${ageH}h`,
      "",
      " q / ESC — close · /pet journey · /pet partners · /pet size <16-60>",
    ].map((l) => truncateVisible(l, width));
  }

  private normalLcd(
    activity: string,
    species: ReturnType<typeof speciesFor>,
    size: number,
    box: SpriteBox,
    areaW: number,
    rows: number,
    centreX: number,
  ): string[] {
    const poseNames = species.roles[activity] ?? species.roles.idle;
    const hold = activity === "sleep" ? SLEEP_BEAT : HOLD;
    // two-frame idle/walk loops are [open, blink] — blink naturally
    const blink = (activity === "idle" || activity === "walk") && poseNames.length === 2;
    const frame = pickActivityFrames(poseNames.map((p) => poseFrame(species, p, size)), this.tickN, hold, blink);
    const scaled = cropToBox(frame, box);
    return species.palette
      ? renderColorScene(
          [{ grid: poseToColorGrid(scaled, species.palette, scaled.length), xLeft: centreX }],
          areaW,
          rows,
        )
      : renderScreen(scaled, areaW, rows, { on: species.ink ?? "#2b2e31" });
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

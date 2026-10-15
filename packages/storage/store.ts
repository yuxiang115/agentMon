// PetStore — the single mutation funnel (audit §3): every write goes through
// load -> tick(catch-up) -> mutate -> atomic save, and reads project the same
// way without writing (tama96's safe-observer pattern). Stage 3 wraps Pi's
// withFileMutationQueue around this for cross-process safety; Stage 7 can swap
// the funnel for a socket owner without touching the core.
//
// Reads are served from an mtime-validated cache: the extension reads
// ~12x/second (animation ticks, renders, the footer freshness poll) but is
// the only writer, so a stat() probe replaces read+parse on every hit. A
// changed mtime — another session, a manual edit, a corrupt-file recovery —
// always falls through to a real load.

import { statSync } from "node:fs";
import { tick } from "../core/reducer";
import type { GameState } from "../core/pet";
import { loadState, saveState, statePath } from "./json";

export class PetStore {
  readonly path: string;
  /** Last known on-disk state and the mtime it was read at. */
  private cache?: { state: GameState; mtimeMs: number };

  constructor(path: string) {
    this.path = path;
  }

  /** Open a store rooted at a directory (state.json inside it). */
  static at(dir: string): PetStore {
    return new PetStore(statePath(dir));
  }

  /** -1 when the file is absent (fresh start / after corrupt recovery). */
  private mtimeMs(): number {
    try {
      return statSync(this.path).mtimeMs;
    } catch {
      return -1;
    }
  }

  private load(now: number): GameState {
    const mtimeMs = this.mtimeMs();
    if (this.cache && this.cache.mtimeMs === mtimeMs) return this.cache.state;
    const { state } = loadState(this.path, now);
    // Probe AFTER the load: recovering from a corrupt file renames it away,
    // so the cache must record the post-recovery absence, not the mtime of
    // the file that was just moved aside.
    this.cache = { state, mtimeMs: this.mtimeMs() };
    return state;
  }

  /** Read-only projection: catch up to `now` in memory, never write. */
  read(now: number): GameState {
    return tick(this.load(now), now);
  }

  /**
   * Load (with catch-up), apply `mutate`, atomically save, return the saved
   * state. `mutate` must return the next state; returning the input unchanged
   * still re-saves (stamping savedAt is fine).
   */
  update(mutate: (state: GameState) => GameState, now: number): GameState {
    const next = mutate(tick(this.load(now), now));
    saveState(this.path, next);
    this.cache = { state: next, mtimeMs: this.mtimeMs() };
    return next;
  }
}

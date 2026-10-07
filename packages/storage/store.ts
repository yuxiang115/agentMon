// PetStore — the single mutation funnel (audit §3): every write goes through
// load -> tick(catch-up) -> mutate -> atomic save, and reads project the same
// way without writing (tama96's safe-observer pattern). Stage 3 wraps Pi's
// withFileMutationQueue around this for cross-process safety; Stage 7 can swap
// the funnel for a socket owner without touching the core.

import { tick } from "../core/reducer";
import type { GameState } from "../core/pet";
import { loadState, saveState, statePath } from "./json";

export class PetStore {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  /** Open a store rooted at a directory (state.json inside it). */
  static at(dir: string): PetStore {
    return new PetStore(statePath(dir));
  }

  /** Read-only projection: catch up to `now` in memory, never write. */
  read(now: number): GameState {
    const { state } = loadState(this.path, now);
    return tick(state, now);
  }

  /**
   * Load (with catch-up), apply `mutate`, atomically save, return the saved
   * state. `mutate` must return the next state; returning the input unchanged
   * still re-saves (stamping savedAt is fine).
   */
  update(mutate: (state: GameState) => GameState, now: number): GameState {
    const { state: loaded } = loadState(this.path, now);
    const next = mutate(tick(loaded, now));
    saveState(this.path, next);
    return next;
  }
}

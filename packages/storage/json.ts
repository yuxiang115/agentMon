// Atomic JSON persistence for GameState — the tama96 pattern
// (docs/reference-audit.md §2.3): write-tmp-then-rename so a crash can never
// leave a half-written state, and on a corrupt file back it up and fall back
// to a fresh state rather than crash the host agent.

import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { freshState, type GameState } from "../core/pet";

export function statePath(dir: string): string {
  return join(dir, "state.json");
}

export function saveState(path: string, state: GameState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, path);
}

export type LoadResult = {
  state: GameState;
  /** Set when no usable file existed (fresh start or corrupt-file recovery). */
  recovered?: "missing" | "corrupt";
  /** The backup path a corrupt file was moved to, when applicable. */
  backupPath?: string;
};

function looksValid(s: unknown): s is GameState {
  return (
    typeof s === "object" && s !== null &&
    (s as GameState).version === 1 &&
    typeof (s as GameState).pets === "object" && (s as GameState).pets !== null
  );
}

export function loadState(path: string, now: number): LoadResult {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { state: freshState(now), recovered: "missing" };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!looksValid(parsed)) throw new Error("unrecognized state shape");
    return { state: parsed };
  } catch {
    const backupPath = `${path}.corrupt-${now}`;
    try {
      renameSync(path, backupPath);
    } catch {
      // best effort: even without the rename we still return a fresh state
    }
    return { state: freshState(now), recovered: "corrupt", backupPath };
  }
}

/** True when the directory holds no leftover .tmp write in flight. Test helper. */
export function hasNoTempFiles(dir: string): boolean {
  return readdirSync(dir).every((f) => !f.endsWith(".tmp"));
}

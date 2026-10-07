import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addPet, createPet, freshState, reduceEvent, tick } from "../packages/core";
import { EMOTION_TTL_MS } from "../packages/core/reducer";
import { hasNoTempFiles, loadState, saveState, statePath } from "../packages/storage/json";
import { PetStore } from "../packages/storage/store";

const T0 = 1_700_000_000_000;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentmon-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type GameState = ReturnType<typeof freshState>;

describe("json persistence", () => {
  it("round-trips a state exactly", () => {
    const state = tick(
      reduceEvent(
        addPet(freshState(T0), createPet({ name: "Byte", now: T0 })),
        { type: "CODE_WRITE", ts: T0 + 5 },
      ),
      T0 + 10,
    );
    const path = statePath(dir);
    saveState(path, state);
    expect(loadState(path, T0 + 10).state).toEqual(state);
  });

  it("saves atomically — no .tmp file left behind", () => {
    saveState(statePath(dir), freshState(T0));
    expect(hasNoTempFiles(dir)).toBe(true);
  });

  it("missing file -> fresh state", () => {
    const r = loadState(statePath(dir), T0);
    expect(r.recovered).toBe("missing");
    expect(r.state).toEqual(freshState(T0));
  });

  it("corrupt file -> backed up + fresh fallback, never a crash", () => {
    const path = statePath(dir);
    const garbage = "{not json at all";
    writeFileSync(path, garbage, "utf8");
    const r = loadState(path, T0 + 99);
    expect(r.recovered).toBe("corrupt");
    expect(r.state).toEqual(freshState(T0 + 99));
    // the backup preserves the original bytes for inspection
    expect(r.backupPath).toBeTruthy();
    expect(readFileSync(r.backupPath!, "utf8")).toBe(garbage);
  });
});

describe("PetStore funnel (load -> catch-up -> mutate -> save)", () => {
  it("update persists events; read projects without writing", () => {
    const store = PetStore.at(dir);
    const withPet = store.update((s) => addPet(s, createPet({ name: "Byte", now: T0 })), T0);
    store.update((s) => reduceEvent(s, { type: "READ", ts: T0 + 100 }), T0 + 100);
    store.update((s) => reduceEvent(s, { type: "CODE_WRITE", ts: T0 + 200 }), T0 + 200);

    const read = store.read(T0 + 200);
    expect(read.pets[withPet.pets ? Object.keys(read.pets)[0] : ""].counters.reads).toBe(1);

    // a read-only projection must not alter the file
    store.read(T0 + 999_999);
    const again = store.read(T0 + 999_999);
    expect(again.savedAt).toBe(T0 + 999_999); // catch-up bumps savedAt in memory
    const disk = loadState(store.path, T0 + 999_999).state;
    expect(disk.savedAt).toBe(T0 + 200); // ...but never writes it back
  });

  it("catch-up on load: an expired emotion and elapsed age replay in one tick", () => {
    const store = PetStore.at(dir);
    const withPet = store.update((s) => addPet(s, createPet({ name: "Byte", now: T0 })), T0);
    const petId = Object.keys(withPet.pets)[0];
    store.update((s) => reduceEvent(s, { type: "TEST_PASS", ts: T0 + 50 }), T0 + 50); // happy

    const hourLater = T0 + 3_600_000;
    const projected = store.read(hourLater);
    const pet = projected.pets[petId];
    expect(pet.activity).toBe("idle"); // emotion expired during the gap
    expect(pet.counters.testsPassed).toBe(1); // events preserved
    expect(pet.ageMs).toBeGreaterThanOrEqual(3_600_000 - EMOTION_TTL_MS);
  });

  it("survives a corrupt store file by starting fresh", () => {
    const store = PetStore.at(dir);
    writeFileSync(store.path, "garbage", "utf8");
    const next = store.update((s) => addPet(s, createPet({ name: "Byte", now: T0 })), T0);
    expect(Object.keys(next.pets)).toHaveLength(1);
    expect(store.read(T0).pets).toEqual(next.pets);
  });
});

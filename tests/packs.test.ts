import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPetPacks } from "../pets/packs";
import {
  registerSpecies,
  resetCustomSpecies,
  speciesFor,
  speciesSource,
} from "../pets/registry";
import {
  evolutionTarget,
  registerEvolutionRules,
  resetCustomEvolutionRules,
} from "../packages/core/evolution";
import { addPet, createPet, freshState, type PetState } from "../packages/core/pet";
import { BYTE } from "../pets/sprites/byte";

const T0 = 1_700_000_000_000;

let root: string;
let packsDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agentmon-packs-"));
  packsDir = join(root, "pets");
  resetCustomSpecies();
  resetCustomEvolutionRules();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  resetCustomSpecies();
  resetCustomEvolutionRules();
});

/** A complete valid species entry, derived from ORIGINAL art (BYTE). */
function validSpeciesBody(id: string, name = id): Record<string, unknown> {
  return {
    id,
    name,
    stage: "branch",
    poses: BYTE.poses,
  };
}

function writePack(slug: string, body: unknown): void {
  const dir = join(packsDir, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pack.json"), JSON.stringify(body), "utf8");
}

describe("loadPetPacks", () => {
  it("missing directory is an empty, error-free result", () => {
    const r = loadPetPacks(join(root, "nope"));
    expect(r.packs).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it("loads a valid pack with species and evolution rules", () => {
    writePack("mypack", {
      name: "My Pack",
      species: [validSpeciesBody("sparky", "Sparky")],
      evolutions: [
        { from: "byte", to: "sparky", gates: { minLevel: 2, axis: "research", minTraitShare: 0.3, minTasks: 1, maxCareMistakes: 5 } },
      ],
    });
    const r = loadPetPacks(packsDir);
    expect(r.errors).toEqual([]);
    expect(r.packs[0].name).toBe("My Pack");
    expect(r.species.map((s) => s.id)).toEqual(["sparky"]);

    registerSpecies(...r.species);
    registerEvolutionRules(r.rules);
    expect(speciesFor("sparky").name).toBe("Sparky");
    expect(speciesSource("sparky")).toBe("pack");

    const pet = createPet({ name: "Byte", now: T0 });
    pet.counters.xp = 150; // level 2
    pet.counters.tasksCompleted = 1;
    pet.traits = { research: 9, implementation: 1, validation: 0 };
    expect(evolutionTarget(pet)).toBe("sparky");
  });

  it("accepts 0/1 pixels like tuipet's extracted frames", () => {
    const zeroOnePoses = Object.fromEntries(
      Object.entries(BYTE.poses).map(([k, rows]) => [
        k,
        rows.map((r) => r.replaceAll("#", "1").replaceAll(".", "0")),
      ]),
    );
    writePack("binary", { species: [{ id: "binpet", poses: zeroOnePoses }] });
    const r = loadPetPacks(packsDir);
    expect(r.errors).toEqual([]);
    expect(r.species[0].id).toBe("binpet");
  });

  it("rejects invalid poses with a precise error, keeps valid siblings", () => {
    const shortPose = { ...BYTE.poses, idleA: BYTE.poses.idleA.slice(0, 15) };
    writePack("broken", { species: [{ id: "badpet", poses: shortPose }] });
    writePack("fine", { species: [validSpeciesBody("goodpet")] });
    const r = loadPetPacks(packsDir);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toContain("badpet");
    expect(r.errors[0]).toContain("idleA");
    expect(r.species.map((s) => s.id)).toEqual(["goodpet"]);
  });

  it("rejects malformed pack.json and non-array species without crashing", () => {
    mkdirSync(join(packsDir, "notjson"), { recursive: true });
    writeFileSync(join(packsDir, "notjson", "pack.json"), "{oops", "utf8");
    writePack("nospecies", { name: "No Species" });
    const r = loadPetPacks(packsDir);
    expect(r.errors.some((e) => e.startsWith("notjson:"))).toBe(true);
    expect(r.errors.some((e) => e.startsWith("nospecies:"))).toBe(true);
    expect(r.packs).toEqual([]);
  });

  it("rejects bad ids and bad gates", () => {
    writePack("weird", {
      species: [validSpeciesBody("Bad_Id!")],
      evolutions: [
        { from: "byte", to: "x", gates: { minLevel: 0, axis: "research", minTraitShare: 0.5, minTasks: 1, maxCareMistakes: 1 } },
      ],
    });
    const r = loadPetPacks(packsDir);
    expect(r.errors.some((e) => e.includes("Bad_Id"))).toBe(true);
    expect(r.errors.some((e) => e.includes("minLevel"))).toBe(true);
  });

  it("drops evolution rules referencing unknown species", () => {
    writePack("ghostlink", {
      species: [validSpeciesBody("realone")],
      evolutions: [
        { from: "byte", to: "does-not-exist", gates: { minLevel: 1, axis: "research", minTraitShare: 0.5, minTasks: 1, maxCareMistakes: 1 } },
      ],
    });
    const r = loadPetPacks(packsDir);
    expect(r.rules).toEqual([]);
    expect(r.errors.some((e) => e.includes("does-not-exist"))).toBe(true);
  });

  it("a pack may reskin a built-in id", () => {
    writePack("reskin", { species: [{ ...validSpeciesBody("byte", "Not Byte") }] });
    const r = loadPetPacks(packsDir);
    registerSpecies(...r.species);
    expect(speciesFor("byte").name).toBe("Not Byte");
    expect(speciesSource("byte")).toBe("pack");
  });
});

describe("extension integration — /pet list and /pet use", () => {
  // Minimal mock mirroring tests/pi-extension.test.ts
  class MockPi {
    handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
    commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
    on(event: string, handler: (event: never, ctx: never) => unknown): () => void {
      this.handlers.set(event, handler as (event: unknown, ctx: unknown) => unknown);
      return () => this.handlers.delete(event);
    }
    registerCommand(name: string, opts: { handler: (args: string, ctx: unknown) => Promise<void> }) {
      this.commands.set(name, opts);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = (over: Record<string, unknown> = {}): any => ({
    mode: "tui",
    hasUI: true,
    cwd: "/repo",
    sessionManager: { getSessionFile: () => "/sessions/s1.jsonl" },
    ui: { setWidget: vi.fn(), notify: vi.fn(), custom: vi.fn() },
    ...over,
  });

  async function boot(stateDir: string, dir: string) {
    const mod = await import("../packages/pi-extension");
    const pi = new MockPi();
    mod.default(pi as never, { stateDir, packsDir: dir, now: () => T0, tickMs: 1_000_000_000 });
    return pi;
  }

  it("a dropped-in pack appears in /pets list and /pet use swaps the species on disk", async () => {
    writePack("mypack", { species: [validSpeciesBody("sparky", "Sparky")] });
    const stateDir = join(root, "state");
    const pi = await boot(stateDir, packsDir);
    pi.handlers.get("session_start")!({}, ctx());

    const listCtx = ctx();
    await pi.commands.get("pet")!.handler("list", listCtx);
    expect(listCtx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("sparky"),
      "info",
    );

    const useCtx = ctx();
    await pi.commands.get("pet")!.handler("use sparky", useCtx);
    expect(useCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Sparky"), "info");
    const saved = JSON.parse(readFileSync(join(stateDir, "state.json"), "utf8"));
    expect(saved.pets[saved.activePetId].species).toBe("sparky");
    expect(saved.pets[saved.activePetId].activity).toBe("happy");
  });

  it("/pet use of an unknown species warns instead of crashing", async () => {
    const stateDir = join(root, "state2");
    const pi = await boot(stateDir, join(root, "empty-packs"));
    pi.handlers.get("session_start")!({}, ctx());
    const useCtx = ctx();
    await pi.commands.get("pet")!.handler("use nope", useCtx);
    expect(useCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("unknown species"), "warning");
  });
});

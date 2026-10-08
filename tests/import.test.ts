import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { importPetPack } from "../pets/packs";
import { BYTE } from "../pets/sprites/byte";
import { resetCustomSpecies, speciesSource } from "../pets/registry";

let root: string;
let petsDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agentmon-import-"));
  petsDir = join(root, "pets");
  resetCustomSpecies();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  resetCustomSpecies();
});

const validPack = (id = "sparky") => ({
  name: `Import ${id}`,
  species: [{ id, name: id, stage: "branch", poses: BYTE.poses }],
});

describe("importPetPack", () => {
  it("installs a pack.json file, validates, and reports species", () => {
    const src = join(root, "dl.json");
    writeFileSync(src, JSON.stringify(validPack()), "utf8");
    const r = importPetPack(src, petsDir);
    expect(r.ok).toBe(true);
    expect(r.slug).toBe("import-sparky");
    expect(existsSync(join(petsDir, "import-sparky", "pack.json"))).toBe(true);
    expect(r.species?.map((s) => s.id)).toEqual(["sparky"]);
    expect(r.errors).toEqual([]);
  });

  it("installs from a directory containing pack.json", () => {
    const dir = join(root, "apack");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pack.json"), JSON.stringify(validPack("dirpet")), "utf8");
    const r = importPetPack(dir, petsDir);
    expect(r.ok).toBe(true);
    expect(r.species?.[0]?.id).toBe("dirpet");
  });

  it("converts a gzipped tuipet extraction when names are given", () => {
    const frames = Array.from({ length: 11 }, (_, i) =>
      Array.from({ length: 16 }, (_, y) => ("1".repeat(i + 1) + (y % 2)).padEnd(16, "0").slice(0, 16)),
    );
    const src = join(root, "sprites.json.gz");
    writeFileSync(src, gzipSync(JSON.stringify([{ name: "Testmon", stage: "Rookie", frames }])), "utf8");

    const noNames = importPetPack(src, petsDir);
    expect(noNames.ok).toBe(false);
    expect(noNames.errors[0]).toContain("creature names");

    const r = importPetPack(src, petsDir, { names: ["Testmon"], chain: true });
    expect(r.ok).toBe(true);
    expect(r.species?.[0]?.id).toBe("testmon");
    expect(r.rules?.length).toBe(1); // byte -> testmon
  });

  it("rolls back an invalid pack instead of leaving it installed", () => {
    const broken = validPack("broken");
    (broken.species[0] as { poses: unknown }).poses = { ...BYTE.poses, idleA: BYTE.poses.idleA.slice(0, 15) };
    const src = join(root, "broken.json");
    writeFileSync(src, JSON.stringify(broken), "utf8");
    const r = importPetPack(src, petsDir);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("idleA");
    expect(existsSync(join(petsDir, "import-broken"))).toBe(false);
  });

  it("missing path and garbage files fail cleanly", () => {
    expect(importPetPack(join(root, "nope.json"), petsDir).ok).toBe(false);
    const junk = join(root, "junk.json");
    writeFileSync(junk, "{{{", "utf8");
    const r = importPetPack(junk, petsDir);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("not valid JSON");
  });
});

describe("/pet import through the extension", () => {
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
    cwd: root,
    sessionManager: { getSessionFile: () => "/sessions/s1.jsonl" },
    ui: { setWidget: vi.fn(), setStatus: vi.fn(), notify: vi.fn(), custom: vi.fn() },
    ...over,
  });

  it("imports a pack file and the species is immediately usable", async () => {
    const src = join(root, "dl.json");
    writeFileSync(src, JSON.stringify(validPack()), "utf8");
    const stateDir = join(root, "state");
    const mod = await import("../packages/pi-extension");
    const pi = new MockPi();
    mod.default(pi as never, { stateDir, packsDir: petsDir, now: () => 1, tickMs: 1_000_000_000 });
    pi.handlers.get("session_start")!({}, ctx());

    const c = ctx();
    await pi.commands.get("pet")!.handler(`import ${src}`, c);
    expect(c.ui.notify).toHaveBeenCalledWith(expect.stringContaining("sparky"), "info");
    expect(speciesSource("sparky")).toBe("pack");

    await pi.commands.get("pet")!.handler("use sparky", ctx());
    const saved = JSON.parse(readFileSync(join(stateDir, "state.json"), "utf8"));
    expect(saved.pets[saved.activePetId].species).toBe("sparky");
  });

  it("a bad import warns and installs nothing", async () => {
    const stateDir = join(root, "state2");
    const mod = await import("../packages/pi-extension");
    const pi = new MockPi();
    mod.default(pi as never, { stateDir, packsDir: petsDir, now: () => 1, tickMs: 1_000_000_000 });
    pi.handlers.get("session_start")!({}, ctx());

    const c = ctx();
    await pi.commands.get("pet")!.handler(`import ${join(root, "ghost.json")}`, c);
    expect(c.ui.notify).toHaveBeenCalledWith(expect.stringContaining("import failed"), "warning");
    expect(existsSync(petsDir)).toBe(false);
  });
});

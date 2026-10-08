import { join } from "node:path";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import agentmon from "./packages/pi-extension";
import { stripAnsi } from "./packages/renderer/src/halfblock";

const base = join(homedir(), ".pi", "agent", "agentmon");
const packPath = join(base, "pets", "agumon-pack", "pack.json");

class MockPi {
  handlers = new Map<string, (e: unknown, ctx: unknown) => unknown>();
  commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  on(event: string, h: (e: never, ctx: never) => unknown) { this.handlers.set(event, h as never); return () => this.handlers.delete(event); }
  registerCommand(name: string, o: { handler: (args: string, ctx: unknown) => Promise<void> }) { this.commands.set(name, o); }
}
const overlayCalls: unknown[] = [];
let overlayComp: { render(w: number): string[] } | null = null;
const ctx = () => ({
  mode: "tui", hasUI: true, cwd: process.cwd(),
  sessionManager: { getSessionFile: () => "/sessions/verify.jsonl" },
  ui: {
    setWidget: (key: string, factory: (tui: unknown, theme: unknown) => unknown) => {
      if (key === "agentmon-bridge") {
        factory(
          {
            requestRender: () => {},
            showOverlay: (c: { render(w: number): string[] }) => { overlayComp = c; overlayCalls.push(c); return { hide: () => {}, setHidden: () => {}, isHidden: () => false }; },
          },
          {},
        );
      }
    },
    setStatus: () => {},
    notify: (msg: string, kind: string) => console.log(`[notify ${kind}] ${msg}`),
    custom: async () => undefined,
  },
});

const pi = new MockPi();
agentmon(pi as never, { stateDir: base, packsDir: join(base, "pets"), tickMs: 1_000_000_000 });
pi.handlers.get("session_start")!({}, ctx());
console.log("— session started, widget installed:", !!overlayComp);

const pets = pi.commands.get("pets")!;
await pets.handler(`import ${packPath}`, ctx());
await pets.handler("use agumon", ctx());
await pets.handler("list", ctx());

const state = JSON.parse(readFileSync(join(base, "state.json"), "utf8"));
const pet = state.pets[state.activePetId];
console.log(`\n— state.json: species=${pet.species} activity=${pet.activity} xp=${pet.counters.xp}`);

if (overlayComp) {
  const lines = overlayComp.render(36);
  console.log(`\n— top-right overlay render (${lines.length} rows, colour codes visible):`);
  for (const l of lines) console.log(l);
  console.log("\n— visible structure (ANSI stripped):");
  for (const l of lines) console.log(stripAnsi(l));
}

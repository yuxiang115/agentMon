// agentMon's Pi extension entry — the ONLY file that touches Pi at runtime
// boundary level (everything below adapters/ is Pi-free; audit §3.1).
//
// Install into Pi:
//   pi install git:github.com/yuxiang115/agentMon
// The pet rides along: reads/writes/tests drive it, a non-capturing LCD panel
// floats top-right (pi-pets' overlay trick), the footer carries a compact
// status, and /pet does everything — no args opens the full view, subcommands
// manage species, size (16-60), the panel, and imports.
//
// The default state dir mirrors Pi's agent-dir resolution (PI_CODING_AGENT_DIR
// env override, ~/.pi/agent otherwise) without importing the coding-agent
// runtime — types only, so unit tests never load Pi's process machinery.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  addPet,
  createPet,
  levelFromXp,
  reduceEvent,
  EMOTION_TTL_MS,
  type GameState,
} from "../core";
import type { CodingEvent } from "../events/types";
import { PetStore } from "../storage/store";
import { PiAdapter, type EventContext } from "../adapters/pi/map";
import { installPetDisplay, petSizeOf, clampPetSize, type PetDisplayHandle } from "./widget";
import { openPetView } from "./petview";
import { openDebugView, type TraceEntry } from "./debug";
import { mulberry32 } from "../renderer/src/animation";
import { loadPetPacks, importPetPack } from "../../pets/packs";
import {
  allSpecies,
  registerSpecies,
  speciesFor,
  speciesSource,
} from "../../pets/registry";
import { registerEvolutionRules, type EvolutionRule } from "../core/evolution";

export interface AgentMonOptions {
  /** Where state.json lives. Default: <pi agent dir>/agentmon. */
  stateDir?: string;
  /** Where pet packs live. Default: <state dir>/pets (docs/pet-packs.md). */
  packsDir?: string;
  /** Injected clock for tests. */
  now?: () => number;
  /** Animation tick for tests (huge values freeze the loop). */
  tickMs?: number;
}

function defaultStateDir(): string {
  const base = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  return join(base, "agentmon");
}

export default function agentmon(pi: ExtensionAPI, options: AgentMonOptions = {}): void {
  const now = options.now ?? Date.now;
  const store = new PetStore(join(options.stateDir ?? defaultStateDir(), "state.json"));
  const packsDir = options.packsDir ?? join(dirname(store.path), "pets");
  const adapter = new PiAdapter();
  const rng = mulberry32((now() & 0xffffffff) >>> 0);
  let display: PetDisplayHandle | undefined;
  let ui: ExtensionContext["ui"] | null = null;
  let packsLoaded = false;
  /** Ring of recent raw-Pi-event -> mapped-event decisions, for /pets debug. */
  const trace: TraceEntry[] = [];
  const TRACE_LIMIT = 50;
  /** Subcommands of the single /pet command (no args = full view). */
  const PET_SUBS = ["list", "use", "size", "import", "ui", "rename", "debug", "help"];
  /** Evolution rules register once per pack slug (imports may re-run loading). */
  const registeredRuleSlugs = new Set<string>();

  function registerPackRules(slug: string, rules: readonly EvolutionRule[]): void {
    if (!rules.length || registeredRuleSlugs.has(slug)) return;
    registeredRuleSlugs.add(slug);
    registerEvolutionRules([...rules]);
  }

  function traced(source: string, mapped: string[]): void {
    trace.push({ at: now(), source, mapped });
    if (trace.length > TRACE_LIMIT) trace.shift();
  }

  function loadPacks(ctx: ExtensionContext): void {
    if (packsLoaded) return;
    packsLoaded = true;
    const packs = loadPetPacks(packsDir);
    if (packs.species.length) registerSpecies(...packs.species);
    for (const pack of packs.packs) registerPackRules(pack.slug, pack.rules);
    for (const pack of packs.packs) {
      console.warn(`agentMon: pet pack "${pack.name}" loaded (${pack.species.length} species)`);
    }
    for (const error of packs.errors) console.warn(`agentMon: pet pack problem — ${error}`);
    if (packs.errors.length) {
      ctx.ui?.notify?.(
        `agentMon: ${packs.errors.length} pet-pack problem(s) — see docs/pet-packs.md`,
        "warning",
      );
    }
  }

  function footerStatus(state: GameState): string {
    const pet = state.activePetId ? state.pets[state.activePetId] : undefined;
    if (!pet) return "agentMon";
    return `${pet.name} Lv.${levelFromXp(pet.counters.xp)} · ${pet.activity}`;
  }

  /** The single mutation path: events -> reducer -> atomic save (audit §3.3). */
  function apply(events: CodingEvent[]): void {
    if (!events.length) return;
    const state = store.update((s) => events.reduce(reduceEvent, s), now());
    display?.refresh(state);
    ui?.setStatus?.("agentmon", footerStatus(state));
  }

  function ensurePet(): GameState {
    return store.update((s) => {
      return s.activePetId && s.pets[s.activePetId] ? s : addPet(s, createPet({ name: "Byte", now: now() }));
    }, now());
  }

  function metaFrom(ctx: ExtensionContext): EventContext {
    return {
      sessionId: ctx.sessionManager?.getSessionFile?.(),
      project: ctx.cwd,
    };
  }

  pi.on("session_start", (_event, ctx) => {
    loadPacks(ctx);
    ui = ctx.ui;
    ensurePet();
    const evs = adapter.onSessionStart(now(), metaFrom(ctx));
    traced("session_start", evs.map((e) => e.type));
    apply(evs);
    if (ctx.hasUI && !display) {
      display = installPetDisplay(ctx, () => store.read(now()), {
        tickMs: options.tickMs,
        rng,
        size: petSizeOf(store.read(now())),
      });
    }
  });

  pi.on("agent_start", (_event, ctx) => {
    const evs = adapter.onAgentStart(now(), metaFrom(ctx));
    traced("agent_start", evs.map((e) => e.type));
    apply(evs);
  });

  pi.on("agent_end", (_event, ctx) => {
    const evs = adapter.onAgentEnd(now(), metaFrom(ctx));
    traced("agent_end", evs.map((e) => e.type));
    apply(evs);
  });

  pi.on("tool_call", (event, ctx) => {
    const evs = adapter.onToolCall(
      { toolCallId: event.toolCallId, toolName: event.toolName, input: event.input as Record<string, unknown> },
      now(),
      metaFrom(ctx),
    );
    traced(`tool_call:${event.toolName}`, evs.map((e) => e.type));
    apply(evs);
  });

  pi.on("tool_execution_end", (event, ctx) => {
    const evs = adapter.onToolResult(
      { toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError },
      now(),
      metaFrom(ctx),
    );
    traced(`tool_execution_end:${event.toolName}`, evs.map((e) => e.type));
    apply(evs);
  });

  pi.on("agent_settled", (_event, ctx) => {
    const evs = adapter.onAgentSettled(now(), metaFrom(ctx));
    traced("agent_settled", evs.map((e) => e.type));
    apply(evs);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    const evs = adapter.onSessionShutdown(now(), metaFrom(ctx));
    traced("session_shutdown", evs.map((e) => e.type));
    apply(evs);
    display?.dispose();
    display = undefined;
    ui?.setStatus?.("agentmon", undefined);
    ui = null;
  });

  // ONE command: /pet with subcommands (the old /pets was folded in here).
  pi.registerCommand("pet", {
    description: "agentMon pet — full view · list · use <species> · size <16-60> · import <path> · ui · rename <name> · debug",
    getArgumentCompletions: (prefix: string) => {
      const p = prefix.trim();
      if (p.startsWith("use")) {
        const partial = p.slice(3).trim();
        return allSpecies()
          .filter((s) => s.id.startsWith(partial))
          .map((s) => ({
            value: `use ${s.id}`,
            label: s.id,
            insertValue: `use ${s.id}`,
            description: `${s.name} (${speciesSource(s.id)})`,
          }));
      }
      if (p.startsWith("size")) {
        const partial = p.slice(4).trim();
        return [16, 24, 32, 40, 48, 60]
          .filter((n) => String(n).startsWith(partial))
          .map((n) => ({ value: `size ${n}`, label: String(n), insertValue: `size ${n}` }));
      }
      return PET_SUBS.filter((s) => s.startsWith(p)).map((s) => ({ value: s, label: s }));
    },
    handler: async (args: string, ctx: ExtensionContext) => {
      loadPacks(ctx);
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const sub = parts[0] ?? "";

      // /pet with no arguments = the full-screen view
      if (!sub) {
        ensurePet();
        if (ctx.mode !== "tui" || !ctx.hasUI) {
          ctx.ui?.notify?.("agentMon: /pet needs the interactive TUI", "warning");
          return;
        }
        await openPetView(ctx, () => store.read(now()), { tickMs: options.tickMs });
        return;
      }

      if (sub === "help") {
        ctx.ui?.notify?.(
          "agentMon /pet — no args: full view · list: species · use <id>: wear a form · size <16-60>: sprite size · import <path> [names]: add a pack · ui: toggle the panel · rename <name> · debug: event trace",
          "info",
        );
        return;
      }

      if (sub === "list") {
        const list = allSpecies()
          .map((s) => `${s.id} (${s.name}, ${speciesSource(s.id)})`)
          .join(", ");
        ctx.ui?.notify?.(`agentMon species: ${list}`, "info");
        return;
      }

      if (sub === "use" && parts[1]) {
        const id = parts[1];
        if (speciesSource(id) === "unknown") {
          ctx.ui?.notify?.(
            `agentMon: unknown species "${id}" — /pet list shows what's available`,
            "warning",
          );
          return;
        }
        const species = speciesFor(id);
        const state = store.update((s) => {
          const pet = s.activePetId ? s.pets[s.activePetId] : undefined;
          if (!pet) return s;
          const next = {
            ...pet,
            species: id,
            activity: "happy" as const,
            activitySince: now(),
            emotionUntil: now() + EMOTION_TTL_MS,
          };
          return { ...s, pets: { ...s.pets, [pet.id]: next } };
        }, now());
        display?.refresh(state);
        ui?.setStatus?.("agentmon", footerStatus(state));
        ctx.ui?.notify?.(`agentMon: your pet is now a ${species.name}!`, "info");
        return;
      }

      if (sub === "size") {
        if (!parts[1]) {
          ctx.ui?.notify?.(
            `agentMon: pet size is ${petSizeOf(store.read(now()))} — /pet size <${16}-${60}> (pixels)`,
            "info",
          );
          return;
        }
        const parsed = Number(parts[1]);
        if (!Number.isFinite(parsed)) {
          ctx.ui?.notify?.("agentMon: size must be a number 16-60", "warning");
          return;
        }
        const n = clampPetSize(parsed);
        const state = store.update((s) => ({ ...s, ui: { ...s.ui, petSize: n } }), now());
        display?.setSize(n);
        display?.refresh(state);
        ctx.ui?.notify?.(`agentMon: pet size ${n} (16-60)`, "info");
        return;
      }

      if (sub === "import" && parts[1]) {
        const src = resolve(ctx.cwd ?? process.cwd(), parts[1]);
        const names = parts
          .slice(2)
          .join(" ")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const result = importPetPack(src, packsDir, { names, chain: true });
        if (!result.ok) {
          ctx.ui?.notify?.(`agentMon: import failed — ${result.errors.join("; ")}`, "warning");
          return;
        }
        if (result.species?.length) registerSpecies(...result.species);
        if (result.slug) registerPackRules(result.slug, result.rules ?? []);
        const ids = result.species?.map((s) => s.id).join(", ") ?? "";
        ctx.ui?.notify?.(
          `agentMon: imported ${ids} — /pet use <id> to wear it${result.errors.length ? ` (other packs have problems: ${result.errors.length})` : ""}`,
          "info",
        );
        return;
      }

      if (sub === "ui") {
        const visible = display?.toggle() ?? false;
        ctx.ui?.notify?.(`agentMon: pet panel ${visible ? "shown" : "hidden"}`, "info");
        return;
      }

      if (sub === "rename" && parts.length > 1) {
        const name = parts.slice(1).join(" ").slice(0, 24);
        const state = store.update((s) => {
          const pet = s.activePetId ? s.pets[s.activePetId] : undefined;
          if (!pet) return s;
          return { ...s, pets: { ...s.pets, [pet.id]: { ...pet, name } } };
        }, now());
        display?.refresh(state);
        ui?.setStatus?.("agentmon", footerStatus(state));
        ctx.ui?.notify?.(`agentMon: your pet is now called ${name}`, "info");
        return;
      }

      if (sub === "debug") {
        ensurePet();
        if (ctx.mode !== "tui" || !ctx.hasUI) {
          ctx.ui?.notify?.("agentMon: /pet debug needs the interactive TUI", "warning");
          return;
        }
        await openDebugView(ctx, {
          trace: () => trace,
          lines: () => {
            const state = store.read(now());
            const pet = state.activePetId ? state.pets[state.activePetId] : undefined;
            if (!pet) return ["no pet"];
            const c = pet.counters;
            return [
              ` pet: ${pet.name} (${pet.species}) Lv.${levelFromXp(c.xp)} · activity ${pet.activity} · mode ${pet.behaviorMode.toLowerCase()}`,
              ` counts: reads ${c.reads} · writes ${c.writes} · commands ${c.commands} · tests ${c.testsStarted} (${c.testsPassed}✓/${c.testsFailed}✗) · tasks ${c.tasksCompleted}`,
              ` state file: ${store.path}`,
            ];
          },
        });
        return;
      }

      ctx.ui?.notify?.(`agentMon: unknown /pet subcommand "${sub}" — try /pet help`, "warning");
    },
  });
}

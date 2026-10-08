// agentMon's Pi extension entry — the ONLY file that touches Pi at runtime
// boundary level (everything below adapters/ is Pi-free; audit §3.1).
//
// Install into Pi:
//   pi install git:github.com/yuxiang115/agentMon
// (package.json's "pi" manifest points here). Then the pet rides along:
// reads/writes/tests drive it, a small LCD widget lives below the editor,
// and /pet opens the full view.
//
// The default state dir mirrors Pi's agent-dir resolution (PI_CODING_AGENT_DIR
// env override, ~/.pi/agent otherwise) without importing the coding-agent
// runtime — types only, so unit tests never load Pi's process machinery.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { addPet, createPet, reduceEvent, EMOTION_TTL_MS, type GameState } from "../core";
import type { CodingEvent } from "../events/types";
import { PetStore } from "../storage/store";
import { PiAdapter, type EventContext } from "../adapters/pi/map";
import { installWidget, type PetWidgetHandle } from "./widget";
import { openPetView } from "./petview";
import { mulberry32 } from "../renderer/src/animation";
import { loadPetPacks } from "../../pets/packs";
import {
  allSpecies,
  registerSpecies,
  speciesFor,
  speciesSource,
} from "../../pets/registry";
import { registerEvolutionRules } from "../core/evolution";

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
  let widget: PetWidgetHandle | undefined;
  let packsLoaded = false;

  function loadPacks(ctx: ExtensionContext): void {
    if (packsLoaded) return;
    packsLoaded = true;
    const packs = loadPetPacks(packsDir);
    if (packs.species.length) registerSpecies(...packs.species);
    if (packs.rules.length) registerEvolutionRules(packs.rules);
    for (const pack of packs.packs) {
      console.warn(`agentMon: pet pack "${pack.name}" loaded (${pack.species.length} species)`);
    }
    for (const error of packs.errors) console.warn(`agentMon: pet pack problem — ${error}`);
    if (packs.errors.length) {
      ctx.ui?.notify?.(
        `agentMon: ${packs.errors.length} pet-pack problem(s) — run \`npm run packs\` or see docs/pet-packs.md`,
        "warning",
      );
    }
  }

  function metaFrom(ctx: ExtensionContext): EventContext {
    return {
      sessionId: ctx.sessionManager?.getSessionFile?.(),
      project: ctx.cwd,
    };
  }

  /** The single mutation path: events -> reducer -> atomic save (audit §3.3). */
  function apply(events: CodingEvent[]): void {
    if (!events.length) return;
    const state = store.update((s) => events.reduce(reduceEvent, s), now());
    widget?.refresh(state);
  }

  function ensurePet(): GameState {
    return store.update((s) => {
      return s.activePetId && s.pets[s.activePetId] ? s : addPet(s, createPet({ name: "Byte", now: now() }));
    }, now());
  }

  pi.on("session_start", (_event, ctx) => {
    loadPacks(ctx);
    ensurePet();
    apply(adapter.onSessionStart(now(), metaFrom(ctx)));
    if (ctx.hasUI && !widget) {
      widget = installWidget(ctx, () => store.read(now()), { tickMs: options.tickMs, rng });
    }
  });

  pi.on("tool_call", (event, ctx) => {
    apply(
      adapter.onToolCall(
        { toolCallId: event.toolCallId, toolName: event.toolName, input: event.input as Record<string, unknown> },
        now(),
        metaFrom(ctx),
      ),
    );
  });

  pi.on("tool_execution_end", (event, ctx) => {
    apply(
      adapter.onToolResult(
        { toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError },
        now(),
        metaFrom(ctx),
      ),
    );
  });

  pi.on("agent_settled", (_event, ctx) => {
    apply(adapter.onAgentSettled(now(), metaFrom(ctx)));
  });

  pi.on("session_shutdown", (_event, ctx) => {
    apply(adapter.onSessionShutdown(now(), metaFrom(ctx)));
    widget?.dispose();
    widget = undefined;
  });

  pi.registerCommand("pet", {
    description: "Open the agentMon pet view — or `/pet use <species>` to change form",
    handler: async (args: string, ctx: ExtensionContext) => {
      loadPacks(ctx);
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts[0] === "use" && parts[1]) {
        const id = parts[1];
        if (speciesSource(id) === "unknown") {
          ctx.ui?.notify?.(
            `agentMon: unknown species "${id}" — /pets lists what's available`,
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
        widget?.refresh(state);
        ctx.ui?.notify?.(`agentMon: your pet is now a ${species.name}!`, "info");
        return;
      }
      ensurePet();
      if (ctx.mode !== "tui" || !ctx.hasUI) {
        ctx.ui?.notify?.("agentMon: /pet needs the interactive TUI", "warning");
        return;
      }
      await openPetView(ctx, () => store.read(now()), { tickMs: options.tickMs });
    },
  });

  pi.registerCommand("pets", {
    description: "List every agentMon species (built-ins + local pet packs)",
    handler: async (_args: string, ctx: ExtensionContext) => {
      loadPacks(ctx);
      const list = allSpecies()
        .map((s) => `${s.id} (${s.name}, ${speciesSource(s.id)})`)
        .join(", ");
      ctx.ui?.notify?.(`agentMon species: ${list}`, "info");
    },
  });
}

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
import { join } from "node:path";
import { activePet, addPet, createPet, reduceEvent, type GameState } from "../core";
import type { CodingEvent } from "../events/types";
import { PetStore } from "../storage/store";
import { PiAdapter, type EventContext } from "../adapters/pi/map";
import { installWidget, type PetWidgetHandle } from "./widget";
import { openPetView } from "./petview";
import { mulberry32 } from "../renderer/src/animation";

export interface AgentMonOptions {
  /** Where state.json lives. Default: <pi agent dir>/agentmon. */
  stateDir?: string;
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
  const adapter = new PiAdapter();
  const rng = mulberry32((now() & 0xffffffff) >>> 0);
  let widget: PetWidgetHandle | undefined;

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
    description: "Open the agentMon pet view",
    handler: async (_args: string, ctx: ExtensionContext) => {
      ensurePet();
      if (ctx.mode !== "tui" || !ctx.hasUI) {
        ctx.ui?.notify?.("agentMon: /pet needs the interactive TUI", "warning");
        return;
      }
      await openPetView(ctx, () => store.read(now()), { tickMs: options.tickMs });
    },
  });
}

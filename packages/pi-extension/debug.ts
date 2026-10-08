// /pets debug — live event-linkage inspector: shows the raw Pi events that
// arrived, what they mapped to, and what the pet did. Exactly the tool for
// answering "is the pet reacting to the agent?" on a real session.

import type { Component, TUI } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateVisible } from "./widget";

export interface TraceEntry {
  at: number;
  source: string; // raw Pi event name
  mapped: string[]; // normalized event types emitted
}

export interface DebugViewOptions {
  trace: () => readonly TraceEntry[];
  lines: () => string[]; // header/summary lines
}

export async function openDebugView(
  ctx: ExtensionContext,
  opts: DebugViewOptions,
): Promise<undefined> {
  await ctx.ui.custom<undefined>((tui: TUI, _theme, _keybindings, done) => {
    return new DebugScreen(tui, done, opts);
  });
}

class DebugScreen implements Component {
  constructor(
    private tui: Pick<TUI, "requestRender">,
    private done: (result: undefined) => void,
    private opts: DebugViewOptions,
  ) {}

  render(width: number): string[] {
    const lines = [
      " agentMon — event linkage debug",
      "",
      ...this.opts.lines(),
      "",
      " recent events (newest last):",
    ];
    const trace = this.opts.trace();
    if (!trace.length) lines.push("   (nothing yet — do some agent work and reopen)");
    for (const e of trace.slice(-30)) {
      const at = new Date(e.at).toISOString().slice(11, 19);
      const mapped = e.mapped.length ? e.mapped.join(",") : "—";
      lines.push(`   ${at}  ${e.source.padEnd(20)} -> ${mapped}`);
    }
    lines.push("", " q / ESC — close");
    return lines.map((l) => truncateVisible(l, width));
  }

  handleInput(data: string): void {
    if (data === "q" || data === "Q" || data === "\x1b") {
      this.done(undefined);
    }
  }

  invalidate(): void {
    // nothing cached
  }

  dispose(): void {
    // no timers — the view is a snapshot
  }
}

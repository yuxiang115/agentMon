// Stage 1 deliverable — the "codepet demo" (plan.md §19): the original
// creature on its 32x16 LCD, in every activity.
//
//   npm run demo             static panel sheet (ANSI, LCD look)
//   npm run demo -- --live   10 Hz animated loop: roaming + activity cycling
//   npm run demo -- --plain  static, plain four-glyph text (pipe/CI-safe)

import {
  bitmapText,
  renderScene,
  renderScreen,
  Roamer,
  mulberry32,
  pickFrame,
  SLEEP_BEAT,
  stripAnsi,
  styleLines,
  TICK_MS,
  HOLD,
} from "../packages/renderer/src/index";
import { COLS, CHAR_ROWS, roamBounds } from "../packages/renderer/src/lcd";
import { BYTE } from "../pets/sprites/byte";

const ON = "#2b2e31";
const BG = "#c6c9cc";
const ACTIVITIES = ["idle", "walk", "think", "search", "code", "test", "happy", "sad", "sleep"] as const;
type Activity = (typeof ACTIVITIES)[number];

const plain = process.argv.includes("--plain");
const paint = { on: ON, bg: BG, plain };

function lcdFor(activity: Activity, tick: number, x?: number, mirror?: boolean): string[] {
  const poses = BYTE.roles[activity].map((p) => BYTE.poses[p]);
  const hold = activity === "sleep" ? SLEEP_BEAT : HOLD;
  const frame = pickFrame(poses, tick, hold);
  if (activity === "walk" || activity === "idle") {
    return renderScene([{ frame, xLeft: x ?? 8, mirror }], COLS, CHAR_ROWS, paint);
  }
  return renderScreen(frame, COLS, CHAR_ROWS, paint);
}

function padVisible(line: string, width: number): string {
  return line + " ".repeat(Math.max(0, width - stripAnsi(line).length));
}

function sheet(panels: { title: string; lines: string[]; width: number }[], gap = 3): string {
  const out: string[] = [];
  const h = Math.max(...panels.map((p) => p.lines.length)) + 1;
  for (let y = 0; y < h; y++) {
    const cells = panels.map((p) =>
      y === 0 ? p.title.padEnd(p.width) : padVisible(p.lines[y - 1] ?? "", p.width),
    );
    out.push(cells.join(" ".repeat(gap)));
  }
  return out.join("\n");
}

if (process.argv.includes("--live")) {
  const [minX, maxX] = roamBounds();
  const roamer = new Roamer(8, COLS, 16, mulberry32(Date.now() & 0xffffffff));
  let tick = 0;
  process.on("SIGINT", () => {
    process.stdout.write("\x1b[0m\n");
    process.exit(0);
  });
  // survive a closed pipe (e.g. demo:live | head)
  process.stdout.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EPIPE") process.exit(0);
    throw e;
  });
  setInterval(() => {
    const activity = ACTIVITIES[Math.floor(tick / 40) % ACTIVITIES.length]; // 4 s each
    roamer.step(minX, maxX);
    const lines = lcdFor(activity, tick, roamer.x, roamer.mirror);
    process.stdout.write(
      `\x1b[2J\x1b[HagentMon demo — Byte v0.1 · ${activity} · Ctrl-C to quit\n${lines.join("\n")}\n`,
    );
    tick++;
  }, TICK_MS);
} else {
  const lcd = (activity: Activity, tick = 0) => lcdFor(activity, tick);
  console.log("agentMon Stage 1 demo — Byte, the first original creature (32x16 LCD, half-block renderer)");
  console.log();
  console.log(sheet([
    { title: "idle / roam", lines: lcd("walk", 0), width: 32 },
    { title: "code", lines: lcd("code", 1), width: 32 },
    { title: "test", lines: lcd("test", 0), width: 32 },
  ]));
  console.log();
  console.log(sheet([
    { title: "happy", lines: lcd("happy"), width: 32 },
    { title: "sad", lines: lcd("sad"), width: 32 },
    { title: "sleep", lines: lcd("sleep"), width: 32 },
  ]));
  console.log();
  console.log(sheet([
    {
      title: "4-glyph path (bitmapText)",
      lines: plain ? bitmapText(BYTE.poses.idleA) : styleLines(bitmapText(BYTE.poses.idleA), ON, BG),
      width: 16,
    },
    { title: "think", lines: lcd("think"), width: 32 },
    { title: "search", lines: lcd("search"), width: 32 },
  ]));
  console.log();
  console.log("Animated loop: npm run demo:live   ·   All poses: npm run preview");
}

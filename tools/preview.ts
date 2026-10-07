// Sprite previewer: print every pose of a species as half-block panels.
// agentMon's own tool (tuipet's tools/preview.py and tools/allframes.py are
// broken — they import helpers removed from tuipet's render.py; audit §2.2).
//
//   npm run preview            transparent sprites (default, no LCD plate)
//   npm run preview -- --invert light ink (for dark terminals)
//   npm run preview -- --lcd   paint the LCD plate too
//   npm run preview -- --plain raw glyphs (for piping/CI)

import { bitmapText, styleLines, stripAnsi, type Bitmap } from "../packages/renderer/src/halfblock";
import { BYTE, POSE_NAMES } from "../pets/sprites/byte";

const plain = process.argv.includes("--plain");
const invert = process.argv.includes("--invert");
const plate = process.argv.includes("--lcd");
const ON = invert ? "#c6c9cc" : "#2b2e31";
const BG = plate ? (invert ? "#2b2e31" : "#c6c9cc") : null;
const PER_ROW = 4;

function panel(bitmap: Bitmap): string[] {
  let lines = bitmapText(bitmap);
  if (!plain) lines = styleLines(lines, ON, BG);
  return lines;
}

function padVisible(line: string, width: number): string {
  return line + " ".repeat(Math.max(0, width - stripAnsi(line).length));
}

for (let i = 0; i < POSE_NAMES.length; i += PER_ROW) {
  const group = POSE_NAMES.slice(i, i + PER_ROW);
  const panels = group.map((name) => {
    const lines = panel(BYTE.poses[name]);
    const w = Math.max(16, name.length);
    return [plain ? name.padEnd(w) : name.padEnd(w), ...lines.map((l) => padVisible(l, 16))];
  });
  const h = Math.max(...panels.map((p) => p.length));
  for (let y = 0; y < h; y++) {
    console.log(panels.map((p) => (p[y] !== undefined ? p[y] : " ".repeat(16))).join("  "));
  }
  console.log();
}

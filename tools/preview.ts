// Sprite previewer: print every pose of every species as half-block panels.
// agentMon's own tool (tuipet's tools/preview.py and tools/allframes.py are
// broken — they import helpers removed from tuipet's render.py; audit §2.2).
//
//   npm run preview             ANSI-coloured
//   npm run preview -- --invert light ink (for dark terminals)
//   npm run preview -- --plain  raw glyphs (for piping/CI)

import { bitmapText, styleLines, stripAnsi, type Bitmap } from "../packages/renderer/src/halfblock";
import { SPECIES } from "../pets/registry";

const plain = process.argv.includes("--plain");
const invert = process.argv.includes("--invert");
const ON = invert ? "#c6c9cc" : "#2b2e31";
const BG = invert ? "#2b2e31" : "#c6c9cc";
const PER_ROW = 4;

function panel(bitmap: Bitmap): string[] {
  let lines = bitmapText(bitmap);
  if (!plain) lines = styleLines(lines, ON, BG);
  return lines;
}

function padVisible(line: string, width: number): string {
  return line + " ".repeat(Math.max(0, width - stripAnsi(line).length));
}

for (const species of Object.values(SPECIES)) {
  console.log(
    `${species.name} (${species.id}, ${species.stage})${species.description ? " — " + species.description : ""}`,
  );
  const names = Object.keys(species.poses) as Array<keyof typeof species.poses>;
  for (let i = 0; i < names.length; i += PER_ROW) {
    const group = names.slice(i, i + PER_ROW);
    const panels = group.map((name) => {
      const lines = panel(species.poses[name]);
      return [name.padEnd(16), ...lines.map((l) => padVisible(l, 16))];
    });
    const h = Math.max(...panels.map((p) => p.length));
    for (let y = 0; y < h; y++) {
      console.log(panels.map((p) => (p[y] !== undefined ? p[y] : " ".repeat(16))).join("  "));
    }
  }
  console.log();
}

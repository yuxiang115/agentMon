// Reproducible comparison of source art and the grids sent to the TUI.
// tsx tools/import-preview.ts <source-folder> <before-pack> <after-pack> <out.png>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";
import { poseRowsFor, type SpeciesDef } from "../pets/registry";
import { scaleRows } from "../packages/renderer/src/scale";
import { poseToColorGrid, renderColorScene } from "../packages/renderer/src/colorframe";
import { setColorMode } from "../packages/renderer/src/halfblock";

const [source, beforePath, afterPath, output] = process.argv.slice(2);
if (!output) throw new Error("usage: import-preview <source-folder> <before-pack> <after-pack> <out.png>");
const before: SpeciesDef = JSON.parse(readFileSync(beforePath, "utf8")).species[0];
const after: SpeciesDef = JSON.parse(readFileSync(afterPath, "utf8")).species[0];
const poses = ["idle1", "code1", "happy1", "sleep2"];
const columns = ["SOURCE", "OLD 16", "NEW 16", "OLD 40", "NEW 40", "NEW 48"];
const width = 1080, height = 800, cellW = 180, cellH = 184, top = 45;
const png = new PNG({ width, height });
const colors = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
function pixel(x: number, y: number, rgb: number[]) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const i = (y * width + x) * 4;
  png.data[i] = rgb[0]; png.data[i + 1] = rgb[1]; png.data[i + 2] = rgb[2]; png.data[i + 3] = 255;
}
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixel(x, y, [26, 33, 31]);
const font: Record<string, string> = {
  A:"010101111101101", B:"110101110101110", C:"011100100100011", D:"110101101101110",
  E:"111100110100111", F:"111100110100100", G:"011100101101011", H:"101101111101101",
  I:"111010010010111", J:"001001001101010", K:"101101110101101", L:"100100100100111",
  M:"101111111101101", N:"101111111111101", O:"010101101101010", P:"110101110100100",
  Q:"010101101111011", R:"110101110101101", S:"011100010001110", T:"111010010010010",
  U:"101101101101111", V:"101101101101010", W:"101101111111101", X:"101101010101101",
  Y:"101101010010010", Z:"111001010100111", "0":"111101101101111", "1":"010110010010111",
  "2":"110001010100111", "3":"110001010001110", "4":"101101111001001", "6":"011100111101111", "8":"111101111101111",
};
function text(value: string, x0: number, y0: number) {
  [...value].forEach((char, index) => {
    const glyph = font[char]; if (!glyph) return;
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (glyph[y * 3 + x] === "1") {
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) pixel(x0 + index * 8 + x * 2 + dx, y0 + y * 2 + dy, [216, 232, 213]);
    }
  });
}
columns.forEach((label, i) => text(label, i * cellW + 20, 16));
const ansi: string[] = [];
setColorMode("true");
poses.forEach((pose, row) => {
  const original = PNG.sync.read(readFileSync(join(source, `${pose}.png`)));
  const variants: Array<[SpeciesDef, number]> = [[before, 16], [after, 16], [before, 40], [after, 40], [after, 48]];
  const grids = variants.map(([species, size]) => poseToColorGrid(scaleRows(poseRowsFor(species, pose, size), size), species.palette!, size));
  ansi.push(`${pose} (40px)`, ...renderColorScene([{ grid: grids[3], xLeft: 0 }], 40, 20), "");
  for (let col = 0; col < columns.length; col++) {
    const originX = col * cellW + 10, originY = top + row * cellH;
    const side = 160;
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      let color = [225, 230, 218];
      if (col === 0) {
        const sx = Math.floor(x * original.width / side), sy = Math.floor(y * original.height / side);
        const i = (sy * original.width + sx) * 4;
        color = [original.data[i], original.data[i + 1], original.data[i + 2]];
      } else {
        const grid = grids[col - 1], n = grid.length;
        const value = grid[Math.floor(y * n / side)][Math.floor(x * n / side)];
        if (value) color = colors(value);
      }
      pixel(originX + x, originY + y, color);
    }
    text(pose.toUpperCase(), originX + 8, originY + 166);
  }
});
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, PNG.sync.write(png));
writeFileSync(output.replace(/\.png$/i, ".ansi"), ansi.join("\n"));
console.log(output);

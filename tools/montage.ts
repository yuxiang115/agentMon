// Render every pose of a pack.json to one PNG contact sheet — visual QA for
// imported packs (palette colours, 1:1 pixels, no upscaling).
//
//   npx tsx tools/montage.ts <pack.json> <out.png> [layer]
//   layer: "16" (default, the base poses) or a hi-res layer like "32"/"64"
//
// The image is your responsibility — Digimon art is © Bandai; keep it local.
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const [packPath, outPath, layerArg] = process.argv.slice(2);
if (!packPath || !outPath) {
  console.error("usage: npx tsx tools/montage.ts <pack.json> <out.png> [layer]");
  process.exit(1);
}
const p = JSON.parse(readFileSync(packPath, "utf8"));
const sp = (p.species as Array<Record<string, unknown>>)[0]!;
const pal = (sp.palette ?? {}) as Record<string, string>;
const poses =
  layerArg && layerArg !== "16"
    ? ((sp.hiPoses as Record<string, Record<string, string[]>>)?.[layerArg] ?? sp.poses)
    : (sp.poses as Record<string, string[]>);
if (layerArg && layerArg !== "16" && poses === sp.poses) {
  console.error(`no hi-res layer "${layerArg}" — falling back to the 16x16 base`);
}
const order = Object.keys(poses).sort();
const SIZE = poses[order[0]]?.length ?? 16;
const SCALE = SIZE >= 32 ? 6 : 12, PAD = 6, COLS = 5;
const cellW = SIZE * SCALE + PAD, cellH = SIZE * SCALE + PAD;
const rows = Math.ceil(order.length / COLS);
const png = new PNG({ width: COLS * cellW, height: rows * cellH });
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
for (let y = 0; y < png.height; y++) {
  for (let x = 0; x < png.width; x++) {
    const i = (png.width * y + x) << 2;
    png.data[i] = png.data[i + 1] = png.data[i + 2] = 128;
    png.data[i + 3] = 255;
  }
}
order.forEach((name, idx) => {
  const cx = (idx % COLS) * cellW + PAD / 2;
  const cy = Math.floor(idx / COLS) * cellH + PAD / 2;
  for (const [y, row] of poses[name]!.entries()) {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (ch === ".") continue;
      const [r, g, b] = rgb(pal[ch] ?? "#ff00ff");
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const px = ((cy + y * SCALE + dy) * png.width + cx + x * SCALE + dx) << 2;
          png.data[px] = r;
          png.data[px + 1] = g;
          png.data[px + 2] = b;
          png.data[px + 3] = 255;
        }
      }
    }
  }
});
writeFileSync(outPath, PNG.sync.write(png));
console.log(`wrote ${outPath} (${order.length} poses: ${order.join(" ")})`);

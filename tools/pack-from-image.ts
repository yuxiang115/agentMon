// Generate a pet pack from images — no hand-assembling of character grids.
//
//   npm run pack:from-image -- --img pose-folder/ --name 亚古兽 --id agumon --chain
//   npm run pack:from-image -- --img agumon.png --name Agumon
//   npm run pack:from-image -- --img sheet.png --frames 11 --name Agumon
//
//   --out <dir>        where pets live (default ~/.pi/agent/agentmon/pets)
//   --mono             1-bit extraction (default is full-colour, pi-pets style)
//   --threshold 0-255  mono: luminance margin (default 40); colour: distance from bg (default 60)
//   --chain            wire byte -> this species with gentle gates
//   --stage baby|branch
//
// PNG only (convert other formats first). The image is your responsibility —
// Digimon art is © Bandai; keep it local (docs/pet-packs.md).

import { PNG } from "pngjs";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
  autoPoses,
  buildImagePack,
  dominantInkColor,
  paletteFromHexGrids,
  pngToBitmap,
  pngToHexGrid,
  pngToPosesLayers,
  posesFromFrames,
  posesFromFolder,
  sheetToBitmaps,
  sheetToHexGrids,
} from "../pets/imagepack";
import { loadPetPacks } from "../pets/packs";
import { slugify } from "../pets/convert";

function arg(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
}

const imgArg = arg("--img");
const name = arg("--name");
if (!imgArg || !name) {
  console.error(
    'usage: npm run pack:from-image -- --img <png | pose-folder> --name "Agumon" [--id agumon] [--frames N] [--mono] [--threshold N] [--chain] [--out dir] [--stage branch]',
  );
  process.exit(1);
}
const threshold = Number(arg("--threshold") ?? 60);
const chain = process.argv.includes("--chain");
const mono = process.argv.includes("--mono");
const stage = (arg("--stage") === "baby" ? "baby" : "branch") as "baby" | "branch";
const defaultOut = join(
  process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
  "agentmon",
  "pets",
);
const outDir = arg("--out") ?? defaultOut;

function decode(file: string): PNG {
  const png = PNG.sync.read(readFileSync(file));
  if (!png.width || !png.height) throw new Error(`${file}: empty image`);
  return png;
}

let poses: Record<string, string[]>;
let roles: Record<string, string[]> | undefined;
let ink: string | undefined;
let palette: Record<string, string> | undefined;
let hiPoses: Record<string, Record<string, string[]>> | undefined;
let folder: ReturnType<typeof posesFromFolder> | undefined;
try {
  let entries: Dirent[] | null = null;
  try {
    entries = readdirSync(imgArg, { withFileTypes: true }); // throws when not a directory
  } catch {
    entries = null; // a file — fall through to image decoding
  }

  if (entries && !imgArg.toLowerCase().endsWith(".png")) {
    // pose folder: idle1.png idle2.png ... code1.png ... (any subset, idle required)
    folder = posesFromFolder(imgArg, { threshold, color: !mono });
    if (folder.error) {
      console.error(`✗ ${imgArg}: ${folder.error}`);
      process.exit(1);
    }
    poses = folder.poses;
    roles = folder.roles;
    ink = folder.ink;
    palette = folder.palette;
    hiPoses = folder.hiPoses;
    console.log(
      `pose folder (${mono ? "mono" : "colour"}): ` +
        Object.entries(folder.counts)
          .map(([a, n]) => `${a}×${n}`)
          .join(" ") +
        " (missing activities fall back to idle)",
    );
  } else {
    if (!existsSync(imgArg)) {
      console.error(`✗ ${imgArg}: not found`);
      process.exit(1);
    }
    const png = decode(imgArg);
    const framesArg = arg("--frames");
    if (mono) {
      ink = dominantInkColor(png, { threshold });
      if (framesArg && Number(framesArg) >= 2) {
        poses = posesFromFrames(sheetToBitmaps(png, Number(framesArg), { threshold }));
        console.log(`sheet: ${framesArg} frames -> poses (mono)`);
      } else {
        poses = autoPoses(pngToBitmap(png, { threshold }));
        console.log("single image: 11 poses auto-derived, mono (bounces/mirror)");
      }
    } else {
      const framesArg = arg("--frames");
      if (!framesArg && !mono) {
        // single image: derive poses at EVERY layer from the one source
        const layered = pngToPosesLayers(png, { threshold });
        poses = layered.poses;
        palette = layered.palette;
        hiPoses = layered.hiPoses;
        console.log(
          `single image: colour, ${Object.keys(palette).length} colours, 11 poses auto-derived (bounces/mirror) + hi-res layers`,
        );
      } else {
        const grids =
          framesArg && Number(framesArg) >= 2
            ? sheetToHexGrids(png, Number(framesArg), { threshold })
            : [pngToHexGrid(png, { threshold })];
        const built = paletteFromHexGrids(grids);
        palette = built.palette;
        poses =
          framesArg && Number(framesArg) >= 2
            ? posesFromFrames(built.rows)
            : autoPoses(built.rows[0]!);
        console.log(
          `${framesArg ? "sheet" : "single image"}: colour, ${Object.keys(palette).length} colours${framesArg ? "" : ", 11 poses auto-derived (bounces/mirror)"}`,
        );
      }
    }
  }
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
}

const pack = buildImagePack(poses, {
  name,
  id: arg("--id"),
  stage,
  chain,
  roles,
  ink,
  palette,
  hiPoses: folder?.hiPoses ?? undefined,
});
if (palette) {
  const sp = (pack.species as Array<Record<string, unknown>>)[0]!;
  const layers = Object.keys((sp.hiPoses as Record<string, unknown>) ?? {}).join("/") || "none";
  console.log(`palette: ${Object.keys(palette).length} colours · hi-res layers: ${layers}`);
} else if (ink) console.log(`ink colour: ${ink}`);
const slug = slugify(String(pack.name));
const packDir = join(outDir, slug);
mkdirSync(packDir, { recursive: true });
const file = join(packDir, "pack.json");
writeFileSync(file, JSON.stringify(pack, null, 2), "utf8");

const check = loadPetPacks(outDir);
const ours = check.errors.filter((e) => e.startsWith(`${slug}:`) || e.startsWith(`${slug}/`));
if (ours.length) {
  console.error(`✗ generated pack has problems:`);
  for (const e of ours) console.error(`  ${e}`);
  process.exit(1);
}
const id = (pack.species as Array<{ id: string }>)[0]!.id;
const sampleKey = roles?.idle?.[0] ?? Object.keys(poses)[0]!;
const sample = poses[sampleKey]!.join("");
const filled = sample.split("").filter((c) => c !== ".").length;
console.log(`wrote ${file}`);
console.log(`  species ${id} (${filled} filled pixels in ${sampleKey}), validation OK`);
console.log(`next: in pi run  /pets import ${file}  (or just /reload), then /pets use ${id}`);
if (basename(imgArg).toLowerCase().includes("agumon") || /digimon|agumon/i.test(name)) {
  console.log(`reminder: Digimon designs are © Bandai — keep this pack local, never commit it.`);
}

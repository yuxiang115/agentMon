// Generate a pet pack from images — no hand-assembling of character grids.
//
//   npm run pack:from-image -- --img agumon.png --name 亚古兽 --id agumon --chain
//   npm run pack:from-image -- --img sheet.png --frames 11 --name Agumon
//   npm run pack:from-image -- --img pose-folder/ --name Agumon
//
//   --out <dir>        where pets live (default ~/.pi/agent/agentmon/pets)
//   --threshold 0-255  luminance cut for ink (default 140; raise to catch pale art)
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
  pngToBitmap,
  posesFromFrames,
  sheetToBitmaps,
} from "../pets/imagepack";
import type { PoseName } from "../pets/registry";
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
    'usage: npm run pack:from-image -- --img <png | pose-folder> --name "Agumon" [--id agumon] [--frames N] [--threshold 140] [--chain] [--out dir] [--stage branch]',
  );
  process.exit(1);
}
const threshold = Number(arg("--threshold") ?? 140);
const chain = process.argv.includes("--chain");
const stage = (arg("--stage") === "baby" ? "baby" : "branch") as "baby" | "branch";
const defaultOut = join(
  process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
  "agentmon",
  "pets",
);
const outDir = arg("--out") ?? defaultOut;

const POSE_FILES: Record<PoseName, string[]> = {
  idleA: ["idleA", "idlea", "idle-a", "idle_a"],
  idleB: ["idleB", "idleb", "idle-b", "idle_b"],
  think: ["think"],
  search: ["search"],
  codeA: ["codeA", "codea", "code-a", "code_a"],
  codeB: ["codeB", "codeb", "code-b", "code_b"],
  testA: ["testA", "testa", "test-a", "test_a"],
  testB: ["testB", "testb", "test-b", "test_b"],
  happy: ["happy"],
  sad: ["sad"],
  sleep: ["sleep"],
};

function decode(file: string): PNG {
  const png = PNG.sync.read(readFileSync(file));
  if (!png.width || !png.height) throw new Error(`${file}: empty image`);
  return png;
}

let poses: Record<PoseName, string[]>;
try {
  let entries: Dirent[] | null = null;
  try {
    entries = readdirSync(imgArg, { withFileTypes: true }); // throws when not a directory
  } catch {
    entries = null; // a file — fall through to image decoding
  }

  if (entries && !imgArg.toLowerCase().endsWith(".png")) {
    // pose-named folder
    poses = {} as Record<PoseName, string[]>;
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    for (const [pose, candidates] of Object.entries(POSE_FILES) as Array<[PoseName, string[]]>) {
      const hit = files.find((f) =>
        candidates.some((c) => f.toLowerCase() === `${c}.png` || f.toLowerCase() === `${c}.jpg`),
      );
      if (!hit) {
        console.error(`✗ folder is missing ${pose}.png`);
        process.exit(1);
      }
      poses[pose] = pngToBitmap(decode(join(imgArg, hit)), { threshold });
    }
    console.log("pose folder: 11 named images mapped 1:1");
  } else {
    if (!existsSync(imgArg)) {
      console.error(`✗ ${imgArg}: not found`);
      process.exit(1);
    }
    const png = decode(imgArg);
    const framesArg = arg("--frames");
    if (framesArg && Number(framesArg) >= 2) {
      const frames = sheetToBitmaps(png, Number(framesArg), { threshold });
      poses = posesFromFrames(frames);
      console.log(`sheet: ${frames.length} frames -> poses`);
    } else {
      poses = autoPoses(pngToBitmap(png, { threshold }));
      console.log("single image: 11 poses auto-derived (bounces/mirror) — a real sheet looks better");
    }
  }
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
}

const pack = buildImagePack(poses, { name, id: arg("--id"), stage, chain });
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
const ink = poses.idleA.join("").split("").filter((c) => c === "#").length;
console.log(`wrote ${file}`);
console.log(`  species ${id} (${ink} ink pixels in idleA), validation OK`);
console.log(`next: in pi run  /pets import ${file}  (or just /reload), then /pets use ${id}`);
if (basename(imgArg).toLowerCase().includes("agumon") || /digimon|agumon/i.test(name)) {
  console.log(`reminder: Digimon designs are © Bandai — keep this pack local, never commit it.`);
}

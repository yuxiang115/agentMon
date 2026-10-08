// Import creatures from a tuipet/DVPet sprite extraction into an agentMon
// pet pack. The extraction file is YOURS (Digimon sprites are © Bandai —
// keep them local, never commit them; docs/pet-packs.md).
//
//   npm run pack:from-tuipet -- --sprites path/to/sprites.json --names "Agumon,Greymon"
//   npm run pack:from-tuipet -- --sprites sprites.json.gz --names "Agumon" --chain
//   --out <dir>       target pets directory (default ~/.pi/agent/agentmon/pets)
//   --pack-name "..." pack display name
//   --map "think=3,codeA=7"   remap tuipet frame indices per pose
//   --chain           auto-wire byte -> first -> second ... evolution hops

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  parsePoseMapArg,
  slugify,
  tuipetRecordsToPack,
  type TuipetSpriteRecord,
} from "../pets/convert";
import { loadPetPacks } from "../pets/packs";

function arg(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
}

const spritesPath = arg("--sprites");
const namesArg = arg("--names");
if (!spritesPath || !namesArg) {
  console.error("usage: npm run pack:from-tuipet -- --sprites <file.json|file.json.gz> --names \"Name1,Name2\" [--out dir] [--pack-name name] [--map pose=idx,...] [--chain]");
  process.exit(1);
}

const names = namesArg.split(",").map((s) => s.trim()).filter(Boolean);
const defaultOut = join(
  process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
  "agentmon",
  "pets",
);
const outDir = arg("--out") ?? defaultOut;
const packName = arg("--pack-name") ?? `Imported pack (${names[0]}…)`;
const { map, errors } = parsePoseMapArg(arg("--map"));
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}

let raw = readFileSync(spritesPath);
if (spritesPath.endsWith(".gz") || raw[0] === 0x1f) raw = gunzipSync(raw);
let records: TuipetSpriteRecord[];
try {
  records = JSON.parse(raw.toString("utf8")) as TuipetSpriteRecord[];
} catch (e) {
  console.error(`✗ ${spritesPath} is not valid JSON: ${(e as Error).message}`);
  process.exit(1);
}
if (!Array.isArray(records)) {
  console.error("✗ expected a JSON array of sprite records (tuipet sprites.json format)");
  process.exit(1);
}

const result = tuipetRecordsToPack(records, names, { map, packName, chain: process.argv.includes("--chain") });

for (const w of result.warnings) console.warn(`! ${w}`);
if (result.missing.length) {
  console.error(`✗ not found: ${result.missing.join(", ")}`);
  const available = records.slice(0, 0).length; // keep the message cheap
  const suggestions = records.map((r) => r.name).filter((n) => n).slice(0, 40).join(", ");
  console.error(`  some names in the file include: ${suggestions}${available ? "" : ""}`);
  if (!result.pack.species.length) process.exit(1);
}

const slug = slugify(packName);
const packDir = join(outDir, slug);
mkdirSync(packDir, { recursive: true });
const file = join(packDir, "pack.json");
writeFileSync(file, JSON.stringify(result.pack, null, 2), "utf8");

console.log(`wrote ${file}`);
console.log(`  species : ${result.pack.species.map((s) => s.id as string).join(", ")}`);
if (result.pack.evolutions?.length) {
  console.log(`  evolution chain: ${result.pack.evolutions.map((e) => `${e.from} -> ${e.to}`).join(" , ")}`);
}

// validate the result immediately with the real loader
const check = loadPetPacks(outDir);
if (check.errors.length) {
  console.error(`✗ the generated pack has problems:`);
  for (const e of check.errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`validation: OK (${check.species.length} species load)`);
console.log(`reminder: Digimon sprites are © Bandai — keep this file local, never commit it.`);
console.log(`next: restart pi (or reload), then /pets list and /pets use ${result.pack.species[0]?.id ?? ""}`);

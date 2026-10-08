// Pet-pack inspector: print what agentMon would load from a pets directory.
//   npm run packs                (defaults to ~/.pi/agent/agentmon/pets)
//   npm run packs -- --dir path
// Run this after dropping a pack in to see validation errors without Pi.

import { homedir } from "node:os";
import { join } from "node:path";
import { loadPetPacks } from "../pets/packs";
import { SPECIES } from "../pets/registry";

const args = process.argv.slice(2);
const dirIdx = args.indexOf("--dir");
const dir =
  dirIdx !== -1 && args[dirIdx + 1]
    ? args[dirIdx + 1]
    : join(
        process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
        "agentmon",
        "pets",
      );

console.log(`agentMon pet packs — scanning ${dir}\n`);
console.log(`built-in species: ${Object.keys(SPECIES).join(", ")}\n`);

const result = loadPetPacks(dir);
if (!result.packs.length && !result.errors.length) {
  console.log("No packs found. See docs/pet-packs.md for the format.");
} else {
  for (const pack of result.packs) {
    console.log(`pack "${pack.name}" (${pack.slug}):`);
    for (const s of pack.species) {
      console.log(`  - ${s.id} (${s.name}, ${s.stage})${s.description ? " — " + s.description : ""}`);
    }
    console.log();
  }
  for (const rule of result.rules) {
    const g = rule.gates;
    console.log(
      `evolution ${rule.from} -> ${rule.to} (level>=${g.minLevel}, ${g.axis}>=${Math.round(g.minTraitShare * 100)}%, tasks>=${g.minTasks}, mistakes<=${g.maxCareMistakes}${g.minValidatedRatio ? `, validated>=${Math.round(g.minValidatedRatio * 100)}%` : ""})`,
    );
  }
}
if (result.errors.length) {
  console.error(`\n${result.errors.length} problem(s):`);
  for (const e of result.errors) console.error(`  ✗ ${e}`);
  process.exitCode = 1;
} else if (result.packs.length) {
  console.log("\nAll packs valid.");
}

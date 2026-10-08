// smartImportPet — the one-command front door: zips (with 7-Zip style inner
// paths), pose-image folders, single PNGs, packs, and tuipet extractions all
// install validated; the extension activates the first species on top.

import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { smartImportPet } from "../pets/ingest";
import { loadPetPacks } from "../pets/packs";
import { resetCustomSpecies } from "../pets/registry";

/** A synthetic pose PNG: orange blob with a dark outline on white. */
function posePng(): PNG {
  const png = new PNG({ width: 32, height: 32 });
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const i = (32 * y + x) << 2;
      const inside = x >= 8 && x < 24 && y >= 8 && y < 24;
      const edge = inside && (x < 10 || x >= 22 || y < 10 || y >= 22);
      const [r, g, b] = inside ? (edge ? [20, 20, 20] : [240, 150, 40]) : [255, 255, 255];
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return png;
}

function makePoseDir(dir: string, poses = ["idle1", "idle2", "code1"]): void {
  mkdirSync(dir, { recursive: true });
  for (const pose of poses) {
    writeFileSync(join(dir, `${pose}.png`), PNG.sync.write(posePng()));
  }
}

let petsDir: string;

function freshPetsDir(): string {
  const root = mkdtempSync(join(tmpdir(), "agentmon-ingest-"));
  petsDir = join(root, "pets");
  resetCustomSpecies();
  return root;
}

describe("smartImportPet", () => {
  it("imports a pose-image folder directly (colour pipeline + hi-res layers)", () => {
    const root = freshPetsDir();
    try {
      makePoseDir(join(root, "mon"));
      const r = smartImportPet(join(root, "mon"), petsDir, { displayName: "Zipmon" });
      expect(r.ok).toBe(true);
      expect(r.species?.[0]?.id).toBe("zipmon");
      const loaded = loadPetPacks(petsDir);
      expect(loaded.errors).toEqual([]);
      const sp = loaded.species[0]!;
      expect(Object.keys(sp.hiPoses ?? {})).toEqual(["32", "64"]);
      expect(sp.palette).toBeTruthy();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("imports a zip archive containing a wrapped pose folder", () => {
    const root = freshPetsDir();
    try {
      const stage = join(root, "stage", "mon-set", "crops");
      mkdirSync(stage, { recursive: true });
      makePoseDir(stage);
      const entries: Record<string, Uint8Array> = {};
      for (const f of readdirSync(stage)) {
        entries[`mon-set/crops/${f}`] = new Uint8Array(readFileSync(join(stage, f)));
      }
      const zip = join(root, "mon-set.zip");
      writeFileSync(zip, zipSync(entries));

      // whole archive: content one level down is found automatically
      const r1 = smartImportPet(zip, petsDir, { displayName: "Archivemon" });
      expect(r1.ok).toBe(true);
      expect(r1.species?.[0]?.id).toBe("archivemon");
      expect(existsSync(join(petsDir, "archivemon-pack", "pack.json"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("imports a 7-Zip style inner path: mon.zip\\crops", () => {
    const root = freshPetsDir();
    try {
      const crops = join(root, "build", "crops");
      mkdirSync(crops, { recursive: true });
      makePoseDir(crops, ["idle1", "happy1"]);
      const entries: Record<string, Uint8Array> = {};
      for (const f of readdirSync(crops)) entries[`crops/${f}`] = new Uint8Array(readFileSync(join(crops, f)));
      const zip = join(root, "inner.zip");
      writeFileSync(zip, zipSync(entries));

      // the virtual path does NOT exist on disk — ingest opens the zip
      const r = smartImportPet(`${zip}/crops`, petsDir, {});
      expect(r.ok).toBe(true);
      // default name comes from the inner folder basename
      expect(r.species?.[0]?.name.toLowerCase()).toContain("crops");
      const loaded = loadPetPacks(petsDir);
      expect(loaded.errors).toEqual([]);
      expect(loaded.species[0]!.hiPoses?.["64"]?.idle1).toHaveLength(64);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("imports a single PNG (auto-derived poses)", () => {
    const root = freshPetsDir();
    try {
      const img = join(root, "lone.png");
      writeFileSync(img, PNG.sync.write(posePng()));
      const r = smartImportPet(img, petsDir, { displayName: "Lone" });
      expect(r.ok).toBe(true);
      expect(Object.keys(r.species?.[0]?.poses ?? {})).toHaveLength(11);
      expect(r.species?.[0]?.hiPoses).toBeUndefined(); // no layers from one image
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("still imports pack.json folders and files, and fails softly on junk", () => {
    const root = freshPetsDir();
    try {
      const pack = {
        name: "Plain pack",
        species: [
          {
            id: "plainmon",
            name: "Plainmon",
            stage: "branch",
            palette: { a: "#ff0000" },
            poses: { idle1: Array.from({ length: 16 }, () => "a".repeat(16)) },
            roles: { idle: ["idle1"] },
          },
        ],
      };
      const packDir = join(root, "plain");
      mkdirSync(packDir);
      writeFileSync(join(packDir, "pack.json"), JSON.stringify(pack));
      expect(smartImportPet(packDir, petsDir, {}).ok).toBe(true);

      expect(smartImportPet(join(root, "ghost.zip"), petsDir, {}).ok).toBe(false);
      expect(smartImportPet(join(root, "nope"), petsDir, {}).ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

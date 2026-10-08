// One-command pet import — the "drop anything in" front door.
//
//   /pet import <path> [name]
//
// `path` may be a zip archive (optionally with an inner subpath, 7-Zip
// style: `mon.zip\source_crops`), a folder of pose-named images
// (idle1.png ... sleep2.png — converted to a full-colour pack with hi-res
// layers), a single PNG (11 poses auto-derived), a pack.json, a folder
// containing one, or a tuipet sprites.json(.gz). Everything lands in the
// pets dir validated; the caller activates the first species (the
// extension does that right after a successful import).

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { unzipSync } from "fflate";
import { importPetPack, type ImportOptions, type ImportResult } from "./packs";
import {
  buildImagePack,
  collectActivityFiles,
  posesFromFolder,
  pngToPosesLayers,
} from "./imagepack";
import { slugify } from "./convert";
import { PNG } from "pngjs";

export interface SmartImportOptions extends ImportOptions {
  /** Species display name for image-folder / single-image imports. */
  displayName?: string;
}

export type SmartImportResult = ImportResult;

/** Does the folder (or any subfolder, a few levels deep) hold pose-named images? */
function findImageFolder(dir: string): string | null {
  const looksLikePoses = (d: string): boolean => {
    let files: string[];
    try {
      files = readdirSync(d);
    } catch {
      return false;
    }
    const imgs = files.filter((f) => /\.(png)$/i.test(f));
    if (!imgs.length) return false;
    return collectActivityFiles(imgs, "idle").length > 0;
  };
  // zips often wrap content several folders deep — walk, poses-first
  const queue = [dir];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    if (looksLikePoses(current)) return current;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) queue.push(join(current, entry.name));
    }
  }
  return null;
}

/** Extract a zip into a fresh temp dir, rooted at `inner`; returns the dir
 *  plus the inner folder's name (for default species naming). */
function extractZip(zipPath: string, inner: string): { root: string; innerName: string } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(readFileSync(zipPath)));
  } catch (e) {
    throw new Error(`${zipPath}: not a readable zip (${(e as Error).message})`);
  }
  const root = mkdtempSync(join(tmpdir(), "agentmon-zip-"));
  const clean = inner.replace(/^[./\\]+|[\\/]+$/g, "").replace(/\\/g, "/");
  const prefix = clean ? clean + "/" : "";
  for (const [name, data] of Object.entries(files)) {
    const norm = name.replace(/\\/g, "/");
    if (norm.endsWith("/")) continue; // directory entry
    if (prefix && !norm.startsWith(prefix)) continue;
    const rel = prefix ? norm.slice(prefix.length) : norm;
    if (rel.split("/").some((part) => part === "..")) continue; // no traversal
    const target = join(root, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  return { root, innerName: clean.split("/").pop() ?? "" };
}

/** "source_crops" -> "Source crops". */
function prettifyFolderName(name: string): string {
  const stem = name.replace(/\.(zip|png|jpe?g|json|gz)$/i, "").replace(/[_-]+/g, " ").trim();
  return stem ? stem[0]!.toUpperCase() + stem.slice(1) : "Imported mon";
}

/** Build + install a generated pack through a staging dir (validated install). */
function installGeneratedPack(
  pack: Record<string, unknown>,
  petsDir: string,
): SmartImportResult {
  const stage = mkdtempSync(join(tmpdir(), "agentmon-stage-"));
  try {
    const file = join(stage, "pack.json");
    writeFileSync(file, JSON.stringify(pack), "utf8");
    return importPetPack(file, petsDir, {});
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/**
 * Import a pet from any supported source. Zips are extracted to a temp dir
 * (removed afterwards); image folders/single images run the colour pipeline
 * (16px poses + 32/64 hi-res layers, palette from the base); everything
 * finishes through `importPetPack`, so the pack is validated and installed.
 */
export function smartImportPet(srcPath: string, petsDir: string, opts: SmartImportOptions = {}): SmartImportResult {
  const fail = (errors: string[]): SmartImportResult => ({ ok: false, errors });
  let dir = srcPath;
  let tempDir: string | undefined;
  let innerName = "";
  const zipVirtual = /^(.*\.zip)[\\/](.+)$/i.exec(srcPath.replace(/"/g, ""));

  try {
    if (existsSync(srcPath)) {
      if (/\.zip$/i.test(srcPath)) {
        const extracted = extractZip(srcPath, "");
        tempDir = extracted.root;
        dir = tempDir;
      }
    } else if (zipVirtual && existsSync(zipVirtual[1]!)) {
      // 7-Zip style virtual path INTO the archive: mon.zip\source_crops
      const extracted = extractZip(zipVirtual[1]!, zipVirtual[2]!);
      tempDir = extracted.root;
      innerName = extracted.innerName;
      dir = tempDir;
    } else {
      return fail([`${srcPath}: file not found`]);
    }

    const isFile = statSync(dir).isFile();
    if (isFile && !/\.png$/i.test(dir)) {
      return importPetPack(dir, petsDir, opts); // pack.json / sprites.json(.gz)
    }

    if (!isFile && existsSync(join(dir, "pack.json"))) {
      return importPetPack(dir, petsDir, opts);
    }
    if (!isFile) {
      const tuipet = readdirSync(dir).find((f) => /^sprites.*\.json(\.gz)?$/i.test(f));
      if (tuipet) {
        return importPetPack(join(dir, tuipet), petsDir, {
          ...opts,
          names: opts.names?.length ? opts.names : [prettifyFolderName(basename(dir))],
        });
      }
    }

    // pose-named image folder (found recursively inside zips/folders)
    const imageDir = isFile ? null : findImageFolder(dir);
    if (imageDir) {
      const name = opts.displayName ?? prettifyFolderName(innerName || basename(imageDir));
      const r = posesFromFolder(imageDir, { color: true });
      if (r.error) return fail([`${imageDir}: ${r.error}`]);
      const pack = buildImagePack(r.poses, {
        name,
        id: slugify(name),
        roles: r.roles,
        palette: r.palette,
        ink: r.ink,
        hiPoses: r.hiPoses,
      });
      return installGeneratedPack(pack, petsDir);
    }

    // single PNG (11 poses auto-derived at every layer)
    if (isFile && /\.png$/i.test(dir)) {
      const png = PNG.sync.read(readFileSync(dir));
      const { poses, palette, hiPoses } = pngToPosesLayers(png, {});
      const name = opts.displayName ?? prettifyFolderName(basename(dir));
      const pack = buildImagePack(poses, { name, id: slugify(name), palette, hiPoses });
      return installGeneratedPack(pack, petsDir);
    }

    return fail([
      `${srcPath}: nothing importable — expected a zip, a pose-image folder (idle1.png...), a single PNG, a pack.json (file or folder), or a tuipet sprites.json`,
    ]);
  } catch (e) {
    return fail([`${srcPath}: ${(e as Error).message}`]);
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

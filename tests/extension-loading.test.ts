import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Reproduce a production install with unavailable image-import dependencies.
vi.mock("../pets/ingest", () => { throw new Error("Cannot find module 'pngjs'"); });
import agentmon from "../packages/pi-extension";

describe("production extension loading", () => {
  it("registers without loading pngjs and reports missing import dependencies only on demand", async () => {
    const registerCommand = vi.fn();
    const stateDir = mkdtempSync(join(tmpdir(), "agentmon-loading-"));
    try {
      agentmon({ on: vi.fn(), registerCommand } as unknown as ExtensionAPI, { stateDir });
      expect(registerCommand).toHaveBeenCalledWith("pet", expect.any(Object));
      const notify = vi.fn();
      const ctx = { cwd: process.cwd(), ui: { notify } } as unknown as ExtensionContext;
      const command = registerCommand.mock.calls[0][1];
      await command.handler("help", ctx);
      expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("agentMon /pet"), "info");
      await command.handler("import missing.png", ctx);
      expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("pet import unavailable"), "warning");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("keeps image/zip dependencies in the production manifest and lockfile", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
    for (const name of ["pngjs", "fflate"]) {
      expect(manifest.dependencies[name]).toBeTruthy();
      expect(manifest.devDependencies[name]).toBeUndefined();
      expect(lock.packages[""].dependencies[name]).toBe(manifest.dependencies[name]);
      expect(lock.packages[`node_modules/${name}`].dev).not.toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import { POSE_NAMES, SPECIES } from "../pets/registry";

/** Canonical built-ins use the 11-pose vocabulary; pack-named species
 *  (e.g. the image-imported Agumon) only need roles that resolve. */
const canonicalPoses = (poses: Record<string, string[]>): boolean =>
  Object.keys(poses).every((name) => (POSE_NAMES as readonly string[]).includes(name));

describe("species invariants (every creature in the registry)", () => {
  for (const [id, species] of Object.entries(SPECIES)) {
    const poseNames = Object.keys(species.poses);

    describe(`${species.name} (${id})`, () => {
      it("poses are 16 rows of 16 valid palette pixels with ink", () => {
        if (canonicalPoses(species.poses)) {
          expect(poseNames.sort()).toEqual([...POSE_NAMES].sort());
        }
        expect(poseNames.length).toBeGreaterThan(0);
        for (const name of poseNames) {
          const pose = species.poses[name]!;
          expect(pose.length, `${id}/${name}: 16 rows`).toBe(16);
          for (const [i, row] of pose.entries()) {
            expect(row.length, `${id}/${name} row ${i}: 16 cols`).toBe(16);
            const allowed = new Set([".", ...Object.keys(species.palette ?? { "#": "ink" })]);
            expect([...row].every((c) => allowed.has(c)), `${id}/${name}: valid pixels`).toBe(true);
          }
          expect(pose.some((r) => /[^.]/.test(r)), `${id}/${name}: has ink`).toBe(true);
        }
      });

      it("self-pads the bottom two rows (canonical sprites ground feet on row 13)", () => {
        for (const name of poseNames) {
          const pose = species.poses[name]!;
          expect(pose[14], `${id}/${name} row 14 empty`).toMatch(/^\.+$/);
          expect(pose[15], `${id}/${name} row 15 empty`).toMatch(/^\.+$/);
          // hand-authored sprites put feet on row 13; image imports centre
          // their content (a curled sleep pose floats) — grounding is the
          // compositor's job (fillScene floors every placement)
          if (canonicalPoses(species.poses)) {
            expect(pose[13], `${id}/${name} has feet on row 13`).toMatch(/[^.]/);
          }
        }
      });

      it("multi-frame loops actually differ", () => {
        const join = (b: string[]) => b.join("\n");
        for (const activity of ["idle", "code", "test"]) {
          const loop = species.roles[activity] ?? [];
          if (loop.length > 1) {
            expect(join(species.poses[loop[0]!]!)).not.toBe(join(species.poses[loop[1]!]!));
          }
        }
      });

      it("roles reference existing poses only, with an idle loop", () => {
        expect(species.roles.idle?.length, `${id}: idle loop`).toBeGreaterThan(0);
        for (const [activity, poses] of Object.entries(species.roles)) {
          expect(poses.length, `${activity} has poses`).toBeGreaterThan(0);
          for (const p of poses) expect(poseNames).toContain(p);
        }
      });
    });
  }

  it("branch species are visually distinct from each other (no duplicate art)", () => {
    const join = (b: string[]) => b.join("\n");
    const idle = Object.values(SPECIES).map((s) => join(s.poses[s.roles.idle[0]!]!));
    expect(new Set(idle).size).toBe(idle.length);
  });
});

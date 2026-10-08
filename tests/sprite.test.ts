import { describe, expect, it } from "vitest";
import { POSE_NAMES, SPECIES } from "../pets/registry";

describe("species invariants (every creature in the registry)", () => {
  for (const [id, species] of Object.entries(SPECIES)) {
    describe(`${species.name} (${id})`, () => {
      it("has all 11 poses, each 16 rows of exactly 16 chars of #/.", () => {
        expect(Object.keys(species.poses).sort()).toEqual([...POSE_NAMES].sort());
        for (const name of POSE_NAMES) {
          const pose = species.poses[name];
          expect(pose.length, `${id}/${name}: 16 rows`).toBe(16);
          for (const [i, row] of pose.entries()) {
            expect(row.length, `${id}/${name} row ${i}: 16 cols`).toBe(16);
            expect(row, `${id}/${name} row ${i}: only # and .`).toMatch(/^[#.]*$/);
          }
          expect(pose.some((r) => r.includes("#")), `${id}/${name}: has ink`).toBe(true);
        }
      });

      it("self-pads the bottom two rows and grounds feet on row 13", () => {
        for (const name of POSE_NAMES) {
          expect(species.poses[name][14], `${id}/${name} row 14 empty`).toMatch(/^\.+$/);
          expect(species.poses[name][15], `${id}/${name} row 15 empty`).toMatch(/^\.+$/);
          expect(species.poses[name][13], `${id}/${name} has feet on row 13`).toMatch(/#/);
        }
      });

      it("two-frame loops actually differ", () => {
        const join = (b: string[]) => b.join("\n");
        expect(join(species.poses.idleA)).not.toBe(join(species.poses.idleB));
        expect(join(species.poses.codeA)).not.toBe(join(species.poses.codeB));
        expect(join(species.poses.testA)).not.toBe(join(species.poses.testB));
      });

      it("roles reference existing poses only", () => {
        for (const [activity, poses] of Object.entries(species.roles)) {
          expect(poses.length, `${activity} has poses`).toBeGreaterThan(0);
          for (const p of poses) expect(POSE_NAMES).toContain(p);
        }
      });
    });
  }

  it("branch species are visually distinct from each other (no duplicate art)", () => {
    const join = (b: string[]) => b.join("\n");
    const idle = Object.values(SPECIES).map((s) => join(s.poses.idleA));
    expect(new Set(idle).size).toBe(idle.length);
  });
});

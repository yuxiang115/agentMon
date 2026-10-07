import { describe, expect, it } from "vitest";
import { BYTE, POSE_NAMES } from "../pets/sprites/byte";

describe("BYTE species invariants", () => {
  it("has all 11 poses, each 16 rows of exactly 16 chars of #/.", () => {
    expect(Object.keys(BYTE.poses).sort()).toEqual([...POSE_NAMES].sort());
    for (const name of POSE_NAMES) {
      const pose = BYTE.poses[name];
      expect(pose.length, `${name}: 16 rows`).toBe(16);
      for (const [i, row] of pose.entries()) {
        expect(row.length, `${name} row ${i}: 16 cols`).toBe(16);
        expect(row, `${name} row ${i}: only # and .`).toMatch(/^[#.]*$/);
      }
      expect(pose.some((r) => r.includes("#")), `${name}: has ink`).toBe(true);
    }
  });

  it("self-pads the bottom two rows so the feet ground 2px above the edge", () => {
    for (const name of POSE_NAMES) {
      expect(BYTE.poses[name][14], `${name} row 14 empty`).toMatch(/^\.+$/);
      expect(BYTE.poses[name][15], `${name} row 15 empty`).toMatch(/^\.+$/);
      expect(BYTE.poses[name][13], `${name} has feet on row 13`).toMatch(/#/);
    }
  });

  it("two-frame loops actually differ", () => {
    const join = (b: string[]) => b.join("\n");
    expect(join(BYTE.poses.idleA)).not.toBe(join(BYTE.poses.idleB));
    expect(join(BYTE.poses.codeA)).not.toBe(join(BYTE.poses.codeB));
    expect(join(BYTE.poses.testA)).not.toBe(join(BYTE.poses.testB));
  });

  it("roles reference existing poses only", () => {
    for (const [activity, poses] of Object.entries(BYTE.roles)) {
      expect(poses.length, `${activity} has poses`).toBeGreaterThan(0);
      for (const p of poses) expect(POSE_NAMES).toContain(p);
    }
  });

  it("idle/walk, code and test loops are two-frame; the rest are single", () => {
    expect(BYTE.roles.walk).toHaveLength(2);
    expect(BYTE.roles.code).toHaveLength(2);
    expect(BYTE.roles.test).toHaveLength(2);
    expect(BYTE.roles.think).toHaveLength(1);
    expect(BYTE.roles.sleep).toHaveLength(1);
  });
});

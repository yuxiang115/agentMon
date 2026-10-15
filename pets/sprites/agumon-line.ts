// Hand-authored palette pixels for the requested fan companion. These are
// code-native sprites, not extracted game assets. Digimon characters belong
// to their respective owners; see README for the change from the old art policy.
import type { SpeciesDef } from "../registry";

const palette = {
  k: "#29323c", d: "#526170", w: "#fff2d5", p: "#f6a2bb",
  r: "#cc6588", o: "#f6af3f", s: "#ce712a", g: "#76c58f",
  b: "#74cbdd", y: "#ffe18a",
};
const bitmap = (rows: string[]): string[] => rows.map((r) => r.padEnd(16, "."));

const botamon = bitmap([
  "................", "................", "................", "................",
  "....kk....kk....", "...kddkkkkddk...", "..kddddddddddk..", "..kddwwddwwddk..",
  "..kddwkddwkddk..", "..kddddddddddk..", "..kddddkkddddk..", "...kddddddddk...",
  "...kddddddddk...", "....kkkkkkkk....", "................", "................",
]);
const koromon = bitmap([
  "...kk......kk...", "...kpk....kpk...", "...kppk..kppk...", "....kpk..kpk....",
  "....kppkkppk....", "...kppppppppk...", "..kppppppppppk..", "..kppwwppwwppk..",
  "..kppwkppwkppk..", "..kprpppppprpk..", "..kpppkkkkpppk..", "...kppkwwkppk...",
  "...kppprrpppk...", "....kkkkkkkk....", "................", "................",
]);
const agumon = bitmap([
  "................", "......kkkkkk....", ".....koooooook..", "....koowgwoook..",
  "....koowkwoook..", "....koooooooook.", ".....kooowwwwk..", ".....koookkkk...",
  ".kk..koooosk....", ".kokkooooookk...", "..koookoookowk..", "...kookooookk...",
  "....kokookook...", "...kwwkkkwwwk...", "................", "................",
]);

function pixels(base: string[], changes: Array<[number, number, string]>): string[] {
  const grid = base.map((r) => [...r]);
  for (const [x, y, color] of changes) grid[y][x] = color;
  return grid.map((r) => r.join(""));
}

function makeSpecies(id: string, name: string, lifeStage: string, base: string[], eyes: number): SpeciesDef {
  // Motion and small props use the same 16x16 role vocabulary as Byte.
  const blink = pixels(base, [[5, eyes, "k"], [6, eyes, "k"], [9, eyes, "k"], [10, eyes, "k"]]);
  const codeA = pixels(base, [[0, 12, "b"], [1, 11, "b"], [2, 12, "b"], [1, 13, "b"]]);
  const codeB = pixels(base, [[0, 11, "b"], [1, 12, "b"], [2, 11, "b"], [1, 10, "b"]]);
  return {
    id, name, lifeStage, stage: id === "agumon" ? "branch" : "baby", palette,
    description: `${name} — ${lifeStage}, raised through coding tasks.`,
    poses: {
      idleA: base, idleB: blink,
      think: pixels(blink, [[14, 1, "b"], [15, 2, "b"], [14, 3, "b"], [14, 5, "b"]]),
      search: pixels(base, [[0, 6, "b"], [1, 5, "b"], [2, 6, "b"], [1, 7, "b"], [2, 8, "b"]]),
      codeA, codeB,
      testA: pixels(base, [[13, 9, "g"], [14, 10, "g"], [15, 9, "g"], [15, 8, "g"]]),
      testB: pixels(blink, [[13, 8, "g"], [14, 9, "g"], [15, 8, "g"], [15, 7, "g"]]),
      happy: pixels(base, [[0, 2, "y"], [1, 1, "y"], [1, 3, "y"], [2, 2, "y"], [14, 1, "y"], [14, 3, "y"], [13, 2, "y"], [15, 2, "y"]]),
      sad: pixels(blink, [[3, 10, "b"], [12, 10, "b"]]),
      sleep: pixels(blink, [[13, 0, "b"], [14, 0, "b"], [14, 1, "b"], [13, 2, "b"], [14, 2, "b"]]),
    },
    roles: {
      idle: ["idleA", "idleB"], walk: ["idleA", "idleB"], think: ["think", "idleB"],
      search: ["search", "idleA"], code: ["codeA", "codeB"], test: ["testA", "testB"],
      happy: ["happy", "idleA"], sad: ["sad"], sleep: ["sleep", "idleB"],
    },
  };
}

export const BOTAMON = makeSpecies("botamon", "Botamon", "Baby I", botamon, 7);
export const KOROMON = makeSpecies("koromon", "Koromon", "Baby II", koromon, 7);
export const AGUMON = makeSpecies("agumon", "Agumon", "Rookie", agumon, 3);

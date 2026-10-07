// Animation cadence + Roamer, ported from tuipet src/tuipet/anim.py
// (https://github.com/joeltco/tuipet) — MIT, (c) 2026 Joel Taylor.
//
// The engine rests on the decompiled-device invariant: one tick == 0.1 s, and
// every beat fires at a whole number of ticks, so timing is testable without
// a clock. agentMon retunes the idle hold from tuipet's 5/6/7 ticks to 3
// (~3.3 pose switches per second) to hit plan.md §13's 2-4 FPS target; the
// roam constants stay device-exact.

export const TICK_MS = 100;

export const STEP_PX = 2; // device-exact: 2px per beat
export const TURN_CHANCE = 0.3; // ~30% of beats flip direction
export const WALL_PAUSE = 4; // beats stopped at a wall before departing
export const WALK_BEAT = 5; // a step every 5 ticks (0.5 s)
export const SLEEP_BEAT = 10; // sleep pose period
/** Default pose hold (tuipet idle_hold: 5 restless / 6 normal / 7 calm). */
export const HOLD = 3;

export function idleHold(restless: number): number {
  return restless > 0 ? 5 : restless < 0 ? 7 : 6;
}

/** Injectable RNG (audit §3: the core never touches Math.random directly). */
export type Rng = () => number;

/** mulberry32 — tiny seeded PRNG (public domain). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Frame selection: hold each pose `hold` ticks, loop the pose list. */
export function pickFrame<T>(frames: readonly T[], tick: number, hold = HOLD): T {
  return frames[Math.floor(tick / hold) % frames.length];
}

/**
 * Full-width pacing after the device's idleWalk: the pet steps STEP_PX every
 * WALK_BEAT ticks, re-picking its two walk poses 50/50 each beat, flipping
 * direction on ~30% of beats. Hitting a wall STOPS it for WALL_PAUSE beats
 * (standing on the turn pose pair), then it departs the other way. Randomness
 * is injected, so a seeded Roamer is fully deterministic for tests.
 */
export class Roamer {
  x: number;
  face: 1 | -1;
  /** Index into the two walk frames [0, 1]. */
  pose = 0;
  /** Wall-pause beats remaining. */
  pause = 0;
  /** True on the tick a movement beat landed. */
  stepped = false;

  private t = 0;
  private wall: 1 | -1 = 1;

  constructor(
    x: number,
    public cols: number,
    public spriteW: number,
    private rng: Rng,
    face: 1 | -1 = 1,
  ) {
    this.x = x;
    this.face = face;
  }

  /** Advance one 0.1 s tick. */
  step(leftBound = 0, rightBound?: number): void {
    this.stepped = false;
    this.t++;
    if (this.t < WALK_BEAT) return;
    this.t = 0;
    this.stepped = true;
    if (this.pause) {
      this.pause--;
      this.pose ^= 1; // the turn pair alternates while stopped
      if (this.pause === 0) {
        // departure beat: face away from the wall and go
        this.face = this.wall;
        this.x += this.face * STEP_PX;
      }
      return;
    }
    this.pose = this.rng() < 0.5 ? 0 : 1; // device: 50/50 frame pick
    if (this.rng() < TURN_CHANCE) this.face = this.face === 1 ? -1 : 1;
    this.x += this.face * STEP_PX;
    let rightEdge = this.cols - this.spriteW;
    if (rightBound !== undefined) rightEdge = Math.min(rightEdge, rightBound);
    if (this.x >= rightEdge) {
      this.x = rightEdge;
      this.pause = WALL_PAUSE;
      this.wall = -1;
    } else if (this.x <= leftBound) {
      this.x = leftBound;
      this.pause = WALL_PAUSE;
      this.wall = 1;
    }
  }

  /** Sprites face left natively; mirror to face right. */
  get mirror(): boolean {
    return this.face > 0;
  }
}

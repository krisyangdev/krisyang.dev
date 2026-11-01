// Where the bird can stand on the hero line.
//
//   const perches = createPerches(hero);
//
// A perch spot is { gap, f }: gap k lies between the k-th and (k+1)-th stop (letters and the avatar badge, left to
// right, plus one virtual stop END_REACH out past each end so the bare stretches of line are gaps too) and
// f in 0..1 is the way along it. Pegs are tied to fixed rope particles, so a spot is a fractional particle
// index s that follows the line wherever it moves. Pins stick up about 0.5 above the line, so a spot keeps
// PIN_CLEAR + HALF_WIDTH away from both pegs and narrow gaps are not used at all.
//   sOf(spot)                  fractional particle index of the feet
//   pointAt(s, out)            top surface of the rope at index s (Vector3, z = 0)
//   angleAt(s)                 line slope there (rad)
//   pick(out, opts)            random free spot; opts { fromX, minDist, maxDist, side } -> true if found
//   set(out, gap, f), sleepGap, centerX(), crosses(s0, s1)
// Units: world units.
import * as THREE from "three";

// ---- tunables ----------------------------------------------------------------------------------
const ROPE_TOP = 0.05; // feet rest this far above the particle line (rope radius 0.055)
const PIN_CLEAR = 0.11; // half a clothespin
export const HALF_WIDTH = 0.32; // half the bird, wings folded
const MIN_GAP = 2 * (PIN_CLEAR + HALF_WIDTH);
const END_REACH = 2.4; // the virtual stops sit this far out past the first and last peg
const SLOPE_SPAN = 0.7; // particles either side used for the slope

export function createPerches(hero) {
  const rope = hero.rope;
  const items = hero.items.slice().sort((a, b) => a.i + a.t - (b.i + b.t));
  const pegs = items.map((it) => it.i + it.t); // particle index of every peg, fixed once attached
  const reach = END_REACH / rope.segment;
  const stops = [Math.max(0, pegs[0] - reach), ...pegs, Math.min(rope.count - 2, pegs[pegs.length - 1] + reach)];
  const gapCount = stops.length - 1;

  const letterStops = items.filter((it) => it.kind === "letter").map((it) => it.i + it.t);
  const nameMid = (letterStops[0] + letterStops[letterStops.length - 1]) / 2;
  // sleeping spot: the bare stretch of line right of the last letter (the last gap)
  const sleepGap = gapCount - 1;

  const a = new THREE.Vector2();
  const b = new THREE.Vector2();

  // interpolated rope particle position at fractional index s
  function sample(s, out) {
    const p = rope.pos;
    const last = rope.count - 2;
    let i = Math.floor(s);
    if (i < 0) i = 0;
    else if (i > last) i = last;
    const t = THREE.MathUtils.clamp(s - i, 0, 1);
    const k = i * 3;
    out.x = p[k] + (p[k + 3] - p[k]) * t;
    out.y = p[k + 1] + (p[k + 4] - p[k + 1]) * t;
  }

  const width = (g) => (stops[g + 1] - stops[g]) * rope.segment;
  const sOf = (spot) => stops[spot.gap] + (stops[spot.gap + 1] - stops[spot.gap]) * spot.f;
  const xOf = (s) => {
    sample(s, a);
    return a.x;
  };

  return {
    sleepGap,
    gapCount,
    sOf,
    xOf,
    centerX: () => xOf(nameMid),
    set(out, gap, f) {
      out.gap = gap;
      out.f = f;
    },
    pointAt(s, out) {
      sample(s, a);
      return out.set(a.x, a.y + ROPE_TOP, 0);
    },
    angleAt(s) {
      sample(s - SLOPE_SPAN, a);
      sample(s + SLOPE_SPAN, b);
      return Math.atan2(b.y - a.y, b.x - a.x);
    },
    // true when a peg lies between the two indices (the bird has to hop over its pin)
    crosses(s0, s1) {
      const lo = Math.min(s0, s1);
      const hi = Math.max(s0, s1);
      for (const s of pegs) if (s > lo && s < hi) return true;
      return false;
    },
    pick(out, { fromX = 0, minDist = 0, maxDist = 99, side = 0 } = {}) {
      const cx = xOf(nameMid);
      let n = 0;
      for (let g = 0; g < gapCount; g++) {
        const w = width(g);
        if (w < MIN_GAP) continue;
        const margin = (PIN_CLEAR + HALF_WIDTH) / w;
        const f = margin + (1 - 2 * margin) * Math.random();
        const x = xOf(stops[g] + (stops[g + 1] - stops[g]) * f);
        const d = Math.abs(x - fromX);
        if (d < minDist || d > maxDist) continue;
        if (side && (x - cx) * side < 0) continue;
        n++;
        if (Math.random() * n < 1) {
          out.gap = g;
          out.f = f;
        }
      }
      return n > 0;
    },
  };
}

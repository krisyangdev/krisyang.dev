// The hero clothesline: a thick oat-colored yarn Rope strung between two off-screen anchors.
//
// A long rope solved with position-based dynamics stretches under its own weight, so the sag it ends up
// with is not the sag of the path it started on. calibrate() measures the sag of the fully loaded line
// and corrects the starting slack (and, when the rope is still too stretchy even with no slack, the
// solver iterations) until the middle of the line hangs HERO.sag below its anchors.
// Hung items are tied to the rope at fractional particle indices (attach); writeLoads() turns their
// weights and the breeze into per-particle accelerations every frame.
// Units: world units, seconds.
import * as THREE from "three";
import { Rope } from "./yarn/rope.js";
import { strandMaterial } from "./materials.js";

// ---- tunables ----------------------------------------------------------------------------------
const SEGMENT = 0.25; // rope particle spacing (the sag is only a few segments deep, coarse is fine)
const RADIUS = 0.055;
const TWIST = 0.3; // world length of one ply twist
const START_ITERATIONS = 60; // constraint sweeps per substep; calibrate() raises it when the line is too soft
const MAX_ITERATIONS = 320;
const ROPE_WIND = 1.1; // rope particle acceleration per unit of breeze
const SAG_TOLERANCE = 0.05;
const PATH_POINTS = 57;

export function createLine({ anchorX, y, sag }) {
  const rope = new Rope({
    groundAt: () => -1e3,
    material: strandMaterial("oat"),
    maxPoints: 260,
    segment: SEGMENT,
    radius: RADIUS,
    twist: TWIST,
    radialSegments: 10,
    iterations: START_ITERATIONS,
  });
  rope.setAnchor(new THREE.Vector3(-anchorX, y, 0));
  rope.setTailAnchor(new THREE.Vector3(anchorX, y, 0));

  // polyline with one extra point past the tail so the last particle always exists
  const path = Array.from({ length: PATH_POINTS + 1 }, () => new THREE.Vector3());

  function reset(slack) {
    let len = 0;
    for (let k = 0; k < PATH_POINTS; k++) {
      const f = k / (PATH_POINTS - 1);
      path[k].set(-anchorX + 2 * anchorX * f, y - slack * (1 - (2 * f - 1) ** 2), 0);
      if (k > 0) len += path[k].distanceTo(path[k - 1]);
    }
    path[PATH_POINTS].set(anchorX + 0.01, y, 0);
    rope.segment = len / Math.max(2, Math.round(len / SEGMENT)); // a whole number of segments
    rope.setPath(path);
  }

  // x -> fractional particle index { i, t } on the current line
  function locate(x) {
    const p = rope.pos;
    const last = rope.count - 2;
    let i = 0;
    while (i < last && p[(i + 1) * 3] < x) i++;
    const x0 = p[i * 3];
    const x1 = p[(i + 1) * 3];
    return { i, t: THREE.MathUtils.clamp((x - x0) / (x1 - x0 || 1), 0, 1) };
  }

  function sagNow() {
    return y - rope.pos[Math.round((rope.count - 1) / 2) * 3 + 1];
  }

  // Per-particle acceleration for this frame: breeze on the whole line, plus every item's weight on the
  // two particles around its peg. full = use the resting weights (calibration), wind = { breeze, scale }.
  function writeLoads(items, wind, full = false) {
    const { accel, pos, count } = rope;
    accel.fill(0, 0, count * 3);
    if (wind) {
      const d = wind.breeze.dir;
      const g = ROPE_WIND * wind.scale;
      for (let k = 0; k < count; k++) {
        const w = wind.breeze.at(pos[k * 3]) * g;
        accel[k * 3] = w * d.x;
        accel[k * 3 + 2] = w * d.z;
      }
    }
    for (const it of items) {
      const f = full ? it.weight : it.load;
      if (f === 0) continue;
      accel[it.i * 3 + 1] -= f * (1 - it.t);
      accel[(it.i + 1) * 3 + 1] -= f * it.t;
    }
    rope.wake();
  }

  // attach(items(with .x), loaded): leaves the line settled, with the items tied to it.
  // loaded = settle with the resting weights on (no intro), otherwise settle empty.
  function setup(items, loaded) {
    let slack = sag * 0.8;
    const tie = () => {
      for (const it of items) {
        const { i, t } = locate(it.x);
        it.attach(i, t);
      }
    };
    for (let pass = 0; pass < 6; pass++) {
      reset(slack);
      rope.accel.fill(0);
      rope.settle(2);
      tie();
      writeLoads(items, null, true);
      rope.settle(3);
      const got = sagNow();
      if (Math.abs(got - sag) < SAG_TOLERANCE) break;
      // sag^2 is roughly proportional to the extra rope length: slack part + stretch part
      const stretch2 = Math.max(0, got * got - slack * slack);
      const want2 = sag * sag - stretch2;
      if (want2 > 0.0004) {
        slack = Math.sqrt(want2);
      } else {
        slack = 0.02;
        rope.iterations = Math.min(MAX_ITERATIONS, Math.round(rope.iterations * 1.6));
      }
    }
    reset(slack);
    rope.accel.fill(0);
    rope.settle(2);
    tie();
    if (loaded) {
      writeLoads(items, null, true);
      rope.settle(3);
    }
  }

  return { rope, setup, writeLoads, sagNow };
}

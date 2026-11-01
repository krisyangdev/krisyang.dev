// A knitted line strung between two anchors off screen, with things hanging on it.
// Units: world units; y of the anchors comes from layout.js, the middle sags `sag` below them.
//
// Owns a Rope. Each frame it writes the rope's per-particle acceleration:
//   wind from breeze.at(x), plus the hung weights (static, set with addLoad) and short impulses
//   (a tug, a fling after a drag; set with addImpulse). Things hanging on the line read its particles.
import * as THREE from "three";
import { Rope } from "./yarn/rope.js";
import { strandMaterial } from "./materials.js";

// ---- tunables
const SEGMENT = 0.2; // rope particle spacing
const ITERATIONS = 60; // a taut 28 unit line needs more constraint sweeps than the yarn world's short ropes
const WIND_ROPE = 3.5; // rope acceleration at wind strength 1 (world units / s^2)
const WIND_SAMPLE = 3; // call breeze.at() for every Nth particle
const SETTLE_SECONDS = 3;
const KERNEL = [0.05, 0.12, 0.2, 0.26, 0.2, 0.12, 0.05]; // one hung weight spread over 7 particles
const MAX_IMPULSES = 6;

export class WallStrand {
  constructor({ y, color, anchorX, sag, radius }) {
    const span = anchorX * 2;
    this.rope = new Rope({
      groundAt: () => -1e4,
      material: strandMaterial(color),
      segment: SEGMENT,
      radius,
      twist: radius * 5.5,
      iterations: ITERATIONS,
      bend: 0.35,
      maxPoints: Math.ceil((span / SEGMENT) * 1.15) + 20,
    });
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const s = i / 40;
      pts.push(new THREE.Vector3(-anchorX + span * s, y - sag * 4 * s * (1 - s), 0));
    }
    const { rope } = this;
    rope.setPath(pts);
    rope.setAnchor(pts[0]);
    rope.setTailAnchor(rope.positionOf(rope.count - 1, new THREE.Vector3()));

    this.load = new Float32Array(rope.maxPoints); // extra downward acceleration per particle
    this.impulses = Array.from({ length: MAX_IMPULSES }, () => ({ t: 0, i: 0, ax: 0, ay: 0, az: 0, sigma: 1 }));
    this.tmp = new THREE.Vector3();
  }

  get mesh() {
    return this.rope.mesh;
  }

  // index of the particle nearest to world x (before any wind: the line is monotone in x)
  nearest(x) {
    const { pos, count } = this.rope;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < count; i++) {
      const d = Math.abs(pos[i * 3] - x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // hang `weight` (acceleration units added up over the spread) around particle i
  addLoad(i, weight) {
    const half = (KERNEL.length - 1) / 2;
    for (let j = -half; j <= half; j++) {
      const k = i + j;
      if (k >= 0 && k < this.rope.count) this.load[k] += weight * KERNEL[j + half];
    }
  }

  // velocity change (vx, vy, vz in world units/s) spread over a gaussian of `sigma` particles around i, applied over `duration` s
  addImpulse(i, vx, vy, vz, sigma = 4, duration = 0.06) {
    let slot = this.impulses[0];
    for (const imp of this.impulses) {
      if (imp.t <= 0) {
        slot = imp;
        break;
      }
      if (imp.t < slot.t) slot = imp;
    }
    slot.t = duration;
    slot.i = i;
    slot.ax = vx / duration;
    slot.ay = vy / duration;
    slot.az = vz / duration;
    slot.sigma = sigma;
  }

  // keep a dragged target inside what the line can reach from its far anchor
  // (the Rope itself already limits the reach from the near anchor)
  clampPull(target, index) {
    const { rope, tmp } = this;
    const reach = rope.reachFactor * (rope.count - 1 - index) * rope.segment;
    tmp.copy(target).sub(rope.tailAnchor);
    const l = tmp.length();
    if (l > reach) target.copy(rope.tailAnchor).addScaledVector(tmp, reach / l);
    return target;
  }

  settle(breeze, gain = 1) {
    for (let t = 0; t < SETTLE_SECONDS; t += 1 / 60) this.update(1 / 60, breeze, gain);
  }

  update(dt, breeze, gain) {
    const { rope, load, impulses } = this;
    const n = rope.count;
    const acc = rope.accel;
    const pos = rope.pos;
    const wx = breeze.dir.x * WIND_ROPE * gain;
    const wz = breeze.dir.z * WIND_ROPE * gain;
    let w = 0;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      if (i % WIND_SAMPLE === 0) w = breeze.at(pos[k]);
      acc[k] = wx * w;
      acc[k + 1] = -load[i];
      acc[k + 2] = wz * w;
    }
    for (const imp of impulses) {
      if (imp.t <= 0) continue;
      imp.t -= dt;
      const r = Math.ceil(imp.sigma * 3);
      const inv = 1 / (2 * imp.sigma * imp.sigma);
      for (let j = -r; j <= r; j++) {
        const i = imp.i + j;
        if (i < 1 || i >= n - 1) continue;
        const f = Math.exp(-j * j * inv);
        const k = i * 3;
        acc[k] += imp.ax * f;
        acc[k + 1] += imp.ay * f;
        acc[k + 2] += imp.az * f;
      }
    }
    rope.wake();
    rope.update(dt);
  }
}

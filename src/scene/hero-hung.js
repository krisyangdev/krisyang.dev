// One thing pegged to the hero clothesline (a letter or the avatar badge).
//
// Scene graph the owner adds to the scene:  pin (clothespin, rides the line)  and  pivot > body > content.
// pivot is driven by Hang (two-hinge pendulum) at the grip point just under the pin; body carries the
// squash / stretch springs; content's origin is the grip point and it extends down -y.
// The item is tied to the rope at fractional particle index i + t. Every frame follow() reads that
// point back from the rope, derives the peg's acceleration (smoothed second difference) and the
// local line angle, and feeds the pendulum.
// Also holds the intro state (wait -> drop -> hung) and the extra rope load it contributes.
// Units: world units, seconds.
import * as THREE from "three";
import { Hang } from "./hang.js";
import { Spring } from "./yarn/spring.js";
import { makeClothespin, PIN_GRIP_Y } from "./clothespin.js";

// ---- tunables ----------------------------------------------------------------------------------
export const PIN_SCALE = 1.6; // clothespin size relative to the model
const HOLD = 0.17; // how deep the top edge sits inside the jaws
const ACCEL_SMOOTH = 18; // 1/s, smoothing of the peg acceleration estimate
const ACCEL_MAX = 40; // units/s^2 per axis, keeps a violent grab from flinging the pendulum
const DROP_HEIGHT = 7; // intro: start this far above the line
const DROP_G = 52; // intro: fall acceleration
const APPEAR_TIME = 0.12; // intro: scale-in while falling
const LOAD_RAMP = 0.05; // s, the hung weight fades in after landing
const IMPACT_TIME = 0.07; // s, extra downward pull when it lands
const IMPACT_ACCEL = 260;

const sstep = (x) => x * x * (3 - 2 * x);

export class Hung {
  // x: where on the line it hangs; weight: extra downward acceleration written onto the rope at the peg (rope particles weigh 1)
  constructor({ kind, x, content, length, weight, windGain = 1, swingDamping = 1.4, flipDamping = 1, delay = 0 }) {
    this.kind = kind;
    this.x = x; // rest x of the peg on the line
    this.weight = weight;
    this.delay = delay;

    this.pin = makeClothespin();
    this.pin.scale.setScalar(PIN_SCALE);
    this.pivot = new THREE.Group();
    this.body = new THREE.Group();
    this.pivot.add(this.body);
    this.body.add(content);

    this.hang = new Hang({ length, swingDamping, flipDamping, windGain });
    this.sy = new Spring(260, 12, 1);
    this.sxz = new Spring(260, 12, 1);

    this.i = 0; // rope particle index + fraction t
    this.t = 0;
    this.angle = 0; // line slope at the peg
    this.peg = new THREE.Vector3();
    this.last = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.accel = new THREE.Vector3();
    this.grip = new THREE.Vector3();
    this.tracked = false;

    this.phase = "wait"; // wait | drop | hung
    this.offset = DROP_HEIGHT;
    this.vy = 0;
    this.appear = 0;
    this.sinceLand = 0;

    // interaction state, owned by hero.js
    this.pulse = 0;
    this.cool = 0;
    this.grab = null;
    this.pull = 0;
    this.dragOff = new THREE.Vector3();
    this.start = new THREE.Vector3();

    this.show(false);
  }

  show(on) {
    this.pin.visible = on;
    this.pivot.visible = on;
  }

  skipIntro() {
    this.phase = "hung";
    this.offset = 0;
    this.appear = 1;
    this.sinceLand = 1;
    this.show(true);
  }

  attach(i, t) {
    this.i = i;
    this.t = t;
    this.tracked = false;
  }

  squash(sy, sxz) {
    this.sy.value = sy;
    this.sy.velocity = 0;
    this.sxz.value = sxz;
    this.sxz.velocity = 0;
  }

  // extra downward acceleration this item puts on the rope right now
  get load() {
    if (this.phase !== "hung") return 0;
    let f = this.weight * Math.min(1, this.sinceLand / LOAD_RAMP);
    if (this.pulse > 0) f += IMPACT_ACCEL;
    return f;
  }

  // timers and the intro fall; true on the frame it lands
  tick(dt, clock) {
    this.cool = Math.max(0, this.cool - dt);
    if (this.pulse > 0) this.pulse -= dt;
    if (this.phase === "wait") {
      if (clock < this.delay) return false;
      this.phase = "drop";
      this.show(true);
    }
    if (this.phase === "drop") {
      this.appear = Math.min(1, this.appear + dt / APPEAR_TIME);
      this.vy -= DROP_G * dt;
      this.offset += this.vy * dt;
      if (this.offset > 0) return false;
      this.offset = 0;
      this.vy = 0;
      this.phase = "hung";
      this.sinceLand = 0;
      this.pulse = IMPACT_TIME;
      return true;
    }
    this.sinceLand += dt;
    return false;
  }

  readPeg(rope) {
    const p = rope.pos;
    const k = this.i * 3;
    const t = this.t;
    this.peg.set(p[k] + (p[k + 3] - p[k]) * t, p[k + 1] + (p[k + 4] - p[k + 1]) * t, p[k + 2] + (p[k + 5] - p[k + 2]) * t);
    const a = Math.max(0, this.i - 2) * 3;
    const b = Math.min(rope.count - 1, this.i + 3) * 3;
    this.angle = Math.atan2(p[b + 1] - p[a + 1], p[b] - p[a]);
  }

  // after rope.update: windX / windZ = push on the hanging body (units/s^2)
  follow(rope, dt, windX, windZ) {
    this.readPeg(rope);
    const P = this.peg;
    if (this.tracked && dt > 1e-4) {
      const k = 1 - Math.exp(-ACCEL_SMOOTH * dt);
      const vx = (P.x - this.last.x) / dt;
      const vy = (P.y - this.last.y) / dt;
      const vz = (P.z - this.last.z) / dt;
      const a = this.accel;
      a.x += THREE.MathUtils.clamp((vx - this.vel.x) / dt, -ACCEL_MAX, ACCEL_MAX) * k - a.x * k;
      a.y += THREE.MathUtils.clamp((vy - this.vel.y) / dt, -ACCEL_MAX, ACCEL_MAX) * k - a.y * k;
      a.z += THREE.MathUtils.clamp((vz - this.vel.z) / dt, -ACCEL_MAX, ACCEL_MAX) * k - a.z * k;
      this.vel.set(vx, vy, vz);
    } else {
      this.vel.set(0, 0, 0);
    }
    this.last.copy(P);
    this.tracked = true;

    if (this.phase === "hung") this.hang.update(dt, this.accel, windX, windZ);

    const o = this.offset;
    this.pin.position.set(P.x, P.y + o, P.z);
    this.pin.rotation.z = this.angle;

    const d = PIN_GRIP_Y * PIN_SCALE + HOLD;
    this.grip.set(P.x - Math.sin(this.angle) * d, P.y + Math.cos(this.angle) * d + o, P.z);
    this.hang.apply(this.pivot, this.grip, this.angle);

    this.sy.update(dt);
    this.sxz.update(dt);
    const s = sstep(this.appear);
    this.body.scale.set(this.sxz.value * s, this.sy.value * s, this.sxz.value * s);
  }
}
